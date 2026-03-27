# mainB.py — ESP32-WROOM-32D  (MicroPython)
# Build B hardware: 1× MCP3208-CI/P SPI ADC  (no I²C, no MUX)
#
# Differences from main.py (ADS1015 + 74HC4052 build):
#   • I²C + ADS1015 A/B replaced by SPI + single MCP3208 (cs GPIO5)
#   • 74HC4052 MUX removed entirely — all 8 columns wire directly to CH0–CH7
#   • Row GPIOs remapped to free GPIO18/19/23 for VSPI (same as mainA.py)
#   • Conversion wait eliminated — MCP3208 samples during the SPI clock cycle
#   • SCAN_PERIOD_MS 37→14, MAX_NOTIFY_HZ 25→50 (see timing note below)
#   • LSB_V based on VREF=3.3V/4096 counts instead of ADS1015 PGA
#   • hello packet carries "hw":"MCP3208" for app identification
#   • GPIO4 is unassigned / spare vs Build A (was CS_ADC_B)
#
# MCP3208 pinout used (PDIP-16):
#   CH0–CH7 → pins 1–8    DGND    → pin 9
#   VDD     → pin 16      CS/SHDN → pin 10  ← active LOW
#   VREF    → pin 15      D_IN    → pin 11  ← MOSI
#   AGND    → pin 14      D_OUT   → pin 12  ← MISO
#                         CLK     → pin 13
#
# Flash this file to the ESP32 as main.py

import time
import struct
import json
from micropython import const
from machine import Pin, SPI
import bluetooth

# ─────────────────────────────────────────
# NVS string helpers
# ─────────────────────────────────────────
_NVS_BUF_LEN = 64

def _nvs_set(ns, key, value: str):
    ns.set_blob(key, value.encode("utf-8"))

def _nvs_get(ns, key) -> str:
    buf = bytearray(_NVS_BUF_LEN)
    n   = ns.get_blob(key, buf)
    return buf[:n].decode("utf-8")

# ─────────────────────────────────────────
# UUID helper
# ─────────────────────────────────────────
def _mac_uuid() -> str:
    import network
    mac = network.WLAN().config("mac")
    b = bytearray(16)
    b[0:6] = mac
    b[6] = (b[6] & 0x0F) | 0x40
    b[8] = (b[8] & 0x3F) | 0x80
    h = "".join("%02x" % x for x in b)
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])

# ─────────────────────────────────────────
# Device identity — read from NVS
# ─────────────────────────────────────────
_DEVICE_UUID = ""
_DEVICE_ID   = "TS-UNKNOWN"
_DEVICE_NAME = "TS-UNKNOWN"
_FW_VERSION  = "0.0.0"
try:
    from esp32 import NVS
    _nvs = NVS("device")
    _DEVICE_ID  = _nvs_get(_nvs, "id")
    _FW_VERSION = _nvs_get(_nvs, "fw")
    try:
        _DEVICE_NAME = _nvs_get(_nvs, "name")
    except OSError:
        _DEVICE_NAME = _DEVICE_ID
    try:
        _DEVICE_UUID = _nvs_get(_nvs, "uuid")
    except OSError:
        _DEVICE_UUID = _mac_uuid()
        _nvs_set(_nvs, "uuid", _DEVICE_UUID)
        _nvs.commit()
        print("[boot] UUID generated:", _DEVICE_UUID)
except Exception:
    pass

DEVICE_NAME = _DEVICE_ID

# ─────────────────────────────────────────
# Hardware — Build B pin mapping
# ─────────────────────────────────────────
# SPI (VSPI defaults)
SPI_ID       = 2           # VSPI peripheral
SPI_CLK_HZ   = 1_000_000  # 1 MHz — safe at 3.3V; datasheet max ~1.8 MHz
SPI_CLK_PIN  = 18          # GPIO18 VSPI SCK
SPI_MISO_PIN = 19          # GPIO19 VSPI MISO  ← MCP3208 D_OUT
SPI_MOSI_PIN = 23          # GPIO23 VSPI MOSI  → MCP3208 D_IN
CS_PIN       = 5           # GPIO5  → MCP3208 CS/SHDN  ← boot pull-up ✓ (CS idle HIGH)
# GPIO4 is spare/unassigned in Build B

# Row drive GPIOs (R1–R12) — same remapping as Build A
ROW_PINS = [25, 26, 27, 32, 33, 13, 14, 12, 15, 21, 22, 2]
#            R1  R2  R3  R4  R5  R6  R7  R8  R9 R10 R11 R12
# ⚠ GPIO12/R8, GPIO15/R9, GPIO2/R12 are ESP32 boot-strap pins.
#   The 10 kΩ row pulldowns keep them LOW at boot — safe.
#   If GPIO2 causes boot issues, increase that pulldown to 47 kΩ.

# Column map: MCP3208 channel index → column number 1-8
# CH0→C1, CH1→C2, … CH7→C8  (direct 1-to-1 after +1 offset)
COLS = (1, 2, 3, 4, 5, 6, 7, 8)

# ─────────────────────────────────────────────────────────────────────────
# TIMING NOTE — Build B vs original ADS1015 build
# ─────────────────────────────────────────────────────────────────────────
# Original (I²C ADS1015 + 74HC4052):
#   12 rows × 4 MUX pos × (310 µs ADC conv + ~90 µs I²C×2 + 8 µs MUX settle)
#   = 48 reads × ~408 µs ≈ 19.6 ms busy + 4 ms FreeRTOS yields → ~37 ms/frame (27 Hz)
#
# Build B (SPI MCP3208, no MUX, single chip):
#   MCP3208 samples during the SPI clock — no separate conversion wait.
#   Per SPI read: 24 bits @ 1 MHz = 24 µs on-wire + ~40 µs MicroPython overhead ≈ 64 µs
#   12 rows × 8 reads × 64 µs ≈ 6.1 ms busy
#   + 5 µs row settle × 12 = 0.06 ms
#   + 4 × 1 ms FreeRTOS yields = 4 ms
#   ≈ 10.2 ms → theoretical ceiling ~98 Hz
#   With Python loop overhead (~3–4 ms): ~14 ms/frame → ~71 Hz realistically
#
#   vs Build A: timing is nearly identical — same 96 SPI reads per frame.
#   Build B has one fewer CS pin toggle per row (no cs_a→cs_b switch)
#   which saves ~2–4 µs/row → negligible difference in practice.
#
# To squeeze more speed: raise SPI_CLK_HZ to 1_800_000 and/or raise CPU
#   to 160 MHz in boot.py (machine.freq(160_000_000)).
# ─────────────────────────────────────────────────────────────────────────

HIT_THRESHOLD_V  = 0.10   # transmit hits >= this voltage
SCAN_PERIOD_MS   = 14     # ~71 Hz — see timing note above
MAX_NOTIFY_HZ    = 50     # BLE notify gate; real cap is ~30–40 Hz on most phones

ADV_INTERVAL_US  = 200_000
ADV_WATCHDOG_MS  = 2_000

ROW_SETTLE_US    = 5      # µs after asserting a row GPIO before sampling

# ─────────────────────────────────────────
# MCP3208 ADC constants
# ─────────────────────────────────────────
VREF_V     = 3.3
ADC_COUNTS = const(4096)         # 12-bit, 2^12
LSB_V      = VREF_V / ADC_COUNTS # ~0.000806 V per count  (0.806 mV)

# ─────────────────────────────────────────
# BLE — Nordic UART Service (NUS)
# ─────────────────────────────────────────
_UART_UUID    = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_TX_UUID = bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_RX_UUID = bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")

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
# Session gate
# ─────────────────────────────────────────
_scanning_enabled = False

# ─────────────────────────────────────────
# OTA state
# ─────────────────────────────────────────
_ota_active   = False
_ota_apply    = False
_ota_filename = "main_new.py"
_ota_size     = 0
_ota_buf      = []
_ota_new_fw   = "0.0.0"

# ─────────────────────────────────────────
# IRQ-safe command queue
# ─────────────────────────────────────────
_cmd_queue    = []
CMD_QUEUE_MAX = 8

def _irq_enqueue(raw_bytes):
    if len(_cmd_queue) < CMD_QUEUE_MAX:
        _cmd_queue.append(bytes(raw_bytes))

def _drain_cmd_queue(uart):
    global _scanning_enabled
    global _ota_active, _ota_apply, _ota_filename, _ota_size, _ota_buf, _ota_new_fw

    while _cmd_queue:
        raw = _cmd_queue.pop(0)
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception as e:
            print(f"[BLE] JSON parse error: {e}  raw={raw[:40]}")
            continue

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
                _ota_buf.append(ubinascii.a2b_base64(obj.get("data", "")))

        elif cmd == "ota_end":
            if _ota_active:
                _ota_active = False
                _ota_new_fw = obj.get("fw", "0.0.0")
                _ota_apply  = True
                print(f"[OTA] end — will apply as {_ota_filename}")

        elif cmd == "provision":
            new_name = obj.get("name", "")
            new_id   = obj.get("id",   "")
            if new_name or new_id:
                try:
                    from esp32 import NVS
                    _pnvs = NVS("device")
                    if new_name:
                        _nvs_set(_pnvs, "name", new_name)
                    if new_id:
                        _nvs_set(_pnvs, "id", new_id)
                    _pnvs.commit()
                    print(f"[BLE] provisioned name={new_name} id={new_id} — rebooting")
                    import machine
                    machine.reset()
                except Exception as pe:
                    print(f"[BLE] provision NVS error: {pe}")
        else:
            print(f"[BLE] unknown cmd: {cmd}")


def _adv_payload(name: str) -> bytearray:
    """
    Advertising payload with two AD structures:

    1. Complete Local Name (type 0x09)
       Visible in the OS device-name picker.

    2. Complete List of 128-bit UUIDs (type 0x07) — the NUS service UUID.
       Without this AD structure the device is INVISIBLE to any scanner
       using a service-UUID filter (Web Bluetooth, the app's BLE adapter, etc.).
       UUID is encoded little-endian as required by the BT spec.
    """
    # ── AD1: Complete Local Name ──────────────────────────────────────────
    n       = name.encode("utf-8")
    name_ad = bytes((len(n) + 1, 0x09)) + n

    # ── AD2: Complete list of 128-bit UUIDs — NUS service UUID ───────────
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
        self._ble.config(mtu=512)
        self._ble.irq(self._irq)

        ((self._tx_handle, self._rx_handle),) = \
            self._ble.gatts_register_services((_UART_SERVICE,))
        self._ble.gatts_set_buffer(self._rx_handle, 512)

        self._connections    = set()
        self._payload        = _adv_payload(name)
        self._is_advertising = False
        self._pending_hello  = False

        self._advertise()

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
                time.sleep_ms(250)
        self._is_advertising = False
        print("[BLE] advertising failed")

    def ensure_advertising(self):
        if not self.connected() and not self._is_advertising:
            self._advertise()

    def connected(self):
        return len(self._connections) > 0

    def notify(self, data: bytes):
        for h in list(self._connections):
            try:
                self._ble.gatts_notify(h, self._tx_handle, data)
            except Exception:
                pass

    def _irq(self, event, data):
        if event == _IRQ_CENTRAL_CONNECT:
            conn_handle, _, _ = data
            self._connections.add(conn_handle)
            self._is_advertising = False
            self._pending_hello  = True
            print("[BLE] central connected")

        elif event == _IRQ_CENTRAL_DISCONNECT:
            conn_handle, _, _ = data
            self._connections.discard(conn_handle)
            global _scanning_enabled
            _scanning_enabled = False
            print("[BLE] central disconnected → re-advertising")
            self._advertise()

        elif event == _IRQ_GATTS_WRITE:
            conn_handle, attr_handle = data
            raw = self._ble.gatts_read(self._rx_handle)
            _irq_enqueue(raw)

# ─────────────────────────────────────────
# Hardware init — SPI + CS pin + rows
# ─────────────────────────────────────────
spi = SPI(
    SPI_ID,
    baudrate  = SPI_CLK_HZ,
    polarity  = 0,          # CPOL=0: CLK idle LOW
    phase     = 0,          # CPHA=0: sample on rising edge (SPI Mode 0)
    sck       = Pin(SPI_CLK_PIN),
    mosi      = Pin(SPI_MOSI_PIN),
    miso      = Pin(SPI_MISO_PIN),
)

# Single CS pin — idle HIGH (chip deselected)
cs = Pin(CS_PIN, Pin.OUT, value=1)   # MCP3208  (C1–C8)

rows = [Pin(p, Pin.OUT) for p in ROW_PINS]
for r in rows:
    r.value(0)

# ─────────────────────────────────────────
# MCP3208 SPI read helper
# ─────────────────────────────────────────
# Pre-allocated transfer buffers — avoids per-call heap allocation in scan loop.
_CMD = bytearray(3)
_RSP = bytearray(3)

def mcp3208_read(channel):
    """
    Read one MCP3208 channel in single-ended mode.

    channel : 0–7
    returns : 12-bit count (0–4095)

    SPI frame (3 bytes, MSB first, Mode 0):
      TX byte 0: 0b00000 1 1 D2   (leading zeros, start=1, SGL=1, D2=ch bit2)
      TX byte 1: D1 D0 << 6       (D1=ch bit1, D0=ch bit0 in top 2 bits, rest zeros)
      TX byte 2: 0x00              (clock in the result)
    12-bit result: (RSP[1] & 0x0F) << 8 | RSP[2]
    """
    _CMD[0] = 0x06 | (channel >> 2)
    _CMD[1] = (channel & 0x03) << 6
    _CMD[2] = 0x00
    cs.value(0)
    spi.write_readinto(_CMD, _RSP)
    cs.value(1)
    return ((_RSP[1] & 0x0F) << 8) | _RSP[2]

# ─────────────────────────────────────────
# Matrix scan — returns hits above threshold
# ─────────────────────────────────────────
def scan_frame_hits(threshold_v=HIT_THRESHOLD_V):
    """
    Scan all 12×8 contacts via SPI.  No MUX switching — all 8 columns are
    wired directly to MCP3208 CH0–CH7.  Returns list of [row, col, mv_int].

    Yield strategy: sleep_ms(1) every 3 rows (same as main.py).
      4 yields × 1 ms = ~4 ms FreeRTOS overhead
      3 rows of busy-wait ≈ 3 × 0.57 ms ≈ 1.7 ms — far below 5 s TWDT
    """
    hits      = []
    threshold = int(threshold_v / LSB_V)   # counts threshold (pre-divide once)
    prev      = None

    for r_idx, rpin in enumerate(rows):
        if prev is not None:
            prev.value(0)
        rpin.value(1)
        prev = rpin

        if ROW_SETTLE_US:
            time.sleep_us(ROW_SETTLE_US)

        # ── MCP3208 — all columns C1–C8 (CH0–CH7) ────────────────────────
        for ch in range(8):
            counts = mcp3208_read(ch)
            if counts >= threshold:
                hits.append([r_idx + 1, COLS[ch], int(counts * LSB_V * 1000)])

        # Yield to FreeRTOS every 3 rows
        if r_idx % 3 == 2:
            time.sleep_ms(1)

    time.sleep_ms(1)   # final yield covers rows 10–12

    if prev is not None:
        prev.value(0)

    return hits

# ─────────────────────────────────────────
# Cell state tracker (unchanged from main.py)
# ─────────────────────────────────────────
_cell_state = {}

def cell_state_reset():
    global _cell_state
    _cell_state = {}

def scan_frame_tracked(threshold_v=HIT_THRESHOLD_V):
    """
    Wraps scan_frame_hits() with per-cell timing state.
    Returns: [[r, c, mv, t_first_ms, t_peak_ms, v_peak_mv, is_new], ...]
    """
    global _cell_state
    now_ms      = time.ticks_ms()
    raw_hits    = scan_frame_hits(threshold_v)
    active_keys = set()
    enriched    = []

    for r, c, mv in raw_hits:
        key = (r, c)
        active_keys.add(key)

        if key not in _cell_state:
            _cell_state[key] = {
                "t_first": now_ms,
                "t_last":  now_ms,
                "t_peak":  now_ms,
                "v_peak":  mv,
                "v_last":  mv,
            }
            is_new = 1
        else:
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
            mv,
            s_out["t_first"],
            s_out["t_peak"],
            s_out["v_peak"],
            is_new,
        ])

    for key in list(_cell_state):
        if key not in active_keys:
            del _cell_state[key]

    return enriched

# ─────────────────────────────────────────
# JSON sender (unchanged from main.py)
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
    print("=== BLE Matrix ESP32 — Build B (MCP3208×1) ===")
    ble = BLEUARTStreamer(name=DEVICE_NAME)

    last_scan      = time.ticks_ms()
    last_notify    = time.ticks_ms()
    last_adv_wdog  = time.ticks_ms()
    notify_min_interval = int(1000 / MAX_NOTIFY_HZ)

    while True:
        now = time.ticks_ms()

        _drain_cmd_queue(ble)

        if not ble.connected():
            if time.ticks_diff(now, last_adv_wdog) >= ADV_WATCHDOG_MS:
                last_adv_wdog = now
                ble._is_advertising = False
                ble.ensure_advertising()
            time.sleep_ms(20)
            continue

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
                _nvs_set(nv, "fw", _ota_new_fw)
                nv.commit()
                notify_json_chunked(ble, {
                    "type": "ota_ok",
                    "fw":   _ota_new_fw,
                    "uuid": _DEVICE_UUID,
                })
                for _ in range(12):
                    time.sleep_ms(50)
                import machine
                machine.reset()
            except Exception as e:
                notify_json_chunked(ble, {"type": "ota_err", "msg": str(e)})

        # FIX: hello is sent unconditionally on connect, BEFORE checking
        # _scanning_enabled. The app waits for hello before sending "start";
        # if hello were gated by _scanning_enabled, "start" would never arrive
        # and scanning would never begin (deadlock). Moving hello before the
        # scanning gate breaks the deadlock — matches the fix in main.py.
        if ble._pending_hello:
            ble._pending_hello = False
            notify_json_chunked(ble, {
                "type": "hello",
                "uuid": _DEVICE_UUID,
                "id":   _DEVICE_ID,
                "name": _DEVICE_NAME,
                "fw":   _FW_VERSION,
                "hw":   "MCP3208",      # Build B identifier
                "rows": 12,
                "cols": 8,
            })
            time.sleep_ms(20)
            continue

        if not _scanning_enabled:
            cell_state_reset()
            time.sleep_ms(20)
            continue

        if time.ticks_diff(now, last_scan) >= SCAN_PERIOD_MS:
            last_scan = now
            hits = scan_frame_tracked(HIT_THRESHOLD_V)

            if hits and time.ticks_diff(now, last_notify) >= notify_min_interval:
                last_notify = now
                notify_json_chunked(ble, {
                    "t":    now,
                    "n":    len(hits),
                    "hits": hits,
                })

        time.sleep_ms(2)

run()
