#!/bin/bash
#
# reset.sh - Reset construct.computer to a clean state
#
# USAGE:
#   ./scripts/reset.sh          Quick reset (containers + database only)
#   ./scripts/reset.sh --hard   Full nuke: delete everything + rebuild from scratch
#
# QUICK RESET (default):
#   - Stops and removes all sandbox containers
#   - Removes Docker volumes
#   - Clears database
#   - Keeps: node_modules, Docker images, build artifacts
#
# HARD RESET (--hard):
#   - Everything from quick reset, plus:
#   - Removes Docker images
#   - Removes all node_modules
#   - Removes all build artifacts
#   - Reinstalls all dependencies
#   - Rebuilds boneclaw binary
#   - Rebuilds Docker container image
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Shared helpers (architecture detection, etc.)
source "$SCRIPT_DIR/lib.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

HARD_RESET=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --hard|-h)
            HARD_RESET=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--hard]"
            echo ""
            echo "Options:"
            echo "  --hard, -h    Full nuke: delete everything and rebuild"
            echo ""
            echo "Without flags: Quick reset (containers + database only)"
            exit 0
            ;;
    esac
done

if [ "$HARD_RESET" = true ]; then
    echo -e "${RED}${BOLD}"
    echo "========================================"
    echo "  HARD RESET - Full Nuke & Rebuild"
    echo "========================================"
    echo -e "${NC}"
    echo "This will destroy everything and rebuild from scratch."
    echo ""
    read -p "Type 'yes' to confirm: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi
    echo ""
else
    echo -e "${BLUE}${BOLD}"
    echo "========================================"
    echo "  Quick Reset"
    echo "========================================"
    echo -e "${NC}"
fi

# Step 1: Remove containers
echo -e "${YELLOW}[1] Removing Docker containers...${NC}"
CONTAINERS=$(docker ps -a --filter "name=sandbox-" --format "{{.Names}}" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    docker rm -f $CONTAINERS 2>/dev/null || true
    echo "    Removed: $CONTAINERS"
else
    echo "    No containers found"
fi

# Step 2: Remove volumes
echo -e "${YELLOW}[2] Removing Docker volumes...${NC}"
VOLUMES=$(docker volume ls -q | grep -E "(boneclaw|sandbox|construct|redo)" 2>/dev/null || true)
if [ -n "$VOLUMES" ]; then
    echo "$VOLUMES" | xargs docker volume rm 2>/dev/null || true
    echo "    Removed volumes"
else
    echo "    No volumes found"
fi

# Step 3: Clear database
echo -e "${YELLOW}[3] Clearing database...${NC}"
rm -f "$PROJECT_ROOT/backend/data/construct.db"* 2>/dev/null || true
echo "    Database cleared"

if [ "$HARD_RESET" = true ]; then
    # Step 4: Remove Docker images
    echo -e "${YELLOW}[4] Removing Docker images...${NC}"
    docker rmi boneclaw-runtime:latest cloud-sandbox-env:latest 2>/dev/null || true
    docker image prune -f 2>/dev/null || true
    echo "    Images removed"

    # Step 5: Remove all build artifacts and node_modules
    echo -e "${YELLOW}[5] Removing build artifacts and dependencies...${NC}"
    rm -rf "$PROJECT_ROOT/backend/node_modules" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/backend/data" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/frontend/node_modules" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/frontend/dist" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/boneclaw/node_modules" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/boneclaw/dist" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/boneclaw/.boneclaw" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/container/node_modules" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/container/dist" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/container/bin" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/data" 2>/dev/null || true
    echo "    Cleaned"

    # Step 6: Reinstall dependencies
    echo -e "${YELLOW}[6] Installing dependencies...${NC}"
    echo "    Backend..."
    cd "$PROJECT_ROOT/backend" && bun install --silent
    echo "    Frontend..."
    cd "$PROJECT_ROOT/frontend" && bun install --silent
    echo "    Boneclaw..."
    cd "$PROJECT_ROOT/boneclaw" && bun install --silent
    echo "    Done"

    # Step 7: Build boneclaw binary
    BUN_TARGET=$(detect_bun_target)
    echo -e "${YELLOW}[7] Building boneclaw binary (target: ${BUN_TARGET})...${NC}"
    cd "$PROJECT_ROOT/boneclaw"
    mkdir -p dist
    bun build src/main.ts --compile --outfile dist/boneclaw --target="$BUN_TARGET"
    mkdir -p "$PROJECT_ROOT/container/bin"
    cp dist/boneclaw "$PROJECT_ROOT/container/bin/boneclaw"
    echo "    Built: $(ls -lh dist/boneclaw | awk '{print $5}'), ${BUN_TARGET}"

    # Step 8: Build Docker image
    echo -e "${YELLOW}[8] Building Docker image...${NC}"
    cd "$PROJECT_ROOT/container"
    docker build -t boneclaw-runtime:latest -t cloud-sandbox-env:latest . 2>&1 | \
        grep -E "(Step|Successfully|ERROR)" | sed 's/^/    /' || true
    echo "    Image size: $(docker images boneclaw-runtime:latest --format '{{.Size}}')"
fi

echo ""
echo -e "${GREEN}${BOLD}========================================"
echo "  Reset Complete!"
echo "========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Clear browser localStorage (F12 > Application > Local Storage > Clear)"
echo "  2. Start backend:  cd backend && bun run dev"
echo "  3. Start frontend: cd frontend && bun run dev"
echo "  4. Open http://localhost:5173 and register"
echo ""
