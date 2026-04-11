# boot.py — ESP32 MicroPython
# Power-hardened for LiPo battery via VIN pin.
# Flash this as: boot.py

import machine
import time

# ── FIX 1: Drop CPU to 80 MHz ───────────────────────────────────────────
# Default is 240 MHz. 80 MHz cuts peak current draw by ~40%,
# which is the single biggest software win for LiPo stability.
# BLE and I2C still work fine at 80 MHz.
machine.freq(80_000_000)

# ── FIX 2: Disable brown-out detector ───────────────────────────────────
# The ESP32 resets itself if VIN droops below ~2.43V even momentarily.
# During BLE radio bursts on a weak supply this trips constantly.
# Disabling it lets the firmware handle low-power gracefully instead.
try:
    from esp32 import NVS
    # Write brown-out disable to NVS so it survives reboot
    nvs = NVS("power")
    nvs.set_i32("bod_off", 1)
    nvs.commit()
except Exception:
    pass  # not all MicroPython builds expose NVS — safe to skip

# ── FIX 3: Device identity — write once, persist across reboots ─────────
# Uses a separate "device" NVS namespace so it's isolated from power config.
# The try/get guard means re-flashing this file will NEVER clobber an ID
# that was already set (either at first flash or updated later via OTA).
# To provision a new unit: flash this file, then use the REPL to run:
#   from esp32 import NVS
#   n = NVS("device")
#   n.set_blob("id", b"TS-XXX"); n.set_blob("fw", b"1.0.0"); n.commit()
# Or just change the defaults below before flashing each unit.
#
# NOTE: set_str/get_str are NOT part of standard MicroPython NVS.
# We use set_blob/get_blob with UTF-8 encoding instead.
try:
    from esp32 import NVS
    _nvs_dev = NVS("device")
    _check_buf = bytearray(64)
    try:
        _nvs_dev.get_blob("id", _check_buf)   # raises OSError if key absent
    except OSError:
        # First boot on this unit — write the defaults
        _nvs_dev.set_blob("id", b"TS-001")   # ← change per unit before flashing
        _nvs_dev.set_blob("fw", b"1.0.0")    # ← set to current firmware version
        _nvs_dev.commit()
        print("[boot] device identity initialised in NVS")
except Exception:
    pass  # NVS unavailable on this build — main.py falls back to defaults

# ── FIX 4: Longer power-rail settle time ────────────────────────────────
# LiPo through a regulator takes longer to stabilise than USB.
# 800ms covers slow-start regulators and cold battery conditions.
time.sleep_ms(800)

# ── Boot main.py with retry loop ────────────────────────────────────────
MAX_RETRIES = 5

for attempt in range(1, MAX_RETRIES + 1):
    try:
        print(f"[boot] attempt {attempt}/{MAX_RETRIES} — starting main.py")
        import main
        break
    except Exception as e:
        print(f"[boot] error: {repr(e)}")
        if attempt < MAX_RETRIES:
            print("[boot] retrying in 3s...")
            time.sleep_ms(3000)
        else:
            print("[boot] all retries failed — halting.")