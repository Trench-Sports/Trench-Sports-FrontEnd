# bootB.py — ESP32 MicroPython
# Model III / batch-scan hardware
# Flash this as: boot.py

import machine
import time

# ── CPU frequency ────────────────────────────────────────────────────────
# Raised from 80 MHz → 160 MHz to support batch scan mode (~120 Hz).
# At 160 MHz Python loop overhead drops from ~3–4 ms to ~1.5–2 ms per frame,
# pushing scan rate from ~71 Hz to ~120 Hz.
# Power draw is higher than 80 MHz but still well below 240 MHz default.
# If battery life is more critical than scan rate, revert to 80_000_000
# and increase SCAN_PERIOD_MS in mainB.py.
machine.freq(160_000_000)

# ── Disable brown-out detector ──────────────────────────────────────────
# The ESP32 resets itself if VIN droops below ~2.43V even momentarily.
# During BLE radio bursts on a weak supply this can trip repeatedly.
# Disabling it lets the firmware handle weak supply behavior more gracefully.
try:
    from esp32 import NVS
    nvs = NVS("power")
    nvs.set_i32("bod_off", 1)
    nvs.commit()
except Exception:
    pass  # Safe to skip on builds without NVS support

# ── Device identity — write once, persist across reboots ────────────────
# Uses a separate "device" namespace.
# Re-flashing bootB.py will not overwrite an already provisioned device.
#
# To provision manually later:
#   from esp32 import NVS
#   n = NVS("device")
#   n.set_blob("id", b"TS-XXX")
#   n.set_blob("fw", b"1.0.0")
#   n.commit()
try:
    from esp32 import NVS
    _nvs_dev = NVS("device")
    _check_buf = bytearray(64)
    try:
        _nvs_dev.get_blob("id", _check_buf)   # raises OSError if absent
    except OSError:
        # First boot on this unit — write defaults
        _nvs_dev.set_blob("id", b"TS-001")    # ← change per unit before flashing
        _nvs_dev.set_blob("fw", b"1.0.0")     # ← set to current firmware version
        _nvs_dev.commit()
        print("[bootB] device identity initialised in NVS")
except Exception:
    pass  # mainB.py will fall back to defaults if NVS is unavailable

# ── Longer power-rail settle time ───────────────────────────────────────
# LiPo through a regulator takes longer to stabilise than USB.
time.sleep_ms(800)

# ── Boot main.py with retry loop ────────────────────────────────────────
# On the batch build, main.py should be your Model III / batch firmware.
MAX_RETRIES = 5

for attempt in range(1, MAX_RETRIES + 1):
    try:
        print(f"[bootB] attempt {attempt}/{MAX_RETRIES} — starting main.py")
        import main
        break
    except Exception as e:
        print(f"[bootB] error: {repr(e)}")
        if attempt < MAX_RETRIES:
            print("[bootB] retrying in 3s...")
            time.sleep_ms(3000)
        else:
            print("[bootB] all retries failed — halting.")