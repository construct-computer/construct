#!/bin/bash
# Reset script for construct.computer
# This removes all containers, database, and cached state

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== construct.computer reset script ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Stop and remove all sandbox containers
echo -e "${YELLOW}[1/4] Removing sandbox containers...${NC}"
CONTAINERS=$(docker ps -a --filter "name=sandbox-" --format "{{.Names}}" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    echo "Found containers: $CONTAINERS"
    docker rm -f $CONTAINERS 2>/dev/null || true
    echo -e "${GREEN}Containers removed${NC}"
else
    echo "No sandbox containers found"
fi

# 2. Remove database
echo ""
echo -e "${YELLOW}[2/4] Removing database...${NC}"
DB_PATH="$PROJECT_DIR/backend/data/construct.db"
DB_WAL="$PROJECT_DIR/backend/data/construct.db-wal"
DB_SHM="$PROJECT_DIR/backend/data/construct.db-shm"

if [ -f "$DB_PATH" ]; then
    rm -f "$DB_PATH" "$DB_WAL" "$DB_SHM" 2>/dev/null || true
    echo -e "${GREEN}Database removed${NC}"
else
    echo "No database found"
fi

# 3. Clear frontend local storage reminder
echo ""
echo -e "${YELLOW}[3/4] Frontend state...${NC}"
echo "Note: Clear your browser's localStorage to reset auth tokens"
echo "  - Open DevTools (F12) → Application → Local Storage → Clear"

# 4. Optional: Remove node_modules and rebuild
echo ""
echo -e "${YELLOW}[4/4] Dependencies...${NC}"
read -p "Remove node_modules and reinstall? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing node_modules..."
    rm -rf "$PROJECT_DIR/backend/node_modules" 2>/dev/null || true
    rm -rf "$PROJECT_DIR/frontend/node_modules" 2>/dev/null || true
    
    echo "Reinstalling backend dependencies..."
    cd "$PROJECT_DIR/backend" && bun install
    
    echo "Reinstalling frontend dependencies..."
    cd "$PROJECT_DIR/frontend" && bun install
    
    echo -e "${GREEN}Dependencies reinstalled${NC}"
else
    echo "Skipped"
fi

echo ""
echo -e "${GREEN}=== Reset complete ===${NC}"
echo ""
echo "To start fresh:"
echo "  1. Clear browser localStorage (for auth tokens)"
echo "  2. Start backend:  cd backend && bun run dev"
echo "  3. Start frontend: cd frontend && bun run dev"
echo "  4. Register a new account"
