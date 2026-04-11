# mainB.py — ESP32-WROOM-32D  (MicroPython)
# Model III hardware: 1× MCP3208-CI/P SPI ADC  (no I2C, no MUX)
#
# Flash this file to the ESP32 as main.py

import time
import struct
import json
from micropython import const
from machine import Pin, SPI
import bluetooth

# ---------------------------------------------------------
# NVS string helpers
# ---------------------------------------------------------
_NVS_BUF_LEN = 64

def _nvs_set(ns, key, value: str):
    ns.set_blob(key, value.encode("utf-8"))

def _nvs_get(ns, key) -> str:
    buf = bytearray(_NVS_BUF_LEN)
    n   = ns.get_blob(key, buf)
    return buf[:n].decode("utf-8")

# ---------------------------------------------------------
# UUID helper
# ---------------------------------------------------------
def _mac_uuid() -> str:
    import network
    mac = network.WLAN().config("mac")
    b = bytearray(16)
    b[0:6] = mac
    b[6] = (b[6] & 0x0F) | 0x40
    b[8] = (b[8] & 0x3F) | 0x80
    h = "".join("%02x" % x for x in b)
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])

# ---------------------------------------------------------
# Device identity — read from NVS
# ---------------------------------------------------------
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

# ---------------------------------------------------------
# Hardware — Model III pin mapping
# ---------------------------------------------------------
SPI_ID       = 2
SPI_CLK_HZ   = 1_800_000
SPI_CLK_PIN  = 18
SPI_MISO_PIN = 19
SPI_MOSI_PIN = 23
CS_PIN       = 5

ROW_PINS = [25, 26, 27, 32, 33, 13, 14, 12, 15, 21, 22, 2]

COLS = (1, 2, 3, 4, 5, 6, 7, 8)

# ---------------------------------------------------------
# Timing / streaming config
# ---------------------------------------------------------
HIT_THRESHOLD_V  = 0.10
SCAN_PERIOD_MS   = 8       # ~120 Hz internal scan rate
MAX_NOTIFY_HZ    = 40      # BLE notify ceiling
BATCH_SIZE       = 3
FIRST_HIT_FLUSH  = True

ADV_INTERVAL_US  = 200_000
ADV_WATCHDOG_MS  = 2_000

ROW_SETTLE_US    = 5

# ---------------------------------------------------------
# MCP3208 ADC constants
# ---------------------------------------------------------
VREF_V     = 3.3
ADC_COUNTS = const(4096)
LSB_V      = VREF_V / ADC_COUNTS

# ---------------------------------------------------------
# BLE — Nordic UART Service (NUS)
# ---------------------------------------------------------
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

# ---------------------------------------------------------
# Session gate
# ---------------------------------------------------------
_scanning_enabled = False

# ---------------------------------------------------------
# OTA state
# ---------------------------------------------------------
_ota_active   = False
_ota_apply    = False
_ota_filename = "main_new.py"
_ota_size     = 0
_ota_buf      = []
_ota_new_fw   = "0.0.0"

# ---------------------------------------------------------
# IRQ-safe command queue
# ---------------------------------------------------------
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
            print("[BLE] cmd=start -> scanning enabled")

        elif cmd == "stop":
            _scanning_enabled = False
            print("[BLE] cmd=stop  -> scanning paused")

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
            new_id   = obj.get("id", "")
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
    n       = name.encode("utf-8")
    name_ad = bytes((len(n) + 1, 0x09)) + n

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
            _frame_buf.clear()   # discard any buffered frames so they don't
                                 # flush as the first batch of a reconnected session
            print("[BLE] central disconnected -> re-advertising")
            self._advertise()

        elif event == _IRQ_GATTS_WRITE:
            conn_handle, attr_handle = data
            raw = self._ble.gatts_read(self._rx_handle)
            _irq_enqueue(raw)

# ---------------------------------------------------------
# Hardware init — SPI + CS pin + rows
# ---------------------------------------------------------
spi = SPI(
    SPI_ID,
    baudrate  = SPI_CLK_HZ,
    polarity  = 0,
    phase     = 0,
    sck       = Pin(SPI_CLK_PIN),
    mosi      = Pin(SPI_MOSI_PIN),
    miso      = Pin(SPI_MISO_PIN),
)

cs = Pin(CS_PIN, Pin.OUT, value=1)

rows = [Pin(p, Pin.OUT) for p in ROW_PINS]
for r in rows:
    r.value(0)

# ---------------------------------------------------------
# MCP3208 SPI read helper
# ---------------------------------------------------------
_CMD = bytearray(3)
_RSP = bytearray(3)

def mcp3208_read(channel):
    _CMD[0] = 0x06 | (channel >> 2)
    _CMD[1] = (channel & 0x03) << 6
    _CMD[2] = 0x00
    cs.value(0)
    spi.write_readinto(_CMD, _RSP)
    cs.value(1)
    return ((_RSP[1] & 0x0F) << 8) | _RSP[2]

# ---------------------------------------------------------
# Matrix scan — returns hits above threshold
# ---------------------------------------------------------
def scan_frame_hits(threshold_v=HIT_THRESHOLD_V):
    hits      = []
    threshold = int(threshold_v / LSB_V)
    prev      = None

    for r_idx, rpin in enumerate(rows):
        if prev is not None:
            prev.value(0)
        rpin.value(1)
        prev = rpin

        if ROW_SETTLE_US:
            time.sleep_us(ROW_SETTLE_US)

        for ch in range(8):
            counts = mcp3208_read(ch)
            if counts >= threshold:
                hits.append([r_idx + 1, COLS[ch], int(counts * LSB_V * 1000)])

        if r_idx % 3 == 2:
            time.sleep_us(500)

    time.sleep_us(500)

    if prev is not None:
        prev.value(0)

    return hits

# ---------------------------------------------------------
# Cell state tracker
# ---------------------------------------------------------
_cell_state = {}

def cell_state_reset():
    global _cell_state
    _cell_state = {}

def scan_frame_tracked(threshold_v=HIT_THRESHOLD_V):
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

# ---------------------------------------------------------
# JSON sender — max_len raised to 400 bytes
# ---------------------------------------------------------
def notify_json_chunked(uart: BLEUARTStreamer, obj, max_len=400):
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

# ---------------------------------------------------------
# Frame buffer — module scope so the BLE disconnect IRQ can clear it
# ---------------------------------------------------------
_frame_buf = []

# ---------------------------------------------------------
# Batch flush helper
# ---------------------------------------------------------
def _flush_batch(uart, frame_buffer):
    notify_json_chunked(uart, {
        "type":   "batch",
        "frames": frame_buffer,
    })
    frame_buffer.clear()

# ---------------------------------------------------------
# Main loop
# ---------------------------------------------------------
def run():
    global _ota_apply, _frame_buf
    print("=== BLE Matrix ESP32 — Model III (batch mode) ===")
    ble = BLEUARTStreamer(name=DEVICE_NAME)

    last_scan      = time.ticks_ms()
    last_notify    = time.ticks_ms()
    last_adv_wdog  = time.ticks_ms()
    notify_min_ms  = int(1000 / MAX_NOTIFY_HZ)

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
                    "hw":   "III",
                })
                for _ in range(12):
                    time.sleep_ms(50)
                import machine
                machine.reset()
            except Exception as e:
                notify_json_chunked(ble, {
                    "type": "ota_err",
                    "msg":  str(e),
                    "hw":   "III",
                })

        if ble._pending_hello:
            ble._pending_hello = False
            notify_json_chunked(ble, {
                "type": "hello",
                "uuid": _DEVICE_UUID,
                "id":   _DEVICE_ID,
                "name": _DEVICE_NAME,
                "fw":   _FW_VERSION,
                "hw":   "III",
                "rows": 12,
                "cols": 8,
                "mode": "batch",
                "batch_size": BATCH_SIZE,
            })
            time.sleep_ms(20)
            continue

        if not _scanning_enabled:
            cell_state_reset()
            _frame_buf.clear()
            time.sleep_ms(20)
            continue

        if time.ticks_diff(now, last_scan) >= SCAN_PERIOD_MS:
            last_scan = now
            hits = scan_frame_tracked(HIT_THRESHOLD_V)

            if hits:
                _frame_buf.append({"t": now, "hits": hits})

                has_new = FIRST_HIT_FLUSH and any(h[6] == 1 for h in hits)
                can_notify = time.ticks_diff(now, last_notify) >= notify_min_ms

                if can_notify and (has_new or len(_frame_buf) >= BATCH_SIZE):
                    last_notify = now
                    _flush_batch(ble, _frame_buf)

            else:
                if _frame_buf and time.ticks_diff(now, last_notify) >= notify_min_ms:
                    last_notify = now
                    _flush_batch(ble, _frame_buf)

        time.sleep_ms(1)

run()