#!/bin/bash
#
# dev.sh - Start development servers
#
# USAGE:
#   ./scripts/dev.sh              Start both backend and frontend
#   ./scripts/dev.sh backend      Start backend only
#   ./scripts/dev.sh frontend     Start frontend only
#
# Backend runs on http://localhost:3000
# Frontend runs on http://localhost:5173
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

MODE="${1:-both}"

case "$MODE" in
    backend|back|b)
        echo -e "${BLUE}Starting backend on http://localhost:${PORT:-3000}${NC}"
        cd "$PROJECT_ROOT/backend"
        exec bun run --hot src/index.ts
        ;;
    frontend|front|f)
        echo -e "${BLUE}Starting frontend on http://localhost:5173${NC}"
        cd "$PROJECT_ROOT/frontend"
        exec bun run dev
        ;;
    both|*)
        echo -e "${BLUE}${BOLD}"
        echo "========================================"
        echo "  construct.computer - Development"
        echo "========================================"
        echo -e "${NC}"
        echo "Starting servers..."
        echo "  Backend:  http://localhost:${PORT:-3000}"
        echo "  Frontend: http://localhost:5173"
        echo ""
        echo -e "${GREEN}Press Ctrl+C to stop${NC}"
        echo ""
        
        # Check dependencies
        if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
            echo "Dependencies not installed. Running setup first..."
            "$SCRIPT_DIR/setup.sh"
        fi
        
        # Start both in parallel
        cd "$PROJECT_ROOT/backend"
        bun run --hot src/index.ts &
        BACKEND_PID=$!
        
        cd "$PROJECT_ROOT/frontend"
        bun run dev &
        FRONTEND_PID=$!
        
        # Handle Ctrl+C
        trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
        
        # Wait for either to exit
        wait $BACKEND_PID $FRONTEND_PID
        ;;
esac
