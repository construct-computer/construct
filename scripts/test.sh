#!/bin/bash
#
# test.sh - Run tests for construct.computer
#
# USAGE:
#   ./scripts/test.sh           Run all tests
#   ./scripts/test.sh quick     Quick smoke tests only
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "  ${YELLOW}SKIP${NC} $1"; SKIPPED=$((SKIPPED + 1)); }

MODE="${1:-all}"

echo -e "${BLUE}${BOLD}"
echo "========================================"
echo "  construct.computer - Tests"
echo "========================================"
echo -e "${NC}"

# Test 1: Boneclaw binary
echo -e "${YELLOW}[1] Boneclaw binary${NC}"
if [ -f "$PROJECT_ROOT/boneclaw/dist/boneclaw" ]; then
    if "$PROJECT_ROOT/boneclaw/dist/boneclaw" --version &> /dev/null; then
        pass "Binary executes"
    else
        fail "Binary exists but won't run"
    fi
else
    fail "Binary not found (run ./scripts/build.sh boneclaw)"
fi

# Test 2: Docker image
echo -e "${YELLOW}[2] Docker image${NC}"
if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    if docker images boneclaw-runtime:latest --format '{{.ID}}' | grep -q .; then
        SIZE=$(docker images boneclaw-runtime:latest --format '{{.Size}}')
        pass "Image exists ($SIZE)"
    else
        fail "Image not built (run ./scripts/build.sh docker)"
    fi
else
    skip "Docker not available"
fi

# Test 3: Backend health (quick test)
echo -e "${YELLOW}[3] Backend server${NC}"
cd "$PROJECT_ROOT/backend"

# Ensure deps installed
if [ ! -d "node_modules" ]; then
    skip "Dependencies not installed"
else
    # Start backend
    bun run src/index.ts &
    BACKEND_PID=$!
    sleep 2
    
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        pass "Health endpoint responds"
    else
        fail "Health endpoint unreachable"
    fi
    
    kill $BACKEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
fi

# Test 4: Auth flow (full test only)
if [ "$MODE" = "all" ]; then
    echo -e "${YELLOW}[4] Authentication flow${NC}"
    cd "$PROJECT_ROOT/backend"
    
    if [ -d "node_modules" ]; then
        # Clean DB for fresh test
        rm -f "$PROJECT_ROOT/backend/data/construct.db"* 2>/dev/null || true
        
        bun run src/index.ts &
        BACKEND_PID=$!
        sleep 2
        
        # Test registration
        RESULT=$(curl -sf -X POST http://localhost:3000/api/auth/register \
            -H "Content-Type: application/json" \
            -d '{"username":"test_'$$'","password":"testpass123"}' 2>/dev/null || echo "")
        
        if echo "$RESULT" | grep -q '"token"'; then
            pass "User registration"
        else
            fail "User registration"
        fi
        
        kill $BACKEND_PID 2>/dev/null || true
        wait $BACKEND_PID 2>/dev/null || true
    else
        skip "Dependencies not installed"
    fi
    
    # Test 5: LLM integration
    echo -e "${YELLOW}[5] LLM integration${NC}"
    if [ -n "$OPENROUTER_API_KEY" ] && [ -f "$PROJECT_ROOT/boneclaw/dist/boneclaw" ]; then
        RESULT=$("$PROJECT_ROOT/boneclaw/dist/boneclaw" "Say OK" 2>&1 | head -5 || true)
        if echo "$RESULT" | grep -q "agent:"; then
            pass "LLM responds"
        else
            fail "LLM call failed"
        fi
    else
        skip "OPENROUTER_API_KEY not set or binary missing"
    fi
fi

# Summary
echo ""
echo -e "${BOLD}========================================"
echo "  Results"
echo "========================================${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
echo ""

[ $FAILED -gt 0 ] && exit 1
exit 0
