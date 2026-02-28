#!/bin/bash
#
# setup.sh - First-time setup for construct.computer
#
# USAGE:
#   ./scripts/setup.sh
#
# This script:
#   1. Checks prerequisites (bun, docker, node)
#   2. Installs all dependencies
#   3. Builds the boneclaw binary
#   4. Creates default .env file
#   5. Optionally builds Docker container
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

echo -e "${BLUE}${BOLD}"
echo "========================================"
echo "  construct.computer - Setup"
echo "========================================"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: Bun is not installed${NC}"
    echo "Install with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi
echo "  Bun: $(bun --version)"

if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    echo "  Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
    DOCKER_OK=true
else
    echo -e "  Docker: ${YELLOW}not available (required for containers)${NC}"
    DOCKER_OK=false
fi

if command -v node &> /dev/null; then
    echo "  Node: $(node --version)"
else
    echo -e "  Node: ${YELLOW}not found${NC}"
fi

# Install dependencies
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"

echo "  Backend..."
cd "$PROJECT_ROOT/backend" && bun install --silent

echo "  Frontend..."
cd "$PROJECT_ROOT/frontend" && bun install --silent

echo "  Boneclaw..."
cd "$PROJECT_ROOT/boneclaw" && bun install --silent

# Build boneclaw binary
echo ""
BUN_TARGET=$(detect_bun_target)
echo -e "${YELLOW}Building boneclaw binary (target: ${BUN_TARGET})...${NC}"
cd "$PROJECT_ROOT/boneclaw"
mkdir -p dist
bun build src/main.ts --compile --outfile dist/boneclaw --target="$BUN_TARGET"
echo "  Built: dist/boneclaw ($(ls -lh dist/boneclaw | awk '{print $5}'), ${BUN_TARGET})"

# Copy to container bin
mkdir -p "$PROJECT_ROOT/container/bin"
cp dist/boneclaw "$PROJECT_ROOT/container/bin/boneclaw"

# Create data directories
mkdir -p "$PROJECT_ROOT/backend/data"
mkdir -p "$PROJECT_ROOT/data"

# Create .env if it doesn't exist
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo ""
    echo -e "${YELLOW}Creating .env file...${NC}"
    cat > "$PROJECT_ROOT/.env" << 'EOF'
# construct.computer configuration

# Backend
PORT=3000
HOST=0.0.0.0
DB_PATH=./data/construct.db

# Security (CHANGE IN PRODUCTION!)
JWT_SECRET=construct-dev-jwt-secret-change-me
ENCRYPTION_KEY=construct-dev-encryption-key-32b

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Docker
BONECLAW_IMAGE=boneclaw-runtime:latest
EOF
    echo "  Created .env (edit for production)"
else
    echo ""
    echo "  .env already exists"
fi

# Optionally build Docker image
if [ "$DOCKER_OK" = true ]; then
    echo ""
    read -p "Build Docker container image now? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Building Docker image...${NC}"
        cd "$PROJECT_ROOT/container"
        docker build -t boneclaw-runtime:latest -t cloud-sandbox-env:latest . 2>&1 | \
            grep -E "(Step|Successfully)" | head -20 | sed 's/^/  /'
        echo "  Image: boneclaw-runtime:latest ($(docker images boneclaw-runtime:latest --format '{{.Size}}'))"
    fi
fi

echo ""
echo -e "${GREEN}${BOLD}========================================"
echo "  Setup Complete!"
echo "========================================${NC}"
echo ""
echo "To start development:"
echo "  ./scripts/dev.sh"
echo ""
echo "Or manually:"
echo "  Terminal 1: cd backend && bun run dev"
echo "  Terminal 2: cd frontend && bun run dev"
echo ""
echo "Then open http://localhost:5173"
echo ""
