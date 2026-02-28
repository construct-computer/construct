#!/bin/bash
#
# build.sh - Build for production
#
# USAGE:
#   ./scripts/build.sh              Build everything
#   ./scripts/build.sh docker       Build Docker image only
#   ./scripts/build.sh boneclaw     Build boneclaw binary only
#   ./scripts/build.sh frontend     Build frontend only
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Shared helpers (architecture detection, etc.)
source "$SCRIPT_DIR/lib.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

MODE="${1:-all}"

build_boneclaw() {
    local target
    target=$(detect_bun_target)
    
    echo -e "${YELLOW}Building boneclaw binary (target: ${target})...${NC}"
    cd "$PROJECT_ROOT/boneclaw"
    
    # Install deps if needed
    [ ! -d "node_modules" ] && bun install --silent
    
    mkdir -p dist
    bun build src/main.ts --compile --outfile dist/boneclaw --target="$target"
    
    # Copy to container
    mkdir -p "$PROJECT_ROOT/container/bin"
    cp dist/boneclaw "$PROJECT_ROOT/container/bin/boneclaw"
    
    echo -e "${GREEN}  Built: dist/boneclaw ($(ls -lh dist/boneclaw | awk '{print $5}'), ${target})${NC}"
}

build_frontend() {
    echo -e "${YELLOW}Building frontend...${NC}"
    cd "$PROJECT_ROOT/frontend"
    
    # Install deps if needed
    [ ! -d "node_modules" ] && bun install --silent
    
    bun run build
    echo -e "${GREEN}  Built: dist/ ($(du -sh dist | cut -f1))${NC}"
}

build_docker() {
    echo -e "${YELLOW}Building Docker image...${NC}"
    
    # Ensure boneclaw binary exists
    if [ ! -f "$PROJECT_ROOT/container/bin/boneclaw" ]; then
        echo "  Boneclaw binary not found, building first..."
        build_boneclaw
    fi
    
    # Pull base images before building so network errors surface early
    pull_base_images
    
    cd "$PROJECT_ROOT/container"
    
    echo "  Building container (this may take a few minutes)..."
    docker build \
        -t boneclaw-runtime:latest \
        -t cloud-sandbox-env:latest \
        . 2>&1 | grep -E "(Step|Successfully|ERROR)" | sed 's/^/  /'
    
    echo -e "${GREEN}  Image: boneclaw-runtime:latest ($(docker images boneclaw-runtime:latest --format '{{.Size}}'))${NC}"
}

echo -e "${BLUE}${BOLD}"
echo "========================================"
echo "  construct.computer - Build"
echo "========================================"
echo -e "${NC}"

case "$MODE" in
    boneclaw|agent)
        build_boneclaw
        ;;
    frontend|front)
        build_frontend
        ;;
    docker|container)
        build_docker
        ;;
    all|*)
        build_boneclaw
        echo ""
        build_frontend
        echo ""
        build_docker
        ;;
esac

echo ""
echo -e "${GREEN}Build complete!${NC}"
