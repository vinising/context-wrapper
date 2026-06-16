#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export WRAPPER_WORKSPACE_ROOT="${WRAPPER_WORKSPACE_ROOT:-$ROOT}"
export WRAPPER_RUNTIME="${WRAPPER_RUNTIME:-ollama}"
export WRAPPER_OLLAMA_MODEL="${WRAPPER_OLLAMA_MODEL:-gemma4:e4b}"
export WRAPPER_OLLAMA_EMBED_MODEL="${WRAPPER_OLLAMA_EMBED_MODEL:-nomic-embed-text}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

exec npx tsx packages/mcp-server/src/cli.ts
