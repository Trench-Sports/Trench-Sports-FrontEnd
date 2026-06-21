# Model IV firmware — OTA security

Two independent layers protect the device. They solve different problems, so
ship both.

| Layer | Stops | Where the secret lives | Status |
|-------|-------|------------------------|--------|
| **OTA auth gate** (HMAC challenge-response) | Other BLE apps / drive-by writers from *initiating* an OTA or re-provisioning | Shared key, also embedded in the web app (public) | ✅ implemented in firmware + app |
| **Signed app images** | Anyone from running *tampered or unauthorized firmware* (malware / jailbreak) | Private signing key, server-side only — never in any client | ⚠️ config + key, enable before shipping |

The auth gate raises the bar but is **not** sufficient on its own: the web
bundle is public, so a determined attacker can extract the shared key. Image
authenticity is what actually blocks malware, and that comes from signed images,
because verification uses a *public* key on-device while only you hold the
*private* key. Treat the gate as access control and signing as the real lock.

---

## Layer 1 — OTA auth gate (already in this build)

Flow (handled automatically by the app's `runOta`):

```
app → {"cmd":"auth_begin"}
dev → {"type":"auth_chal","nonce":"<32 hex>"}     # 16 random bytes, per attempt
app → {"cmd":"auth","mac":"<64 hex>"}             # HMAC-SHA256(KEY, nonce)
dev → {"type":"auth_ok"} | {"type":"auth_err"}
```

`ota_start` and `provision` are refused unless the connection has passed this
exchange. The nonce is regenerated on every `auth_begin` and the authorization
is cleared on every BLE disconnect, so a captured `mac` can't be replayed on a
later connection.

### Set your own key (do this before production)

The default key is a placeholder (`TrenchSports-CHANGE-ME-IN-PROD!!`). Generate
a real 32-byte key and put the **same bytes** in both places:

```bash
# 32 random bytes as hex (64 chars)
openssl rand -hex 32
```

1. **Firmware** — `main/app_main.c`, `OTA_AUTH_KEY[32]`: paste the bytes as
   `0x..` values (or convert the hex). Rebuild + flash.
2. **Web app** — set `VITE_OTA_AUTH_SECRET=<the 64-hex string>` in the app's
   environment. The app falls back to the placeholder only if unset.

Keep the key out of git history. It's access control, not authenticity, so it's
acceptable for it to live in the (obfuscated) app bundle — but rotating it still
requires shipping a firmware build, so pick a real random value once.

---

## Layer 2 — Signed app images (the anti-malware lock)

This makes the bootloader **reject any OTA image not signed by your private
key**, without burning eFuses — so it's reversible (you can always USB-flash an
unsigned dev build) and far lower-risk than full Secure Boot. Enable it before
mass deployment.

### 1. Generate a signing key (keep it secret, off the device, out of git)

```bash
. $HOME/esp/esp-idf/export.sh
# ECDSA (scheme v1) works on every ESP32 silicon revision:
espsecure.py generate_signing_key --version 1 --scheme ecdsa256 ota_signing_key.pem
```

Store `ota_signing_key.pem` in your secrets manager. Anyone with it can sign
firmware the fleet will trust. Add it to `.gitignore`.

### 2. Turn on signed-OTA verification

`idf.py menuconfig → Security features`, then enable:

- **Require signed app images** (`CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT`)
- **Verify app signature on update** (`CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`)
- **App signing scheme → ECDSA** (matches the key above)
- **Secure boot private signing key** → `ota_signing_key.pem`

(Equivalent `sdkconfig.defaults` lines — verify names against your IDF version:)

```
CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y
CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y
CONFIG_SECURE_SIGNED_APPS_ECDSA_SCHEME=y
CONFIG_SECURE_BOOT_SIGNING_KEY="ota_signing_key.pem"
```

`idf.py build` now signs the app automatically, and `esp_ota_end()` verifies the
signature on every update — a tampered or unsigned `.bin` fails and never boots
(the running partition keeps working). No app-code change is needed; the
existing OTA flow stays the same.

### 3. Ship

```bash
./flash.sh /dev/cu.usbXXXX      # one-time USB to install the signed build
cp build/trench_scan.bin ../trench_scan.bin   # the served OTA image
# bump manifest.json "IV".version to match FW_VERSION_C, then deploy the web app
```

After that first cabled flash, every routine update — including this signed one
— goes out over the air.

---

## Optional, irreversible hardening (decide before deployment)

These burn eFuses and **cannot be enabled later over OTA** — only via USB, and
only once. Adopt only with a clear reason; mis-configuration can brick a unit.

- **Secure Boot v2** — also signs/verifies the *bootloader* (closes the "flash a
  malicious bootloader" gap that app-signing alone leaves). Needs ESP32 ECO3+.
- **Flash Encryption** — encrypts firmware/data at rest so a physical attacker
  can't dump or clone flash. Protects firmware IP; complicates debugging.
- **Anti-rollback** (`CONFIG_BOOTLOADER_APP_ANTI_ROLLBACK` + a secure version) —
  blocks downgrading to an older, vulnerable image. The eFuse counter has a
  limited number of increments, so only enable if downgrade attacks matter.

## Already in place (don't regress)

- **A/B OTA + app rollback**: a bad image stays unconfirmed until BLE works
  (`esp_ota_mark_app_valid_cancel_rollback()` only fires after the first hello),
  so a broken OTA auto-reverts on power cycle.
- **Brownout detector + watchdogs**: guard against power loss during flash.

The one rule that keeps you OTA-only: never ship an image that breaks BLE or the
mark-valid path. Keep the last known-good `.bin` as a recovery image.
