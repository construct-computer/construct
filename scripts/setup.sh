#!/bin/bash
# Setup script for construct.computer
# Installs all dependencies and prepares the environment

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  construct.computer - Setup Script"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check for required tools
echo "Checking prerequisites..."

# Check Bun
if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    success "Bun installed (v$BUN_VERSION)"
else
    error "Bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash"
fi

# Check Docker (optional but recommended)
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
    success "Docker installed (v$DOCKER_VERSION)"
    DOCKER_AVAILABLE=true
else
    warn "Docker not installed (required for running agent containers)"
    DOCKER_AVAILABLE=false
fi

# Check Node.js (needed for agent-browser in containers)
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    success "Node.js installed ($NODE_VERSION)"
else
    warn "Node.js not installed (needed for agent-browser)"
fi

echo ""
echo "Installing dependencies..."

# Install BoneClaw dependencies
echo ""
echo "→ Installing BoneClaw dependencies..."
cd "$PROJECT_ROOT/boneclaw"
bun install
success "BoneClaw dependencies installed"

# Install Backend dependencies
echo ""
echo "→ Installing Backend dependencies..."
cd "$PROJECT_ROOT/backend"
bun install
success "Backend dependencies installed"

# Build BoneClaw binary
echo ""
echo "→ Building BoneClaw binary..."
cd "$PROJECT_ROOT/boneclaw"
mkdir -p dist
bun build src/main.ts --compile --outfile dist/boneclaw
success "BoneClaw binary built ($(ls -lh dist/boneclaw | awk '{print $5}'))"

# Create data directories
echo ""
echo "→ Creating data directories..."
mkdir -p "$PROJECT_ROOT/backend/data"
mkdir -p "$PROJECT_ROOT/data"
success "Data directories created"

# Create .env file if it doesn't exist
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo ""
    echo "→ Creating default .env file..."
    cat > "$PROJECT_ROOT/.env" << 'EOF'
# construct.computer environment configuration

# Backend
PORT=3000
HOST=0.0.0.0
DB_PATH=./data/construct.db

# Security (CHANGE THESE IN PRODUCTION!)
JWT_SECRET=construct-computer-jwt-secret-change-me
ENCRYPTION_KEY=construct-computer-encryption-key-32

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Docker
BONECLAW_IMAGE=boneclaw-runtime:latest

# Default OpenRouter model for testing
DEFAULT_MODEL=nvidia/nemotron-nano-9b-v2:free
EOF
    success ".env file created (edit with your settings)"
else
    success ".env file already exists"
fi

echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env file with your settings"
echo ""
echo "  2. Start the backend:"
echo "     ./scripts/dev.sh"
echo ""
echo "  3. (Optional) Build Docker container:"
echo "     ./scripts/build-container.sh"
echo ""
echo "  4. Test BoneClaw standalone:"
echo "     OPENROUTER_API_KEY=your-key ./boneclaw/dist/boneclaw 'Hello!'"
echo ""
