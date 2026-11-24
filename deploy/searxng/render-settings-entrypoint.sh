#!/bin/sh
set -eu

if [ -z "${BRAVE_API_KEY:-}" ]; then
  echo "BRAVE_API_KEY must be set in the SearXNG container environment." >&2
  exit 1
fi

mkdir -p /tmp/searxng
chmod 700 /tmp/searxng

if [ -f /etc/searxng-template/limiter.toml ]; then
  cp /etc/searxng-template/limiter.toml /tmp/searxng/limiter.toml
fi

python3 - <<'PY'
import json
import os
from pathlib import Path

src = Path("/etc/searxng-template/settings.yml").read_text(encoding="utf-8")
placeholder = '"__BRAVE_API_KEY__"'
if placeholder not in src:
    raise SystemExit("Expected __BRAVE_API_KEY__ placeholder in /etc/searxng-template/settings.yml")

rendered = src.replace(placeholder, json.dumps(os.environ["BRAVE_API_KEY"]))
out = Path("/tmp/searxng/settings.yml")
out.write_text(rendered, encoding="utf-8")
os.chmod(out, 0o600)
PY

unset BRAVE_API_KEY
export SEARXNG_SETTINGS_PATH=/tmp/searxng/settings.yml

exec /usr/local/searxng/dockerfiles/docker-entrypoint.sh "$@"
