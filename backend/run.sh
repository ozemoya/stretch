#!/usr/bin/env bash

set -euo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$BACKEND_DIR/.." && pwd)"
PYTHON="$REPO_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
    printf 'Virtual environment not found at %s\n' "$REPO_DIR/.venv" >&2
    printf 'Create it and install backend/requirements.txt before starting the server.\n' >&2
    exit 1
fi

cd "$BACKEND_DIR"

exec "$PYTHON" -m uvicorn app.main:app \
    --reload \
    --host "${HOST:-127.0.0.1}" \
    --port "${PORT:-8000}" \
    "$@"
