#!/bin/bash
# Development script - starts the backend in dev mode

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

echo "Starting construct.computer backend in development mode..."
echo ""

cd "$PROJECT_ROOT/backend"
exec bun run --hot src/index.ts
