#!/bin/bash
# Clean build artifacts and data

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Cleaning construct.computer..."

# Clean BoneClaw
echo "→ Cleaning BoneClaw..."
rm -rf "$PROJECT_ROOT/boneclaw/dist"
rm -rf "$PROJECT_ROOT/boneclaw/node_modules"
rm -rf "$PROJECT_ROOT/boneclaw/.boneclaw"

# Clean Backend
echo "→ Cleaning Backend..."
rm -rf "$PROJECT_ROOT/backend/node_modules"
rm -rf "$PROJECT_ROOT/backend/data"

# Clean root data
echo "→ Cleaning data..."
rm -rf "$PROJECT_ROOT/data"

# Optionally remove Docker image
if [ "$1" = "--all" ]; then
    echo "→ Removing Docker image..."
    docker rmi boneclaw-runtime:latest 2>/dev/null || true
    
    echo "→ Removing Docker volumes..."
    docker volume ls -q | grep boneclaw | xargs docker volume rm 2>/dev/null || true
fi

echo ""
echo "Clean complete!"
echo ""
echo "To rebuild, run: ./scripts/setup.sh"
