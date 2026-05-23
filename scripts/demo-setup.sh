#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
DASHBOARD_LOG="$ROOT_DIR/.demo-dashboard.log"
NGROK_LOG="$ROOT_DIR/.demo-ngrok.log"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_env_key() {
  local key="$1"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    echo "Missing ${key} in .env" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt=0

  until curl -fsS "$url" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ "$attempt" -ge 60 ]]; then
      echo "Timed out waiting for ${label}" >&2
      exit 1
    fi
    sleep 1
  done
}

open_browser() {
  local url="$1"

  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1 || true
    return
  fi

  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

require_file "$ENV_FILE"
require_env_key "GEMINI_API_KEY"
require_env_key "GITHUB_APP_SECRET"
require_env_key "GITLAB_WEBHOOK_SECRET"

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is required but was not found on PATH." >&2
  exit 1
fi

echo "Starting CodeSentinel dashboard..."
nohup corepack pnpm --filter @reviewai/dashboard dev >"$DASHBOARD_LOG" 2>&1 &

wait_for_http "http://127.0.0.1:3000/health" "dashboard"

echo "Starting ngrok tunnel..."
nohup ngrok http 3000 >"$NGROK_LOG" 2>&1 &

wait_for_http "http://127.0.0.1:4040/api/tunnels" "ngrok API"

echo "Seeding demo reviews..."
curl -fsS -X POST "http://127.0.0.1:3000/api/demo/seed" >/dev/null

PUBLIC_URL=""
for _ in $(seq 1 30); do
  TUNNELS_JSON="$(curl -fsS "http://127.0.0.1:4040/api/tunnels" 2>/dev/null || true)"
  if [[ -n "$TUNNELS_JSON" ]]; then
    PUBLIC_URL="$(node -e 'const data = JSON.parse(process.argv[1]); const tunnel = data.tunnels.find((entry) => entry.proto === "https") || data.tunnels[0]; if (!tunnel) process.exit(1); process.stdout.write(tunnel.public_url);' "$TUNNELS_JSON")"
    if [[ -n "$PUBLIC_URL" ]]; then
      break
    fi
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "Unable to resolve the ngrok public URL." >&2
  exit 1
fi

echo
echo "Dashboard: http://localhost:3000"
echo "GitHub webhook: ${PUBLIC_URL}/webhooks/github"
echo "GitLab webhook: ${PUBLIC_URL}/webhooks/gitlab"
echo "Demo seed: POST ${PUBLIC_URL}/api/demo/seed"
echo
echo "Logs:"
echo "  Dashboard -> $DASHBOARD_LOG"
echo "  ngrok -> $NGROK_LOG"

open_browser "http://localhost:3000"