#!/bin/bash
# Start the full construct.computer stack

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

echo "============================================"
echo "  Starting construct.computer"
echo "============================================"
echo ""

# Check if backend dependencies are installed
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
    echo "Dependencies not installed. Running setup..."
    "$SCRIPT_DIR/setup.sh"
fi

# Start backend
echo "Starting backend on port ${PORT:-3000}..."
cd "$PROJECT_ROOT/backend"
bun run src/index.ts
