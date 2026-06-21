# Build B — Everything-in-C (ESP-IDF)

How to set up the C toolchain, build the firmware, and flash it onto the ESP32 —
replacing the MicroPython firmware. This folder contains the **full native-C
firmware (v1.0.0-c)** for the Build B hardware: scan core + BLE (Nordic UART,
same protocol as the MicroPython build) + LED1 RGB status. Verified on hardware
2026-06-11 at ~437 Hz scan rate; OTA is the documented next step (§8).

> **Do I need to remove MicroPython first? No.** MicroPython is itself a firmware
> image in the ESP32's flash. This C app is a *different* image — flashing it
> **overwrites** MicroPython. Nothing to uninstall, and it's fully reversible
> (re-flash the MicroPython `.bin` + your `.py` files to go back). The physical
> flashing procedure is identical to how you flash MicroPython today (same USB
> serial port, same auto-reset via the CP2102N's DTR/RTS, same bootloader).

---

## ⚠️ 0. Path must contain NO spaces

ESP-IDF's build system (CMake) **fails on spaces in the project path**. This folder
was renamed from "Everything in C" to `Everything-in-C` for exactly that reason, so
you can build **in place** — no copy needed:

```bash
cd ~/Trench-Sports-main/Components/Electronics/ESP32/Everything-in-C
```

(If you ever move this project, keep the full path space-free.)

---

## 1. Prerequisites (one-time, macOS)

```bash
# Tools ESP-IDF needs
brew install cmake ninja dfu-util python3

# Get ESP-IDF (v5.2 or newer) and install the ESP32 toolchain
mkdir -p ~/esp && cd ~/esp
git clone -b v5.2.1 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
./install.sh esp32
```

(Linux is the same after `sudo apt install git wget flex bison gperf python3 python3-venv
cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0`. On Windows use the
ESP-IDF Installer + the "ESP-IDF PowerShell" environment.)

### Activate the toolchain (every new terminal)

```bash
. ~/esp/esp-idf/export.sh      # note the leading dot + space
```

After this, `idf.py` is on your PATH. You must re-run `export.sh` in each new shell.

---

## 2. Build

```bash
cd ~/Trench-Sports-main/Components/Electronics/ESP32/Everything-in-C
idf.py set-target esp32        # first build only
idf.py build
```

First build downloads/compiles a lot and takes a few minutes; later builds are fast.

> **After pulling changes to `sdkconfig.defaults`** (e.g. the BLE/partition-table
> update), regenerate the config once before building:
>
> ```bash
> rm -f sdkconfig && idf.py fullclean
> ```

---

## 3. Find your serial port

It's the **same port you use to flash MicroPython**. To list:

```bash
ls /dev/cu.*
```

- CP2102 / CP2102N (our USB-C front-end): `/dev/cu.usbserial-XXXX` or `/dev/cu.SLAB_USBtoUART`
- CH340: `/dev/cu.wchusbserial-XXXX`

---

## 4. Flash + watch the output

```bash
idf.py -p /dev/cu.usbserial-0001 flash monitor
```

`flash` builds (if needed) and writes the firmware; `monitor` opens the serial console.
Your CP2102N auto-reset puts the chip into download mode automatically — no button
needed. (No auto-reset wired? Hold **IO0** low, tap **EN**, then release IO0.)

Expected console output (replaces the MicroPython REPL):

```
I (328) trench: Trench Sports Build B — native C (scan + BLE + LED) 1.0.0-c
I (335) trench: identity: id=TS-XXXX name=TS-XXXX fw=... uuid=...
I (498) trench: [BLE] advertising as 'TS-XXXX'
I (510) trench: threshold = 124 counts; scan task on core 1
```

LED1 pulses **blue** while advertising. After the app connects (LED goes **green**)
and sends `{"cmd":"start"}`, the 1 Hz rate report appears (measured ~437 Hz on
hardware, vs ~120 Hz MicroPython):

```
I (193005) trench: scan rate: 437 Hz   (scanning=1, buffered=0)
```

Hits flash the LED **red** and stream as `batch` JSON packets to the app.

Exit the monitor with **Ctrl-]**.

Helper script (does set-target + build + flash + monitor):

```bash
./flash.sh /dev/cu.usbserial-0001
```

---

## 5. The files that actually get flashed

`idf.py build` produces three images; `idf.py flash` writes all three at these offsets:

| File (under `build/`) | Flash offset | What it is |
|-----------------------|--------------|------------|
| `bootloader/bootloader.bin` | `0x1000` | 2nd-stage bootloader |
| `partition_table/partition-table.bin` | `0x8000` | partition map |
| `trench_scan.bin` | `0x10000` | the application (our scan core) |

Manual equivalent with `esptool` (what `idf.py flash` runs under the hood):

```bash
esptool.py --chip esp32 -p /dev/cu.usbserial-0001 -b 460800 write_flash \
  0x1000  build/bootloader/bootloader.bin \
  0x8000  build/partition_table/partition-table.bin \
  0x10000 build/trench_scan.bin
```

`idf.py` prints the exact offsets/filenames at the end of every build, so use those if
you change the partition layout.

---

## 6. (Optional) Wipe MicroPython's leftovers first

Overwriting is enough, but to start clean:

```bash
idf.py -p /dev/cu.usbserial-0001 erase-flash    # or: esptool.py ... erase_flash
```

> ⚠️ **`erase-flash` wipes the entire flash, including NVS** — that's where your
> MicroPython `boot.py`/`main.py` stored device identity (UUID, `id`, `fw`) and the
> `power` settings. Back those values up first if you need them; the C build will need
> to re-provision identity. If you don't erase, the old filesystem just becomes unused
> space and the app still runs fine.

---

## 7. Going back to MicroPython (reversible)

```bash
esptool.py --chip esp32 -p /dev/cu.usbserial-0001 erase_flash
esptool.py --chip esp32 -p /dev/cu.usbserial-0001 --baud 460800 \
  write_flash -z 0x1000 ESP32_GENERIC-vX.Y.Z.bin
# then re-upload boot.py / main.py with mpremote as before
```

---

## 8. What's here vs. what's still to build

**Here now (v1.0.0-c):** the full port — scan core on core 1 (no-DMA polling SPI,
the fix for the 239 Hz benchmark result), **NimBLE Nordic-UART BLE** with the same
UUIDs + JSON protocol as `../Live/main.py` (`hello` on subscribe, `batch` packets,
`start`/`stop`/`provision` commands, `Cnn/NN:` chunking), **NVS identity** from the
same `device` namespace MicroPython used (id/name/uuid survive the firmware swap),
and **LED1 RGB status** on GPIO4/16/17: blue pulse = advertising, solid green =
connected, red flash = hit.

> After pulling these changes, regenerate the build config once:
> `rm -f sdkconfig && idf.py fullclean` — `sdkconfig.defaults` now enables NimBLE,
> -O2, 4 MB flash, and the large single-app partition table (NVS stays at 0x9000,
> so device identity is preserved).

**Also here (v1.1.0-c): BLE OTA.** Same JSON protocol as MicroPython, but it now
flashes a real firmware image into the inactive A/B slot (`partitions.csv`:
`ota_0`/`ota_1`, NVS untouched at 0x9000):

1. App sends `{"cmd":"ota_start","size":<bytes>}` — size of `build/trench_scan.bin`
2. App streams `{"cmd":"ota_chunk","data":"<base64>"}` writes (use ≤509-byte write
   payloads; decoded chunks go straight to flash)
3. App sends `{"cmd":"ota_end","fw":"1.2.0-c"}` → device validates the image,
   replies `{"type":"ota_ok","fw":...,"uuid":...}`, and reboots into the new slot

Failures reply `{"type":"ota_err","msg":...}` and abort safely. **Rollback:** a
freshly OTA'd image stays "pending verify" until it completes its first BLE
hello (connect + subscribe); if the new firmware can't get that far, the next
reset/power-cycle boots the previous image. So after an OTA, reconnect once to
confirm the update before power-cycling. Bump `FW_VERSION_C` in `app_main.c`
for every release so `hello` reports the running version.

> **One-time migration:** the A/B partition table requires one final USB flash
> (`rm -f sdkconfig && idf.py fullclean`, then `./flash.sh <port>`). Device
> identity in NVS is preserved. All updates after that can go over BLE.

**Still to build:**

1. **Watchdog** — TWDT is still off; scanning saturates core 1 by design. Re-enable
   `CONFIG_ESP_TASK_WDT_INIT=y` + feed it from the scan loop if you want the safety net.
2. **Binary packets** — JSON is kept for app compatibility; a packed binary format
   would cut BLE airtime ~5×.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `idf.py: command not found` | Run `. ~/esp/esp-idf/export.sh` in this shell |
| CMake error mentioning the path / spaces | A directory in the project path has a space — keep the whole path space-free (step 0) |
| BLE/LED missing after build | Stale config from the pre-BLE build — `rm -f sdkconfig && idf.py fullclean`, rebuild |
| `Failed to connect ... Wrong boot mode` | Auto-reset didn't engage; hold IO0 low + tap EN, or check DTR/RTS wiring |
| Port not found | Install the CP2102/CH340 driver; check `ls /dev/cu.*` |
| Resets every ~5 s | Task watchdog — it's OFF in `sdkconfig.defaults` for the benchmark; if you re-enabled it, add a periodic `vTaskDelay` |
| Garbage in monitor | Baud mismatch — IDF monitor defaults to 115200; that's already set |
