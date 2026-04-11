#!/usr/bin/env bash

set -euo pipefail

LOCAL_RELAY_URL="${LOCAL_RELAY_URL:-http://127.0.0.1:3001}"
PUBLIC_RELAY_URL="${PUBLIC_RELAY_URL:-https://relay.air7.fun}"

# Smoke test: CORS preflight on /asr/realtime/start.
# Uses OPTIONS so it has zero side effects (no Volcengine session created)
# while still exercising the exact path the Vercel frontend hits in production.

check_preflight() {
  local label="$1"
  local base_url="$2"
  local target="${base_url}/asr/realtime/start"

  echo "${label}: OPTIONS ${target}"

  local headers
  headers="$(curl --silent --show-error --dump-header - --output /dev/null \
    --request OPTIONS \
    --header "Origin: https://example.com" \
    --header "Access-Control-Request-Method: POST" \
    --header "Access-Control-Request-Headers: Content-Type" \
    "${target}")"

  local status_line
  status_line="$(printf '%s\n' "${headers}" | head -n 1)"

  case "${status_line}" in
    *" 204"*) ;;
    *)
      echo "FAIL: expected HTTP 204, got: ${status_line}" >&2
      exit 1
      ;;
  esac

  if ! printf '%s\n' "${headers}" | grep -qi "^access-control-allow-origin:"; then
    echo "FAIL: missing Access-Control-Allow-Origin header" >&2
    exit 1
  fi

  echo "OK: ${label} returned 204 with CORS headers"
}

echo "[1/2] Checking local relay preflight"
check_preflight "local " "${LOCAL_RELAY_URL}"

echo "[2/2] Checking public relay preflight (via nginx)"
check_preflight "public" "${PUBLIC_RELAY_URL}"
