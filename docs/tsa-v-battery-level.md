# TSA-V battery level — hardware, firmware, app

Status as of 2026-09-27. One feature spans three places; this is the page that keeps
them aligned. Firmware source lives in the hardware repo
(`Trench-Sports-main/Components/Electronics/TSA-V/Everything-in-C`), not in this repo.

| Layer | Where | State |
|---|---|---|
| Hardware | Rev C board, J3 + charge/boost module | Wired and measured on TS-003 |
| Firmware | `main/app_main.c`, **1.4.4-c** | Running on TS-003; **not in the OTA manifest** |
| App | `src/bluetooth/battery.ts`, `src/components/batteryBadge.tsx` | Builds and typechecks; not yet tested against a live bag |

## Hardware

The bag runs from a single 18650 through a generic "2A 5V charge-discharge integrated"
module (charger + boost + protection). USB-C on the TSA-V board is **data only** — it
cannot power the board.

| Module pad | Carries | Goes to |
|---|---|---|
| OUT+ | boosted 5 V — the board's only supply | **J3.1** (+5V) |
| OUT− | ground | **J3.2** (GND) |
| **B+** | raw cell, 3.0–4.2 V | **J3.3** (BAT+ sense) |

J3.3 is sense-only: R30/R31 (100k/100k) halve it onto GPIO35 (ADC1_CH7), drawing ~21 µA.

> **Wiring trap, hit on TS-003:** J3.3 on the module's **OUT+** instead of **B+** reads a
> constant ~5.1 V. Firmware now reports that as unknown with a serial warning rather than
> "100 %", but the fix is the wire.

> **Power trap:** with the module switched off the board still limps on leakage — the USB
> bridge enumerates and flashing works, then the app browns out ~470 ms into boot. The
> module must be **on** for the board to run. For flashing, a bench 5 V on J3.1 is more
> reliable: in download mode the board draws little and the module may auto-off mid-flash.

## Firmware (1.4.4-c)

- GPIO35 sampled at 1 Hz from `scan_task` between frames: 16-sample burst → IIR (α 1/16,
  ~16 s) → 1S LiPo voltage curve → percent with ±2 % hysteresis.
- Out-of-range readings report **null**, never a number:
  - `< 2500 mV` — no cell on J3.3 (e.g. a bench board)
  - `> 4350 mV` — J3.3 is on a 5 V rail (wiring fault)
- Serial: `[BATT] <mV> <pct>%` at boot, `batt ...` every 10 s.

### BLE protocol (NUS JSON, NDJSON-framed)

```json
{"type":"hello", "...": "...", "batt_mv":4074, "batt_pct":84}
{"type":"batt", "t":30512, "batt_mv":4071, "batt_pct":84}
{"type":"batt", "t":60512, "batt_mv":null, "batt_pct":null}
```

`hello` carries the level on connect; `batt` repeats every 30 s (held during OTA). Older
firmware sends neither field.

## App

`parseBatteryPct()` in `src/bluetooth/battery.ts` returns one of three values:

| Return | Meaning | App action |
|---|---|---|
| `undefined` | frame has no battery field (older firmware) | leave the reading alone |
| `null` | device says unknown | clear the reading, hide the badge |
| `0–100` | level | show it |

- **Badge** (`BatteryBadge`) on the primary bag header and every multi-bag slot row, on
  desktop session, mobile session and mobile home. Green ≥ 50, amber 20–49, red < 20.
- **Warning** (`LowBatteryBanner`) at ≤ 15 %, escalating to critical at ≤ 5 %. Shown
  during sessions too. Dismissing "low" re-raises at "critical"; nothing re-raises
  downward.

## Bench record

TS-003 (MAC 88:f1:55:94:a0:6c), 2026-09-27, cell fully charged:

| Check | Result |
|---|---|
| J3.3 before rewire (on OUT+) | ~5.1 V — wiring fault |
| J3.3 after rewire (on B+), read via ROM-mode ADC | 4.06 V |
| 1.4.4-c boot | 1 boot, 0 brownouts |
| 1.4.4-c reading | 4074 mV, 84 %; 4071–4073 mV over 20 s |
| Accelerometer rate | 441 Hz, unchanged |

## Open before OTA release

1. **Meter check:** B+ to OUT− vs the serial `batt` line. C7 sits ~19 mm from GPIO35,
   which the Rev C readiness review predicts reads low; a full cell showing 84 % agrees.
   If the gap is > ~50 mV, add a per-board trim stored in NVS.
2. **App test:** connect TS-003 and confirm the badge, and the 30 s update.
3. **Release:** only then add 1.4.4-c to `public/firmware/manifest.json` (`models.V`) with
   the `.bin`. Merging that offers the update to every model V bag in the field.

Not in scope yet: charging state from GPIO39 `/USB_DET`, a device-side low-battery LED,
and GATT Battery Service (0x180F).
