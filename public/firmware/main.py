# main.py — ESP32 (MicroPython)
# BLE NUS peripheral — streams contact voltages >= HIT_THRESHOLD_V
# Uses ADS1015 A+B + 74HC4052 scanning (12 rows x 8 cols)
#
# Flash this to the ESP32 as main.py

import time
import struct
import json
from micropython import const
from machine import Pin, I2C
import bluetooth

# ─────────────────────────────────────────
# Device identity — read from NVS
# Written once by boot.py; persists across reboots and OTA.
# Falls back to safe defaults if NVS is unavailable.
#
# FIX: boot.py writes identity with set_blob() (standard MicroPython NVS API),
# but this file was calling get_str() which does NOT exist in standard MicroPython.
# Changed to get_blob() + decode("utf-8") to match boot.py's write calls.
# Without this fix every unit always advertises as "TS-UNKNOWN" and users
# cannot tell devices apart in the BLE picker.
# ─────────────────────────────────────────
_DEVICE_ID  = "TS-UNKNOWN"
_FW_VERSION = "0.0.0"
try:
    from esp32 import NVS
    _nvs    = NVS("device")
    _id_buf = bytearray(64)
    _fw_buf = bytearray(32)
    _nvs.get_blob("id", _id_buf)
    _nvs.get_blob("fw", _fw_buf)
    # Trim null bytes that pad the bytearray to its declared size
    _DEVICE_ID  = _id_buf.rstrip(b"\x00").decode("utf-8")
    _FW_VERSION = _fw_buf.rstrip(b"\x00").decode("utf-8")
except Exception:
    pass

DEVICE_NAME = _DEVICE_ID   # BLE advertised name now matches unit ID

# ─────────────────────────────────────────
# Hardware — edit to match your wiring
# ─────────────────────────────────────────
I2C_SDA, I2C_SCL = 21, 22
I2C_FREQ         = 400_000

ADC_A_ADDR = 0x48
ADC_B_ADDR = 0x49

MUX_S0_PIN = 13
MUX_S1_PIN = 14
MUX_EN_PIN = None       # tie low on PCB, or set GPIO number

ROW_PINS = [18, 19, 23, 25, 26, 32, 33, 27, 2, 4, 12, 15]   # R1-R12

COL_A = (1, 2, 3, 4)   # 4052 sel 0-3 → col numbers for ADC A
COL_B = (5, 6, 7, 8)   # 4052 sel 0-3 → col numbers for ADC B

# ─────────────────────────────────────────
# Streaming config
# ─────────────────────────────────────────
HIT_THRESHOLD_V  = 0.1    # only transmit hits >= this
SCAN_PERIOD_MS   = 37      # ~27 Hz — matches actual hardware ceiling (see timing note)
MAX_NOTIFY_HZ    = 25      # honest BLE cap given ADC hardware; 30 was unachievable

ADV_INTERVAL_US  = 200_000
ADV_WATCHDOG_MS  = 2_000   # re-issue advertising if still unconnected

# ADC timing (increase if readings are noisy)
ROW_SETTLE_US = 5
MUX_SETTLE_US = 8
CONV_WAIT_US  = 310        # ADS1015 @ 3300 SPS needs ~303 µs; 310 saves ~1.4ms/frame vs 340

# ─────────────────────────────────────────────────────────────────────────
# TIMING & WATCHDOG NOTE
# ─────────────────────────────────────────────────────────────────────────
# time.sleep_us() is a busy-wait — it does NOT yield to FreeRTOS.
# Per-frame busy-wait budget: 48 × (310µs conv + ~90µs I2C×2) ≈ 23ms.
# That alone would stall the TWDT.
#
# Optimised yield strategy (yields every 3 rows, not every row):
#   - 4 yields × 1ms = ~4ms overhead  (was 12ms — saves 8ms/frame)
#   - TWDT safe: 3 rows × ~1.9ms each = ~5.7ms max continuous busy-wait
#     (TWDT timeout is 5 seconds — nowhere near triggered)
#   - Effective frame time: ~37ms → ~27 Hz scan rate
#   - MAX_NOTIFY_HZ capped at 25 to leave BLE stack headroom
# ─────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────
# ADS1015 constants
# ─────────────────────────────────────────
REG_CONV   = const(0x00)
REG_CONFIG = const(0x01)

PGA_4V096 = const(0b001)
DR_3300   = const(0b111)
MODE_SS   = const(1)
COMP_DIS  = const(0b11)

MUX_AIN2  = const(0b110)

ADC_A_MUX = MUX_AIN2
ADC_B_MUX = MUX_AIN2

LSB_V = 0.002   # 4.096 V / 2048 counts

# ─────────────────────────────────────────
# BLE — Nordic UART Service (NUS)
# ─────────────────────────────────────────
_UART_UUID    = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_TX_UUID = bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")  # notify
_UART_RX_UUID = bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")  # write

_FLAG_NOTIFY       = const(0x0010)
_FLAG_WRITE        = const(0x0008)
_FLAG_WRITE_NO_RSP = const(0x0004)

_IRQ_CENTRAL_CONNECT    = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE        = const(3)

_UART_SERVICE = (
    _UART_UUID,
    (
        (_UART_TX_UUID, _FLAG_NOTIFY),
        (_UART_RX_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RSP),
    ),
)

# ─────────────────────────────────────────
# Session gate — controlled by BLE commands
# ─────────────────────────────────────────
# The ESP32 will NOT scan or stream until the app sends {"cmd":"start"}.
# {"cmd":"stop"} pauses scanning without dropping the BLE connection.
# Written from the BLE IRQ, read in the main scan loop.
_scanning_enabled = False

# ─────────────────────────────────────────
# OTA state — written by IRQ, applied in run()
# ─────────────────────────────────────────
# Never write/reset directly from the IRQ; only signal via flags.
_ota_active   = False
_ota_apply    = False
_ota_filename = "main_new.py"
_ota_size     = 0
_ota_buf      = []
_ota_new_fw   = "0.0.0"


def _adv_payload(name: str) -> bytearray:
    """
    Advertising payload with two AD structures:

    1. Complete Local Name (type 0x09)
       Visible in the OS device-name picker and useful for manual identification.

    2. Complete List of 128-bit UUIDs (type 0x07) — the NUS service UUID.
       FIX: The old payload contained ONLY the name. Web Bluetooth's
       requestDevice() and most native BLE scanners filter on advertised
       service UUIDs. Without this AD structure the device is INVISIBLE
       to any scanner using a service-UUID filter, which is exactly what
       the app's adapter does. Including the UUID here costs 18 bytes
       (well within the 31-byte ADV_IND payload limit) and makes the
       device discoverable on first scan by every platform.

    UUID is encoded little-endian as required by the BT spec.
    """
    # ── AD1: Complete Local Name ──────────────────────────────────────────
    n       = name.encode("utf-8")
    name_ad = bytes((len(n) + 1, 0x09)) + n

    # ── AD2: Complete list of 128-bit UUICs — NUS service UUID ───────────
    # "6E400001-B5A3-F393-E0A9-E50E24DCCA9E" in little-endian byte order
    uuid_bytes = bytes([
        0x9E, 0xCA, 0xDC, 0x24, 0x0E, 0xE5, 0xA9, 0xE0,
        0x93, 0xF3, 0xA3, 0xB5, 0x01, 0x00, 0x40, 0x6E,
    ])
    uuid_ad = bytes((len(uuid_bytes) + 1, 0x07)) + uuid_bytes

    return bytearray(name_ad + uuid_ad)


class BLEUARTStreamer:
    def __init__(self, name=DEVICE_NAME):
        self._name = name
        self._ble  = bluetooth.BLE()
        self._ble.active(True)
        self._ble.config(mtu=512)   # raise ATT MTU; allows up to ~509-byte writes
        self._ble.irq(self._irq)

        ((self._tx_handle, self._rx_handle),) = \
            self._ble.gatts_register_services((_UART_SERVICE,))

        self._connections    = set()
        self._payload        = _adv_payload(name)
        self._is_advertising = False
        # FIX: hello is now sent unconditionally on connect, before any
        # "start" command arrives. The old guard (_scanning_enabled check)
        # created a deadlock: the app waits for hello before sending "start",
        # but hello was never sent because "start" hadn't arrived yet.
        self._pending_hello  = False

        self._advertise()

    # ── advertising ──────────────────────────────────────────────────────
    def _stop_adv(self):
        try:
            self._ble.gap_advertise(None)
        except Exception:
            pass

    def _advertise(self, interval_us=ADV_INTERVAL_US):
        self._stop_adv()
        for iv in (interval_us, 500_000):
            try:
                self._ble.gap_advertise(iv, adv_data=self._payload)
                self._is_advertising = True
                print(f"[BLE] advertising as '{self._name}'")
                return
            except OSError as e:
                print("[BLE] advertise error:", e)
                # FIX: yield to RTOS during retry delay instead of busy-waiting
                time.sleep_ms(250)
        self._is_advertising = False
        print("[BLE] advertising failed")

    def ensure_advertising(self):
        if not self.connected() and not self._is_advertising:
            self._advertise()

    # ── state ─────────────────────────────────────────────────────────────
    def connected(self):
        return len(self._connections) > 0

    def notify(self, data: bytes):
        for h in list(self._connections):
            try:
                self._ble.gatts_notify(h, self._tx_handle, data)
            except Exception:
                pass

    def _irq(self, event, data):
        global _scanning_enabled
        global _ota_active, _ota_apply, _ota_filename, _ota_size, _ota_buf, _ota_new_fw
        if event == _IRQ_CENTRAL_CONNECT:
            conn_handle, _, _ = data
            self._connections.add(conn_handle)
            self._is_advertising = False
            self._pending_hello  = True   # flag — send from main loop, not IRQ
            print(f"[BLE] central connected  handle={conn_handle}")

        elif event == _IRQ_CENTRAL_DISCONNECT:
            conn_handle, _, _ = data
            self._connections.discard(conn_handle)
            _scanning_enabled = False   # reset — app must re-send "start" after reconnect
            print(f"[BLE] central disconnected  handle={conn_handle} → re-advertising")
            self._advertise()

        elif event == _IRQ_GATTS_WRITE:
            # Parse commands from the app: start, stop, ota_start, ota_chunk, ota_end
            try:
                conn_handle, attr_handle = data
                raw = self._ble.gatts_read(self._rx_handle)
                obj = json.loads(raw.decode("utf-8"))
                cmd = obj.get("cmd", "")
                if cmd == "start":
                    _scanning_enabled = True
                    print("[BLE] cmd=start → scanning enabled")
                elif cmd == "stop":
                    _scanning_enabled = False
                    print("[BLE] cmd=stop  → scanning paused")
                elif cmd == "ota_start":
                    _ota_filename = obj.get("filename", "main_new.py")
                    _ota_size     = obj.get("size", 0)
                    _ota_buf      = []
                    _ota_active   = True
                    print(f"[OTA] start  file={_ota_filename} size={_ota_size}")
                elif cmd == "ota_chunk":
                    if _ota_active:
                        import ubinascii
                        # Chunks are base64-encoded on the app side so every BLE
                        # packet is pure ASCII — eliminates multi-byte UTF-8 and
                        # JSON-escape blowup from box-drawing comment dividers.
                        _ota_buf.append(ubinascii.a2b_base64(obj.get("data", "")))
                elif cmd == "ota_end":
                    if _ota_active:
                        _ota_active = False
                        _ota_new_fw = obj.get("fw", "0.0.0")
                        _ota_apply  = True   # signal main loop to write + reset
                        print(f"[OTA] end — will apply as {_ota_filename}")
                else:
                    print(f"[BLE] unknown cmd: {cmd}")
            except Exception as e:
                print(f"[BLE] IRQ write parse error: {e}")

# ─────────────────────────────────────────
# Hardware init
# ─────────────────────────────────────────
i2c = I2C(0, scl=Pin(I2C_SCL), sda=Pin(I2C_SDA), freq=I2C_FREQ)

mux_s0 = Pin(MUX_S0_PIN, Pin.OUT)
mux_s1 = Pin(MUX_S1_PIN, Pin.OUT)

if MUX_EN_PIN is not None:
    Pin(MUX_EN_PIN, Pin.OUT).value(0)   # active-low enable

rows = [Pin(p, Pin.OUT) for p in ROW_PINS]
for r in rows:
    r.value(0)

# ─────────────────────────────────────────
# ADC helpers
# ─────────────────────────────────────────
def _w16(addr, reg, val):
    i2c.writeto_mem(addr, reg, bytes([(val >> 8) & 0xFF, val & 0xFF]))

def _r16(addr, reg):
    b = i2c.readfrom_mem(addr, reg, 2)
    return (b[0] << 8) | b[1]

def ads_start(addr, mux_bits):
    cfg = (
        (1        << 15) |
        (mux_bits << 12) |
        (PGA_4V096 << 9) |
        (MODE_SS   << 8) |
        (DR_3300   << 5) |
        COMP_DIS
    )
    _w16(addr, REG_CONFIG, cfg)

def ads_read_volts(addr):
    raw    = _r16(addr, REG_CONV)
    signed = struct.unpack(">h", bytes([(raw >> 8) & 0xFF, raw & 0xFF]))[0]
    return (signed >> 4) * LSB_V

def set_mux(sel):
    mux_s0.value(sel & 1)
    mux_s1.value((sel >> 1) & 1)

# ─────────────────────────────────────────
# Matrix scan — returns hits above threshold
# ─────────────────────────────────────────
def scan_frame_hits(threshold_v=HIT_THRESHOLD_V):
    """
    Scan all 12×8 contacts and return hits above threshold_v.

    Yield strategy: sleep_ms(1) every 3 rows (not every row).
    4 yields × 1ms = ~4ms overhead vs the old 12ms — saves 8ms/frame.
    3 rows of busy-wait ≈ 5.7ms, far below the 5s TWDT timeout.
    """
    hits = []
    prev = None

    for r_idx, rpin in enumerate(rows):
        if prev is not None:
            prev.value(0)
        rpin.value(1)
        prev = rpin

        if ROW_SETTLE_US:
            time.sleep_us(ROW_SETTLE_US)

        for sel in range(4):
            set_mux(sel)
            if MUX_SETTLE_US:
                time.sleep_us(MUX_SETTLE_US)

            ads_start(ADC_A_ADDR, ADC_A_MUX)
            ads_start(ADC_B_ADDR, ADC_B_MUX)
            time.sleep_us(CONV_WAIT_US)

            va = ads_read_volts(ADC_A_ADDR)
            vb = ads_read_volts(ADC_B_ADDR)

            if va >= threshold_v:
                hits.append([r_idx + 1, COL_A[sel], int(va * 1000)])
            if vb >= threshold_v:
                hits.append([r_idx + 1, COL_B[sel], int(vb * 1000)])

        # Yield to FreeRTOS every 3 rows — keeps TWDT fed while
        # minimising yield overhead (4ms total vs 12ms per-row strategy).
        if r_idx % 3 == 2:
            time.sleep_ms(1)

    # Final yield covers rows 10-12 (the last partial group)
    time.sleep_ms(1)

    if prev is not None:
        prev.value(0)

    return hits

# ─────────────────────────────────────────────────────────────────────────
# Cell state tracker
# ─────────────────────────────────────────────────────────────────────────
# Keyed by (r, c) tuple.  Each entry holds:
#   t_first  — ticks_ms() when this cell first crossed the threshold
#   t_peak   — ticks_ms() when the highest voltage was observed
#   t_last   — ticks_ms() of the most recent active scan (updated every frame)
#   v_peak   — highest mv seen while the cell has been active (int)
#   v_last   — mv reading from the previous frame (used to detect rising edge)
#
# Cells are EVICTED the first frame they do not appear in scan_frame_hits(),
# meaning their voltage has dropped back below HIT_THRESHOLD_V.
# The app receives t_first and t_peak so it can compute:
#   rise_time_ms  = t_peak  − t_first
#   decay_time_ms = t_last  − t_peak   (lower-bound; true end is one frame later)
#   duration_ms   = t_last  − t_first
# ─────────────────────────────────────────────────────────────────────────
_cell_state = {}   # {(r, c): {"t_first", "t_last", "t_peak", "v_peak", "v_last"}}

def cell_state_reset():
    """Call when a session stops so stale state doesn't leak into the next one."""
    global _cell_state
    _cell_state = {}

def scan_frame_tracked(threshold_v=HIT_THRESHOLD_V):
    """
    Wrapper around scan_frame_hits() that layers per-cell timing state.

    Returns a list of enriched hit records — one per active cell:
        [r, c, mv_int, t_first_ms, t_peak_ms, v_peak_mv, is_new]

    Field notes
    ───────────
    mv_int      current voltage reading × 1000 (integer millivolts)
    t_first_ms  ESP32 uptime (ticks_ms) when this cell first went active
    t_peak_ms   ESP32 uptime when the highest voltage was recorded for this cell
    v_peak_mv   highest mv seen since the cell became active (integer)
    is_new      1 on the very first frame this cell appears, 0 thereafter;
                the app uses this to distinguish a fresh strike from a
                sustained/decaying contact
    """
    global _cell_state
    now_ms     = time.ticks_ms()
    raw_hits   = scan_frame_hits(threshold_v)
    active_keys = set()

    enriched = []
    for r, c, mv in raw_hits:
        key = (r, c)
        active_keys.add(key)

        if key not in _cell_state:
            # ── New cell: record onset ────────────────────────────────────
            _cell_state[key] = {
                "t_first": now_ms,
                "t_last":  now_ms,
                "t_peak":  now_ms,
                "v_peak":  mv,
                "v_last":  mv,
            }
            is_new = 1
        else:
            # ── Existing cell: update running stats ───────────────────────
            s = _cell_state[key]
            s["v_last"] = mv
            s["t_last"] = now_ms
            if mv > s["v_peak"]:
                s["v_peak"] = mv
                s["t_peak"] = now_ms
            is_new = 0

        s_out = _cell_state[key]
        enriched.append([
            r, c,
            mv,                 # current reading (millivolts, int)
            s_out["t_first"],   # onset timestamp
            s_out["t_peak"],    # peak timestamp
            s_out["v_peak"],    # peak millivolts
            is_new,             # 1 = first frame for this cell
        ])

    # ── Evict cells that dropped below threshold ──────────────────────────
    # We iterate a snapshot of keys so the dict can be mutated safely.
    for key in list(_cell_state):
        if key not in active_keys:
            del _cell_state[key]

    return enriched

# ─────────────────────────────────────────
# JSON sender with chunking for large frames
# ─────────────────────────────────────────
def notify_json_chunked(uart: BLEUARTStreamer, obj, max_len=180):
    s = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    if len(s) <= max_len:
        uart.notify(s)
        return
    chunk_payload = max_len - 10
    total = (len(s) + chunk_payload - 1) // chunk_payload
    for i in range(total):
        part   = s[i * chunk_payload:(i + 1) * chunk_payload]
        header = ("C%02d/%02d:" % (i + 1, total)).encode("utf-8")
        uart.notify(header + part)
        time.sleep_ms(5)

# ─────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────
def run():
    global _ota_apply
    print("=== BLE Matrix ESP32 ===")
    ble = BLEUARTStreamer(name=DEVICE_NAME)

    last_scan      = time.ticks_ms()
    last_notify    = time.ticks_ms()
    last_adv_wdog  = time.ticks_ms()
    notify_min_interval = int(1000 / MAX_NOTIFY_HZ)

    while True:
        now = time.ticks_ms()

        # Advertising watchdog — re-kick every ADV_WATCHDOG_MS if idle
        if not ble.connected():
            if time.ticks_diff(now, last_adv_wdog) >= ADV_WATCHDOG_MS:
                last_adv_wdog = now
                ble._is_advertising = False
                ble.ensure_advertising()
            time.sleep_ms(20)
            continue

        # FIX: hello packet is now sent as soon as the central connects,
        # BEFORE checking _scanning_enabled. The old code placed the hello
        # block after the `if not _scanning_enabled: continue` guard, which
        # meant hello was never dispatched on first connect. This created a
        # deadlock: the app needs the hello packet to learn device identity
        # and confirm the connection is live, but the app only sends "start"
        # after receiving hello — so scanning never started.
        # Moving hello before the scanning gate breaks the deadlock.
        if ble._pending_hello:
            ble._pending_hello = False
            notify_json_chunked(ble, {
                "type": "hello",
                "id":   _DEVICE_ID,
                "fw":   _FW_VERSION,
                "rows": 12,
                "cols": 8,
            })
            time.sleep_ms(20)
            continue

        # Connected — scan and stream only when app has sent {"cmd":"start"}
        if not _scanning_enabled:
            cell_state_reset()   # clear stale state whenever scanning is paused
            time.sleep_ms(20)    # idle yield — BLE stays alive, TWDT fed
            continue

        # Apply a completed OTA transfer: write file, update NVS, reset.
        # Uses write-then-rename so an interrupted transfer can never brick the device.
        if _ota_apply:
            _ota_apply = False
            try:
                content = b"".join(_ota_buf)
                with open(_ota_filename, "wb") as f:
                    f.write(content)
                import os
                os.rename(_ota_filename, "main.py")
                from esp32 import NVS
                nv = NVS("device")
                nv.set_blob("fw", _ota_new_fw.encode("utf-8"))
                nv.commit()
                notify_json_chunked(ble, {"type": "ota_ok", "fw": _ota_new_fw})
                time.sleep_ms(500)
                import machine
                machine.reset()
            except Exception as e:
                notify_json_chunked(ble, {"type": "ota_err", "msg": str(e)})

        if time.ticks_diff(now, last_scan) >= SCAN_PERIOD_MS:
            last_scan = now

            # ── Enriched scan: carries timing state across frames ─────────
            # Each hit: [r, c, mv, t_first_ms, t_peak_ms, v_peak_mv, is_new]
            hits = scan_frame_tracked(HIT_THRESHOLD_V)

            if hits and time.ticks_diff(now, last_notify) >= notify_min_interval:
                last_notify = now
                notify_json_chunked(ble, {
                    "t":    now,        # current frame timestamp (ESP32 uptime ms)
                    "n":    len(hits),
                    "hits": hits,       # 7-element arrays — see scan_frame_tracked docstring
                })

        time.sleep_ms(2)

run()