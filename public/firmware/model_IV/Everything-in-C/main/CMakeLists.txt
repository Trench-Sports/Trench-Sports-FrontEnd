idf_component_register(SRCS "app_main.c"
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES driver esp_timer esp_hw_support nvs_flash bt json
                                     app_update mbedtls)
