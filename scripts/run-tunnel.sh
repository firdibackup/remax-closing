#!/usr/bin/env bash
# Membuka web lokal (port 3100) ke internet lewat ngrok, untuk uji bot WhatsApp Hermes.
# Jalankan scripts/run-local.sh dulu di terminal lain. Authtoken ngrok dibaca dari konfigurasi ngrok
# (`ngrok config add-authtoken …`), tidak disimpan di repo.
set -euo pipefail
PORT="${PORT:-3100}"
NGROK_URL="${NGROK_URL:-crummiest-dangle-theme.ngrok-free.dev}"
echo "API bot: https://$NGROK_URL/api/bot/"
exec ngrok http "$PORT" --url="$NGROK_URL"
