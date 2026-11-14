#!/usr/bin/env bash
# Menjalankan web lokal dengan kunci dari penyimpanan kunci OpenBot. Tidak menulis kunci ke disk proyek.
set -euo pipefail
KEYS="$HOME/Library/Application Support/OpenBot/agent-api-keys/agent-0f72cb58-dd04-4e85-bb7a-850895de20cd"
read_key() { [ -f "$KEYS/$1" ] && cat "$KEYS/$1" || { echo "Kunci $1 belum ada di $KEYS" >&2; exit 1; }; }
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://43.134.86.161:18000}"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(read_key NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(read_key SUPABASE_SERVICE_ROLE_KEY)"
export GENIUS_EMAIL="$(read_key GENIUS_EMAIL)"
export GENIUS_PASSWORD="$(read_key GENIUS_PASSWORD)"
# Login superadmin (email dipisah koma) dan link baca-saja finance (opsional; kosong = link nonaktif).
export ADMIN_EMAILS="${ADMIN_EMAILS:-audifirdi@gmail.com}"
export FINANCE_TOKEN="$([ -f "$KEYS/FINANCE_TOKEN" ] && cat "$KEYS/FINANCE_TOKEN" || true)"
cd "$(dirname "$0")/.."
PORT="${PORT:-3100}"
if [ "${1:-}" = "build" ]; then npm run build; fi
exec npx next start -p "$PORT"
