#!/usr/bin/env bash
# flash.sh — convenience wrapper for the Trench Build B native-C firmware.
# Usage:  ./flash.sh /dev/cu.usbserial-0001
# (pass your serial port; same one you use to flash MicroPython)
set -e

PORT="${1:?Usage: ./flash.sh <serial-port>   e.g. ./flash.sh /dev/cu.usbserial-0001}"

# ESP-IDF must be on PATH first:  . ~/esp/esp-idf/export.sh
if ! command -v idf.py >/dev/null 2>&1; then
  echo "idf.py not found. Run:  . \$HOME/esp/esp-idf/export.sh" >&2
  exit 1
fi

idf.py set-target esp32        # first time only; harmless to repeat
idf.py build
idf.py -p "$PORT" flash monitor
