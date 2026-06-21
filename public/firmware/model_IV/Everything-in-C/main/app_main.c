// app_main.c — Trench Sports Build B — native C firmware (scan + BLE + LED)
// ESP-IDF v5.2.  Full C port of ../../Live/main.py (batch mode v2).
//
// WHAT THIS DOES
//   • 12 x 8 matrix scan via MCP3208 on VSPI (no-DMA polling — fast for 3-byte
//     frames), free-running on core 1.
//   • BLE: NimBLE Nordic UART Service, same UUIDs / JSON protocol as the
//     MicroPython build — "hello" on subscribe, "batch" frame packets,
//     {"cmd":"start"|"stop"|"provision"} commands. OTA cmds answered with
//     ota_err (firmware OTA for the C build comes later via esp_ota).
//   • Device identity read from the SAME NVS namespace/keys MicroPython used
//     ("device": id/name/fw/uuid) — identity survives the firmware swap.
//   • LED1 (CHANZON RGB, common cathode) on GPIO4/16/17 via LEDC PWM:
//       blue pulse = advertising, solid green = connected, red flash = hit.
//     Multi-bag: the app can override the "connected" color via
//       {"cmd":"led","r":..,"g":..,"b":..}  (0..255 per channel; scaled to a
//     comfortable brightness) so a coach can tell paired bags apart by color.
//     {"cmd":"led","off":true} restores the default green/blue/red states.
//
// PIN MAP — identical to Live/main.py + Schematics_BuildB
//   Rows R1..R12 : GPIO 25,26,27,32,33,13,14,12,15,21,22,2
//   VSPI         : CLK=18  MISO=19(D_OUT)  MOSI=23(D_IN)   CS/SHDN=5
//   LED1         : R=GPIO4(150R)  G=GPIO16(100R)  B=GPIO17(100R)  → GND

#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <assert.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "driver/ledc.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "esp_ota_ops.h"
#include "esp_random.h"
#include "mbedtls/base64.h"
#include "mbedtls/md.h"

// NimBLE
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "trench";

// ── Build B hardware constants ─────────────────────────────────────────────
#define PIN_CLK         18
#define PIN_MISO        19
#define PIN_MOSI        23
#define PIN_CS          5
#define SPI_HZ          1800000          // MCP3208 max at VDD = 3.3 V

#define NROWS           12
#define NCOLS           8
static const int ROW_PINS[NROWS] = {25,26,27,32,33,13,14,12,15,21,22,2};

#define PIN_LED_R       4                // 150 Ω
#define PIN_LED_G       16               // 100 Ω
#define PIN_LED_B       17               // 100 Ω

#define VREF_MV         3300
#define ADC_COUNTS      4096
#define HIT_THRESHOLD_V 0.10f
#define ROW_SETTLE_US   5

// ── Protocol constants (match Live/main.py) ────────────────────────────────
#define BATCH_SIZE      3                // frames per normal flush
#define MAX_NOTIFY_HZ   40               // BLE notify gate
#define SCAN_HZ_NOMINAL 400              // typical matrix scan rate (reported in hello until measured)
#define FIRST_HIT_FLUSH 1                // flush immediately on new contact
#define MAX_BUF_FRAMES  8                // hard cap (force-flush when full)
#define NOTIFY_MAX_LEN  400              // MicroPython max_len
#define FW_VERSION_C    "1.4.0-c"        // fw reported in hello — bump per release (1.4.0: identity LED + OTA auth gate)
#define HW_REV          "IV"             // hw reported in hello (matches manifest.json key + app SCAN_PROFILES)

// ── Globals ────────────────────────────────────────────────────────────────
static spi_device_handle_t s_adc;

static char s_dev_id[64]   = "TS-UNKNOWN";
static char s_dev_name[64] = "TS-UNKNOWN";
static char s_dev_fw[64]   = FW_VERSION_C;
static char s_dev_uuid[40] = "";

// ── OTA / provisioning auth ────────────────────────────────────────────────
// Challenge-response gate: the app must prove knowledge of OTA_AUTH_KEY before
// the device accepts `ota_start` or `provision`. Flow:
//     app → {"cmd":"auth_begin"}
//     dev → {"type":"auth_chal","nonce":"<32 hex>"}      (16 random bytes)
//     app → {"cmd":"auth","mac":"<64 hex>"}              HMAC-SHA256(KEY, nonce)
//     dev → {"type":"auth_ok"} | {"type":"auth_err"}
// Must stay byte-identical to the web app's VITE_OTA_AUTH_SECRET (same 32 bytes,
// hex). This stops other BLE apps and drive-by writers from initiating an OTA.
// It is NOT image authenticity — the web bundle is public — so pair it with
// signed images (see SECURITY.md). To rotate: openssl rand -hex 32, then update
// both this array and VITE_OTA_AUTH_SECRET, rebuild firmware, redeploy app.
static const uint8_t OTA_AUTH_KEY[32] = {
    0x5e,0xe2,0xbe,0xab,0xb6,0xb9,0x6a,0xdd,0x6a,0x15,0xc2,0xbc,0xbe,0xf9,0xa0,0x8e,
    0xff,0x57,0x07,0x78,0xc6,0x0c,0xfe,0x0f,0x29,0xe3,0xa8,0x72,0x79,0x35,0x24,0x87,
};
static volatile bool s_authed = false;     // true once this connection passes auth
static uint8_t       s_nonce[16];           // current challenge (per auth_begin)

static volatile uint16_t s_conn        = BLE_HS_CONN_HANDLE_NONE;
static volatile bool     s_notify_on   = false;
static volatile bool     s_pending_hello = false;
static volatile bool     s_scanning    = false;
static volatile uint16_t s_att_mtu     = 23;
static volatile uint32_t s_last_hit_ms = 0;
static volatile uint32_t s_scan_hz     = 0;     // last measured scan rate (Hz); 0 until first 1 s window

static uint16_t s_tx_handle;             // NUS TX char value handle
static uint8_t  s_own_addr_type;

static QueueHandle_t s_cmd_q;            // raw JSON command strings
// 532: BLE write payload can be up to MTU-3 = 509 B (ota_chunk base64 data)
typedef struct { uint16_t len; char data[532]; } cmd_msg_t;

// ── OTA state ──────────────────────────────────────────────────────────────
static bool                  s_ota_active = false;
static esp_ota_handle_t      s_ota_handle = 0;
static const esp_partition_t *s_ota_part  = NULL;
static size_t                s_ota_size   = 0;     // expected (0 = unknown)
static size_t                s_ota_recv   = 0;
static volatile bool         s_cmd_dropped = false; // queue overflow flag

static inline uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

// ═══════════════════════════════════════════════════════════════════════════
// NVS identity — same namespace/keys as MicroPython (blobs in ns "device")
// ═══════════════════════════════════════════════════════════════════════════
static bool nvs_get_str_blob(nvs_handle_t h, const char *key, char *out, size_t cap)
{
    size_t len = cap - 1;
    if (nvs_get_blob(h, key, out, &len) != ESP_OK) return false;
    out[len] = '\0';
    return true;
}

// Semver compare on "major.minor.patch" (any suffix like "-c" is ignored).
// Returns true if a is strictly newer than b. Mirrors the app's fwIsOutdated().
static void fw_parse(const char *v, int o[3])
{
    o[0] = o[1] = o[2] = 0;
    sscanf(v, "%d.%d.%d", &o[0], &o[1], &o[2]);
}
static bool fw_is_newer(const char *a, const char *b)
{
    int x[3], y[3];
    fw_parse(a, x); fw_parse(b, y);
    for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] > y[i];
    return false;
}

static void identity_load(void)
{
    nvs_handle_t h;
    bool have_uuid = false;

    if (nvs_open("device", NVS_READWRITE, &h) == ESP_OK) {
        nvs_get_str_blob(h, "id", s_dev_id, sizeof(s_dev_id));
        if (!nvs_get_str_blob(h, "name", s_dev_name, sizeof(s_dev_name)))
            strlcpy(s_dev_name, s_dev_id, sizeof(s_dev_name));
        nvs_get_str_blob(h, "fw", s_dev_fw, sizeof(s_dev_fw));
        // If this *image* is newer than the recorded version (e.g. a fresh USB
        // flash, or NVS never had "fw"), adopt the compiled-in version and
        // persist it. After an OTA, ota_end has already written the installed
        // version, so the record always reflects the newest of {running code,
        // last install} — and send_hello reports it, so the app stops offering
        // an update the device already has.
        if (fw_is_newer(FW_VERSION_C, s_dev_fw)) {
            strlcpy(s_dev_fw, FW_VERSION_C, sizeof(s_dev_fw));
            nvs_set_blob(h, "fw", s_dev_fw, strlen(s_dev_fw));
            nvs_commit(h);
        }
        have_uuid = nvs_get_str_blob(h, "uuid", s_dev_uuid, sizeof(s_dev_uuid));

        if (!have_uuid) {                       // derive v4-style UUID from MAC
            uint8_t b[16] = {0};
            esp_read_mac(b, ESP_MAC_WIFI_STA);  // fills b[0..5]
            b[6] = (b[6] & 0x0F) | 0x40;
            b[8] = (b[8] & 0x3F) | 0x80;
            snprintf(s_dev_uuid, sizeof(s_dev_uuid),
                     "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                     b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],
                     b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
            nvs_set_blob(h, "uuid", s_dev_uuid, strlen(s_dev_uuid));
            nvs_commit(h);
            ESP_LOGI(TAG, "[boot] UUID generated: %s", s_dev_uuid);
        }
        nvs_close(h);
    }
    ESP_LOGI(TAG, "identity: id=%s name=%s fw=%s uuid=%s",
             s_dev_id, s_dev_name, s_dev_fw, s_dev_uuid);
}

static void identity_provision(const char *new_name, const char *new_id)
{
    nvs_handle_t h;
    if (nvs_open("device", NVS_READWRITE, &h) != ESP_OK) {
        ESP_LOGE(TAG, "[BLE] provision NVS open failed");
        return;
    }
    if (new_name && new_name[0]) nvs_set_blob(h, "name", new_name, strlen(new_name));
    if (new_id   && new_id[0])   nvs_set_blob(h, "id",   new_id,   strlen(new_id));
    nvs_commit(h);
    nvs_close(h);
    ESP_LOGI(TAG, "[BLE] provisioned name=%s id=%s — rebooting",
             new_name ? new_name : "", new_id ? new_id : "");
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_restart();
}

// ═══════════════════════════════════════════════════════════════════════════
// LED1 — RGB status via LEDC PWM (common cathode: duty = brightness)
// ═══════════════════════════════════════════════════════════════════════════
static void led_set(uint8_t r, uint8_t g, uint8_t b)
{
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, r);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, g);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2, b);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2);
}

// ── Identity color override (multi-bag) ────────────────────────────────────
// When s_led_id_on, the solid-green "connected" state is replaced by this
// per-device color so a coach can match a physical bag to its on-screen tile.
// Values are pre-scaled to the 0..LED_ID_MAX duty band at command time so the
// 40 ms tick stays cheap (and so a raw 255 doesn't blind through the diffuser).
#define LED_ID_MAX 80
static volatile bool    s_led_id_on = false;
static volatile uint8_t s_led_id_r  = 0, s_led_id_g = 0, s_led_id_b = 0;

static inline uint8_t led_scale(int v)
{
    if (v < 0)   v = 0;
    if (v > 255) v = 255;
    return (uint8_t)(v * LED_ID_MAX / 255);
}

static void led_set_identity(int r, int g, int b)
{
    s_led_id_r  = led_scale(r);
    s_led_id_g  = led_scale(g);
    s_led_id_b  = led_scale(b);
    s_led_id_on = true;
}

static void led_tick_cb(void *arg)        // 40 ms periodic esp_timer
{
    uint32_t now = now_ms();

    if (s_conn != BLE_HS_CONN_HANDLE_NONE) {
        if (now - s_last_hit_ms < 150)  led_set(90, 0, 0);   // red flash — hit (always wins)
        else if (s_led_id_on)           led_set(s_led_id_r, s_led_id_g, s_led_id_b); // identity color
        else                            led_set(0, 50, 0);   // solid green
    } else {
        // slow blue pulse while advertising: triangle wave, 2 s period
        uint32_t ph  = now % 2000;
        uint32_t tri = (ph < 1000) ? ph : (2000 - ph);       // 0..1000
        led_set(0, 0, (uint8_t)(5 + tri * 55 / 1000));       // 5..60
    }
}

static void led_init(void)
{
    ledc_timer_config_t tcfg = {
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .timer_num       = LEDC_TIMER_0,
        .duty_resolution = LEDC_TIMER_8_BIT,
        .freq_hz         = 1000,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&tcfg));

    const int pins[3] = { PIN_LED_R, PIN_LED_G, PIN_LED_B };
    for (int i = 0; i < 3; i++) {
        ledc_channel_config_t ccfg = {
            .gpio_num   = pins[i],
            .speed_mode = LEDC_LOW_SPEED_MODE,
            .channel    = LEDC_CHANNEL_0 + i,
            .timer_sel  = LEDC_TIMER_0,
            .duty       = 0,
            .hpoint     = 0,
        };
        ESP_ERROR_CHECK(ledc_channel_config(&ccfg));
    }

    const esp_timer_create_args_t targs = { .callback = led_tick_cb, .name = "led" };
    esp_timer_handle_t th;
    ESP_ERROR_CHECK(esp_timer_create(&targs, &th));
    ESP_ERROR_CHECK(esp_timer_start_periodic(th, 40 * 1000));   // 40 ms
}

// ═══════════════════════════════════════════════════════════════════════════
// Matrix scan — rows + MCP3208 (no-DMA polling SPI)
// ═══════════════════════════════════════════════════════════════════════════
static void rows_init(void)
{
    uint64_t mask = 0;
    for (int i = 0; i < NROWS; i++) mask |= (1ULL << ROW_PINS[i]);
    gpio_config_t io = {
        .pin_bit_mask = mask,
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io));
    for (int i = 0; i < NROWS; i++) gpio_set_level(ROW_PINS[i], 0);
}

static void spi_init(void)
{
    spi_bus_config_t bus = {
        .mosi_io_num   = PIN_MOSI,
        .miso_io_num   = PIN_MISO,
        .sclk_io_num   = PIN_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    // SPI_DMA_DISABLED: 3-byte frames fit the FIFO; skipping per-transaction
    // DMA setup is the main fix for the 239 Hz benchmark result.
    ESP_ERROR_CHECK(spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_DISABLED));

    spi_device_interface_config_t dev = {
        .clock_speed_hz = SPI_HZ,
        .mode           = 0,
        .spics_io_num   = PIN_CS,        // hardware CS framed per conversion
        .queue_size     = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI3_HOST, &dev, &s_adc));
}

static inline int mcp3208_read(int ch)
{
    spi_transaction_t t = {
        .flags  = SPI_TRANS_USE_TXDATA | SPI_TRANS_USE_RXDATA,
        .length = 24,
    };
    t.tx_data[0] = 0x06 | (ch >> 2);
    t.tx_data[1] = (ch & 0x03) << 6;
    t.tx_data[2] = 0x00;
    spi_device_polling_transmit(s_adc, &t);
    return ((t.rx_data[1] & 0x0F) << 8) | t.rx_data[2];
}

// ── Per-cell tracking state (port of scan_frame_tracked) ──────────────────
typedef struct {
    bool     active;
    uint32_t t_first, t_peak;
    uint16_t v_peak;
} cell_t;
static cell_t s_cells[NROWS][NCOLS];

typedef struct {
    uint8_t  r, c;                       // 1-based
    uint16_t mv;
    uint32_t t_first, t_peak;
    uint16_t v_peak;
    uint8_t  is_new;
} hit_t;

typedef struct {
    uint32_t t;
    int      n;
    hit_t    h[NROWS * NCOLS];
} frame_t;

static frame_t s_fbuf[MAX_BUF_FRAMES];
static int     s_fbuf_n = 0;

static void cells_reset(void) { memset(s_cells, 0, sizeof(s_cells)); }

// Scan one tracked frame into *f. Returns true if any hit is brand-new.
static bool scan_frame_tracked(frame_t *f, int threshold)
{
    bool has_new = false;
    uint32_t t = now_ms();
    f->t = t;
    f->n = 0;

    bool seen[NROWS][NCOLS] = {0};
    int prev = -1;

    spi_device_acquire_bus(s_adc, portMAX_DELAY);
    for (int r = 0; r < NROWS; r++) {
        if (prev >= 0) gpio_set_level(ROW_PINS[prev], 0);
        gpio_set_level(ROW_PINS[r], 1);
        prev = r;
        if (ROW_SETTLE_US) esp_rom_delay_us(ROW_SETTLE_US);

        for (int c = 0; c < NCOLS; c++) {
            int counts = mcp3208_read(c);
            if (counts < threshold) continue;

            uint16_t mv = (uint16_t)((uint32_t)counts * VREF_MV / ADC_COUNTS);
            seen[r][c] = true;
            cell_t *cs = &s_cells[r][c];
            uint8_t is_new = 0;

            if (!cs->active) {
                cs->active  = true;
                cs->t_first = t;
                cs->t_peak  = t;
                cs->v_peak  = mv;
                is_new      = 1;
                has_new     = true;
            } else if (mv > cs->v_peak) {
                cs->v_peak = mv;
                cs->t_peak = t;
            }

            hit_t *h = &f->h[f->n++];
            h->r = r + 1;  h->c = c + 1;  h->mv = mv;
            h->t_first = cs->t_first;  h->t_peak = cs->t_peak;
            h->v_peak  = cs->v_peak;   h->is_new = is_new;
        }
    }
    if (prev >= 0) gpio_set_level(ROW_PINS[prev], 0);
    spi_device_release_bus(s_adc);

    // release cells not seen this frame
    for (int r = 0; r < NROWS; r++)
        for (int c = 0; c < NCOLS; c++)
            if (s_cells[r][c].active && !seen[r][c]) s_cells[r][c].active = false;

    if (f->n) s_last_hit_ms = t;         // LED red flash
    return has_new;
}

// ═══════════════════════════════════════════════════════════════════════════
// BLE — NimBLE Nordic UART Service (same UUIDs/protocol as MicroPython)
// ═══════════════════════════════════════════════════════════════════════════
// 6E400001-B5A3-F393-E0A9-E50E24DCCA9E (service), -0002 RX (write), -0003 TX (notify)
static const ble_uuid128_t nus_svc_uuid =
    BLE_UUID128_INIT(0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,
                     0x93,0xf3,0xa3,0xb5,0x01,0x00,0x40,0x6e);
static const ble_uuid128_t nus_rx_uuid =
    BLE_UUID128_INIT(0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,
                     0x93,0xf3,0xa3,0xb5,0x02,0x00,0x40,0x6e);
static const ble_uuid128_t nus_tx_uuid =
    BLE_UUID128_INIT(0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,
                     0x93,0xf3,0xa3,0xb5,0x03,0x00,0x40,0x6e);

static int nus_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                         struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        cmd_msg_t msg;
        uint16_t len = 0;
        if (ble_hs_mbuf_to_flat(ctxt->om, msg.data, sizeof(msg.data) - 1, &len) == 0) {
            msg.data[len] = '\0';
            msg.len = len;
            // 20 ms timeout = brief backpressure on the writer during OTA
            // bursts; if it still overflows, flag it so an in-flight OTA
            // fails fast instead of discovering corruption at ota_end
            if (xQueueSend(s_cmd_q, &msg, pdMS_TO_TICKS(20)) != pdTRUE)
                s_cmd_dropped = true;
        }
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &nus_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            { .uuid = &nus_tx_uuid.u, .access_cb = nus_access_cb,
              .val_handle = &s_tx_handle, .flags = BLE_GATT_CHR_F_NOTIFY },
            { .uuid = &nus_rx_uuid.u, .access_cb = nus_access_cb,
              .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP },
            { 0 }
        },
    },
    { 0 }
};

static void ble_advertise(void);

static int gap_event_cb(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn = event->connect.conn_handle;
            ESP_LOGI(TAG, "[BLE] central connected");
            // Request a fast connection interval. The scan loop runs ~400 Hz and
            // force-flushes batches well above the 40 Hz design target, so the
            // default ~30 ms interval (esp. iOS) becomes the throughput ceiling
            // and notifies start backing up / dropping. 12–24 units × 1.25 ms =
            // 15–30 ms; the central may clamp, but asking pulls it to the floor.
            struct ble_gap_upd_params cp = {
                .itvl_min            = 12,    // 15 ms
                .itvl_max            = 24,    // 30 ms
                .latency             = 0,
                .supervision_timeout = 400,   // 4 s
            };
            int prc = ble_gap_update_params(event->connect.conn_handle, &cp);
            if (prc) ESP_LOGW(TAG, "[BLE] conn param update rc=%d", prc);
        } else {
            ble_advertise();
        }
        return 0;

    case BLE_GAP_EVENT_DISCONNECT:
        s_conn      = BLE_HS_CONN_HANDLE_NONE;
        s_notify_on = false;
        s_scanning  = false;
        s_pending_hello = false;         // don't carry a stale hello into next conn
        s_led_id_on = false;             // drop identity color — app re-sends on reconnect
        s_authed    = false;             // re-auth required on every new connection
        s_att_mtu   = 23;
        ESP_LOGI(TAG, "[BLE] central disconnected → re-advertising");
        ble_advertise();
        return 0;

    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_tx_handle) {
            s_notify_on = event->subscribe.cur_notify;
            if (s_notify_on) s_pending_hello = true;   // hello once notifiable
        }
        return 0;

    case BLE_GAP_EVENT_MTU:
        s_att_mtu = event->mtu.value;
        ESP_LOGI(TAG, "[BLE] MTU = %u", s_att_mtu);
        return 0;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        ble_advertise();
        return 0;
    }
    return 0;
}

static void ble_advertise(void)
{
    // ADV packet: flags + complete 128-bit NUS UUID (required — the app's
    // scanner filters on service UUID).  Scan response: complete local name.
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = (ble_uuid128_t *)&nus_svc_uuid;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&fields);
    if (rc) { ESP_LOGE(TAG, "adv_set_fields rc=%d", rc); return; }

    struct ble_hs_adv_fields rsp = {0};
    const char *name = ble_svc_gap_device_name();
    rsp.name = (uint8_t *)name;
    rsp.name_len = strlen(name);
    rsp.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc) { ESP_LOGE(TAG, "adv_rsp_set_fields rc=%d", rc); return; }

    struct ble_gap_adv_params advp = {0};
    advp.conn_mode = BLE_GAP_CONN_MODE_UND;
    advp.disc_mode = BLE_GAP_DISC_MODE_GEN;
    advp.itvl_min  = 320;                // 200 ms in 0.625 ms units = ADV_INTERVAL_US
    advp.itvl_max  = 320;
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER,
                           &advp, gap_event_cb, NULL);
    if (rc && rc != BLE_HS_EALREADY) ESP_LOGE(TAG, "adv_start rc=%d", rc);
    else ESP_LOGI(TAG, "[BLE] advertising as '%s'", name);
}

static void ble_on_sync(void)
{
    ble_hs_util_ensure_addr(0);
    ble_hs_id_infer_auto(0, &s_own_addr_type);
    ble_advertise();
}

static void ble_host_task(void *param)
{
    nimble_port_run();                   // returns on nimble_port_stop()
    nimble_port_freertos_deinit();
}

static void ble_init(void)
{
    ESP_ERROR_CHECK(nimble_port_init());

    ble_hs_cfg.sync_cb = ble_on_sync;

    // Prefer a large ATT MTU so batch/notify packets ride in a single PDU and
    // the chunked-notify path (with its 5 ms inter-chunk delay) is rarely hit.
    // The central still negotiates the final value; this raises our ceiling.
    ble_att_set_preferred_mtu(247);

    ble_svc_gap_init();
    ble_svc_gatt_init();
    int rc = ble_gatts_count_cfg(gatt_svcs);
    assert(rc == 0);
    rc = ble_gatts_add_svcs(gatt_svcs);
    assert(rc == 0);

    // DEVICE_NAME = _DEVICE_ID, clamped to 29 bytes: the complete-name AD
    // element must fit a 31-byte scan response (name_len + 2 ≤ 31) or
    // ble_gap_adv_rsp_set_fields fails and we'd never advertise.
    char gap_name[30];
    strlcpy(gap_name, s_dev_id, sizeof(gap_name));
    rc = ble_svc_gap_device_name_set(gap_name);
    if (rc) ESP_LOGW(TAG, "device_name_set rc=%d", rc);

    nimble_port_freertos_init(ble_host_task);
}

// ── Notify helpers (port of notify_json_chunked) ───────────────────────────
static void nus_notify_raw(const uint8_t *data, int len)
{
    if (s_conn == BLE_HS_CONN_HANDLE_NONE || !s_notify_on) return;
    struct os_mbuf *om = ble_hs_mbuf_from_flat(data, len);
    if (!om) return;                       // mbuf pool exhausted — host backed up
    // ble_gatts_notify_custom consumes/frees om on every path. A non-zero rc at
    // high frame rates means the controller queue is full (interval too slow);
    // the batch is lost rather than silently corrupting the stream. Rate-limited
    // log so a backed-up link is visible without flooding the console.
    int rc = ble_gatts_notify_custom(s_conn, s_tx_handle, om);
    if (rc) {
        static uint32_t last_warn_ms = 0;
        uint32_t now = now_ms();
        if (now - last_warn_ms > 1000) {
            last_warn_ms = now;
            ESP_LOGW(TAG, "[BLE] notify rc=%d (link backed up — batch dropped)", rc);
        }
    }
}

static void notify_json_chunked(const char *s)
{
    int len = strlen(s);
    int max_len = s_att_mtu > 13 ? s_att_mtu - 3 : 20;
    if (max_len > NOTIFY_MAX_LEN) max_len = NOTIFY_MAX_LEN;

    if (len <= max_len) {
        nus_notify_raw((const uint8_t *)s, len);
        return;
    }
    int payload = max_len - 10;          // room for "Cnn/NN:" header (≤10 B up to 999)
    int total   = (len + payload - 1) / payload;
    if (total > 999) {                   // 4-digit headers would overflow the
        ESP_LOGE(TAG, "notify dropped: %d B won't fit %d-B chunks", len, payload);
        return;                          // reserved 10 bytes → corrupt reassembly
    }
    for (int i = 0; i < total; i++) {
        char pkt[NOTIFY_MAX_LEN + 12];
        int  n = snprintf(pkt, sizeof(pkt), "C%02d/%02d:", i + 1, total);
        int  part = len - i * payload;
        if (part > payload) part = payload;
        memcpy(pkt + n, s + i * payload, part);
        nus_notify_raw((const uint8_t *)pkt, n + part);
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// ── JSON builders ──────────────────────────────────────────────────────────
#define JSON_BUF_SZ 16384
static char s_json[JSON_BUF_SZ];

static void send_hello(void)
{
    snprintf(s_json, sizeof(s_json),
        "{\"type\":\"hello\",\"uuid\":\"%s\",\"id\":\"%s\",\"name\":\"%s\","
        "\"fw\":\"%s\",\"hw\":\"" HW_REV "\",\"rows\":%d,\"cols\":%d,"
        "\"mode\":\"batch\",\"batch_size\":%d,\"hz\":%lu}",
        s_dev_uuid, s_dev_id, s_dev_name, s_dev_fw, NROWS, NCOLS, BATCH_SIZE,
        (unsigned long)(s_scan_hz ? s_scan_hz : SCAN_HZ_NOMINAL));
    notify_json_chunked(s_json);
}

static void flush_batch(void)
{
    if (!s_fbuf_n) return;
    int n = snprintf(s_json, sizeof(s_json), "{\"type\":\"batch\",\"frames\":[");

    for (int i = 0; i < s_fbuf_n; i++) {
        frame_t *f = &s_fbuf[i];
        // bail out if this frame can't possibly fit (~52 B/hit + envelope)
        if (n + 32 + f->n * 52 > JSON_BUF_SZ - 8) {
            ESP_LOGW(TAG, "batch JSON full — dropped %d frame(s)", s_fbuf_n - i);
            break;
        }
        n += snprintf(s_json + n, sizeof(s_json) - n, "%s{\"t\":%lu,\"hits\":[",
                      i ? "," : "", (unsigned long)f->t);
        for (int j = 0; j < f->n; j++) {
            hit_t *h = &f->h[j];
            n += snprintf(s_json + n, sizeof(s_json) - n,
                          "%s[%u,%u,%u,%lu,%lu,%u,%u]", j ? "," : "",
                          h->r, h->c, h->mv,
                          (unsigned long)h->t_first, (unsigned long)h->t_peak,
                          h->v_peak, h->is_new);
        }
        n += snprintf(s_json + n, sizeof(s_json) - n, "]}");
    }
    snprintf(s_json + n, sizeof(s_json) - n, "]}");
    notify_json_chunked(s_json);
    s_fbuf_n = 0;
}

// ── OTA over BLE (real esp_ota port of the ota_start/chunk/end protocol) ───
static void ota_fail(const char *msg)
{
    ESP_LOGE(TAG, "[OTA] %s", msg);
    if (s_ota_active) { esp_ota_abort(s_ota_handle); s_ota_active = false; }
    char buf[160];
    snprintf(buf, sizeof(buf), "{\"type\":\"ota_err\",\"msg\":\"%s\"}", msg);
    notify_json_chunked(buf);
}

static void ota_start(const cJSON *obj)
{
    // Gate: the app must have passed the challenge-response on this connection.
    if (!s_authed) { ota_fail("unauthorized — auth required before OTA"); return; }

    if (s_ota_active) { esp_ota_abort(s_ota_handle); s_ota_active = false; }

    s_ota_part = esp_ota_get_next_update_partition(NULL);
    if (!s_ota_part) {
        ota_fail("no OTA partition — reflash once via USB with the A/B table");
        return;
    }
    const cJSON *jsz = cJSON_GetObjectItem(obj, "size");
    s_ota_size = cJSON_IsNumber(jsz) ? (size_t)jsz->valuedouble : 0;
    s_ota_recv = 0;

    // OTA_WITH_SEQUENTIAL_WRITES: erase incrementally instead of one long
    // blocking erase — keeps the BLE connection responsive.
    esp_err_t err = esp_ota_begin(s_ota_part, OTA_WITH_SEQUENTIAL_WRITES, &s_ota_handle);
    if (err != ESP_OK) { ota_fail(esp_err_to_name(err)); return; }

    s_ota_active = true;
    s_scanning   = false;                // pause scanning during transfer
    ESP_LOGI(TAG, "[OTA] start → %s (expect %u bytes)",
             s_ota_part->label, (unsigned)s_ota_size);
}

static void ota_chunk(const cJSON *obj)
{
    if (!s_ota_active) return;
    const cJSON *jd = cJSON_GetObjectItem(obj, "data");
    if (!cJSON_IsString(jd)) return;

    static uint8_t dec[512];
    size_t olen = 0;
    if (mbedtls_base64_decode(dec, sizeof(dec), &olen,
                              (const uint8_t *)jd->valuestring,
                              strlen(jd->valuestring)) != 0) {
        ota_fail("base64 decode error");
        return;
    }
    esp_err_t err = esp_ota_write(s_ota_handle, dec, olen);
    if (err != ESP_OK) { ota_fail(esp_err_to_name(err)); return; }
    s_ota_recv += olen;
}

static void ota_end(const cJSON *obj)
{
    if (!s_ota_active) {
        // ota_start was never seen (or already failed) — tell the client
        // instead of letting it wait forever for ota_ok
        notify_json_chunked("{\"type\":\"ota_err\",\"msg\":\"no active OTA\"}");
        return;
    }

    const cJSON *jfw = cJSON_GetObjectItem(obj, "fw");
    const char *new_fw = cJSON_IsString(jfw) ? jfw->valuestring : "0.0.0";

    if (s_ota_size && s_ota_recv != s_ota_size) {
        ota_fail("size mismatch — chunks lost in transfer, retry");
        return;
    }
    s_ota_active = false;   // esp_ota_end frees the handle either way — never
                            // esp_ota_abort after this point
    esp_err_t err = esp_ota_end(s_ota_handle);    // validates image header/hash
    if (err != ESP_OK) { ota_fail(esp_err_to_name(err)); return; }

    err = esp_ota_set_boot_partition(s_ota_part);
    if (err != ESP_OK) { ota_fail(esp_err_to_name(err)); return; }

    nvs_handle_t h;                               // record fw like MicroPython did
    if (nvs_open("device", NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_blob(h, "fw", new_fw, strlen(new_fw));
        nvs_commit(h);
        nvs_close(h);
    }
    char buf[160];
    snprintf(buf, sizeof(buf), "{\"type\":\"ota_ok\",\"fw\":\"%s\",\"uuid\":\"%s\"}",
             new_fw, s_dev_uuid);
    notify_json_chunked(buf);
    ESP_LOGI(TAG, "[OTA] %u bytes flashed to %s — rebooting as fw %s",
             (unsigned)s_ota_recv, s_ota_part->label, new_fw);
    vTaskDelay(pdMS_TO_TICKS(600));               // let the notify drain
    esp_restart();
}

// ── Auth helpers ────────────────────────────────────────────────────────────
static inline int hexnib(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Verify an app-supplied HMAC-SHA256(OTA_AUTH_KEY, s_nonce) given as 64 hex
// chars. Constant-time compare so a wrong key leaks no timing signal.
static bool auth_verify(const char *mac_hex)
{
    if (!mac_hex || strlen(mac_hex) != 64) return false;

    uint8_t want[32];
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (!info) return false;
    if (mbedtls_md_hmac(info, OTA_AUTH_KEY, sizeof(OTA_AUTH_KEY),
                        s_nonce, sizeof(s_nonce), want) != 0) return false;

    uint8_t diff = 0;
    for (int i = 0; i < 32; i++) {
        int hi = hexnib(mac_hex[i * 2]), lo = hexnib(mac_hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        diff |= want[i] ^ (uint8_t)((hi << 4) | lo);
    }
    return diff == 0;
}

// ── Command handling (port of _drain_cmd_queue) ────────────────────────────
static void handle_command(const char *raw)
{
    cJSON *obj = cJSON_Parse(raw);
    if (!obj) { ESP_LOGW(TAG, "[BLE] JSON parse error: %.40s", raw); return; }

    const cJSON *jcmd = cJSON_GetObjectItem(obj, "cmd");
    const char *cmd = cJSON_IsString(jcmd) ? jcmd->valuestring : "";

    if (!strcmp(cmd, "start")) {
        s_scanning = true;
        ESP_LOGI(TAG, "[BLE] cmd=start → scanning enabled");
    } else if (!strcmp(cmd, "stop")) {
        s_scanning = false;
        ESP_LOGI(TAG, "[BLE] cmd=stop  → scanning paused");
    } else if (!strcmp(cmd, "auth_begin")) {
        // Issue a fresh random challenge; invalidate any prior auth on this link.
        esp_fill_random(s_nonce, sizeof(s_nonce));
        s_authed = false;
        char buf[80];
        int n = snprintf(buf, sizeof(buf), "{\"type\":\"auth_chal\",\"nonce\":\"");
        for (int i = 0; i < (int)sizeof(s_nonce); i++)
            n += snprintf(buf + n, sizeof(buf) - n, "%02x", s_nonce[i]);
        snprintf(buf + n, sizeof(buf) - n, "\"}");
        notify_json_chunked(buf);
        ESP_LOGI(TAG, "[BLE] auth challenge issued");
    } else if (!strcmp(cmd, "auth")) {
        const cJSON *jmac = cJSON_GetObjectItem(obj, "mac");
        s_authed = auth_verify(cJSON_IsString(jmac) ? jmac->valuestring : NULL);
        notify_json_chunked(s_authed ? "{\"type\":\"auth_ok\"}"
                                     : "{\"type\":\"auth_err\"}");
        ESP_LOGI(TAG, "[BLE] auth %s", s_authed ? "ok" : "FAILED");
    } else if (!strcmp(cmd, "provision")) {
        if (!s_authed) {
            notify_json_chunked("{\"type\":\"err\",\"msg\":\"unauthorized\"}");
            ESP_LOGW(TAG, "[BLE] provision rejected — not authorized");
        } else {
            const cJSON *jn = cJSON_GetObjectItem(obj, "name");
            const cJSON *ji = cJSON_GetObjectItem(obj, "id");
            identity_provision(cJSON_IsString(jn) ? jn->valuestring : NULL,
                               cJSON_IsString(ji) ? ji->valuestring : NULL);
        }
    } else if (!strcmp(cmd, "led")) {
        // Multi-bag identity color. {"cmd":"led","off":true} clears the override;
        // otherwise r/g/b (0..255, default 0) set the solid "connected" color.
        const cJSON *joff = cJSON_GetObjectItem(obj, "off");
        if (cJSON_IsBool(joff) && cJSON_IsTrue(joff)) {
            s_led_id_on = false;
            ESP_LOGI(TAG, "[BLE] cmd=led off → default LED states");
        } else {
            const cJSON *jr = cJSON_GetObjectItem(obj, "r");
            const cJSON *jg = cJSON_GetObjectItem(obj, "g");
            const cJSON *jb = cJSON_GetObjectItem(obj, "b");
            int r = cJSON_IsNumber(jr) ? (int)jr->valuedouble : 0;
            int g = cJSON_IsNumber(jg) ? (int)jg->valuedouble : 0;
            int b = cJSON_IsNumber(jb) ? (int)jb->valuedouble : 0;
            led_set_identity(r, g, b);
            ESP_LOGI(TAG, "[BLE] cmd=led r=%d g=%d b=%d", r, g, b);
        }
    } else if (!strcmp(cmd, "ota_start")) {
        ota_start(obj);
    } else if (!strcmp(cmd, "ota_chunk")) {
        ota_chunk(obj);
    } else if (!strcmp(cmd, "ota_end")) {
        ota_end(obj);
    } else {
        ESP_LOGW(TAG, "[BLE] unknown cmd: %s", cmd);
    }
    cJSON_Delete(obj);
}

static void drain_cmd_queue(void)
{
    cmd_msg_t msg;
    while (xQueueReceive(s_cmd_q, &msg, 0) == pdTRUE)
        handle_command(msg.data);

    if (s_cmd_dropped) {
        s_cmd_dropped = false;
        if (s_ota_active)
            ota_fail("BLE write dropped — lower chunk rate and retry");
        else
            ESP_LOGW(TAG, "[BLE] command dropped (queue full)");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Scan task — core 1 (BLE host runs on core 0)
// ═══════════════════════════════════════════════════════════════════════════
static void scan_task(void *arg)
{
    const int threshold = (int)(HIT_THRESHOLD_V * ADC_COUNTS / (VREF_MV / 1000.0f));
    const uint32_t notify_min_ms = 1000 / MAX_NOTIFY_HZ;

    uint32_t last_notify = 0, t_mark = now_ms();
    uint32_t frames = 0;

    ESP_LOGI(TAG, "threshold = %d counts; scan task on core %d",
             threshold, xPortGetCoreID());

    while (1) {
        drain_cmd_queue();
        uint32_t now = now_ms();

        // Drain the command queue at 10 ms during OTA (chunks stream fast),
        // 20 ms otherwise.
        const TickType_t idle = pdMS_TO_TICKS(s_ota_active ? 10 : 20);

        if (s_conn == BLE_HS_CONN_HANDLE_NONE) {
            if (s_ota_active) ota_fail("disconnected mid-transfer");
            cells_reset(); s_fbuf_n = 0;
            vTaskDelay(idle);
            continue;
        }

        if (s_pending_hello) {
            s_pending_hello = false;
            send_hello();
            // BLE provably works (connect + subscribe + hello) — NOW confirm
            // this image so the bootloader won't roll back. Deliberately not
            // done at boot: an OTA image with broken BLE must stay
            // unconfirmed so a power cycle recovers the previous firmware.
            esp_ota_mark_app_valid_cancel_rollback();
            vTaskDelay(idle);
            continue;
        }

        if (!s_scanning) {
            cells_reset(); s_fbuf_n = 0;
            vTaskDelay(idle);
            continue;
        }

        // ── Scan one frame ────────────────────────────────────────────────
        frame_t *f = &s_fbuf[s_fbuf_n];
        bool has_new = scan_frame_tracked(f, threshold);
        frames++;

        bool can_notify = (now - last_notify) >= notify_min_ms;

        if (f->n) {
            s_fbuf_n++;
            bool force = s_fbuf_n >= MAX_BUF_FRAMES;
            if (force || (can_notify &&
                          ((FIRST_HIT_FLUSH && has_new) || s_fbuf_n >= BATCH_SIZE))) {
                last_notify = now;
                flush_batch();
            }
        } else if (s_fbuf_n && can_notify) {
            // contacts released — flush what's buffered so the app sees it
            last_notify = now;
            flush_batch();
        }

        // 1 Hz scan-rate report (same as benchmark build)
        if (now - t_mark >= 1000) {
            s_scan_hz = frames;            // surfaced in the next hello as "hz"
            ESP_LOGI(TAG, "scan rate: %lu Hz   (scanning=%d, buffered=%d)",
                     (unsigned long)frames, (int)s_scanning, s_fbuf_n);
            frames = 0;
            t_mark = now;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
void app_main(void)
{
    ESP_LOGI(TAG, "Trench Sports Build B — native C (scan + BLE + LED) " FW_VERSION_C);

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    identity_load();
    led_init();
    rows_init();
    spi_init();

    s_cmd_q = xQueueCreate(16, sizeof(cmd_msg_t));    // 16 × 534 B ≈ 8.5 KB

    ble_init();

    // Scan loop pinned to core 1 — NimBLE host + LED timer live on core 0.
    // NOTE: after an OTA the image stays in pending-verify until the first
    // successful hello (see scan_task) — a broken image rolls back on reset.
    xTaskCreatePinnedToCore(scan_task, "scan", 8192, NULL, 5, NULL, 1);
}
