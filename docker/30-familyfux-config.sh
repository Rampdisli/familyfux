#!/bin/sh
# Writes the runtime config the production bundle reads from `window.__env`.
# Run by nginx's own entrypoint (/docker-entrypoint.d) before nginx starts, so
# the same image can be pointed at any Supabase project via env vars.
set -eu

target=/usr/share/nginx/html/config.js

: "${SUPABASE_URL:=}"
: "${SUPABASE_ANON_KEY:=}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "familyfux: SUPABASE_URL and SUPABASE_ANON_KEY must both be set" >&2
    echo "familyfux: (the anon/publishable key is a browser-side value, not a secret)" >&2
    exit 1
fi

# Keep quotes and backslashes from breaking out of the generated string literal.
escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > "$target" <<CONFIG
window.__env = {
  supabaseUrl: "$(escape "$SUPABASE_URL")",
  supabaseAnonKey: "$(escape "$SUPABASE_ANON_KEY")",
};
CONFIG

echo "familyfux: wrote $target for $SUPABASE_URL"
