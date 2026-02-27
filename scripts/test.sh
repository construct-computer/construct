#!/bin/bash
# Test script for construct.computer components

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }

echo "============================================"
echo "  construct.computer - Test Suite"
echo "============================================"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: BoneClaw binary exists and runs
echo "Test 1: BoneClaw binary"
if [ -f "$PROJECT_ROOT/boneclaw/dist/boneclaw" ]; then
    if "$PROJECT_ROOT/boneclaw/dist/boneclaw" --version &> /dev/null; then
        success "BoneClaw binary works"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        fail "BoneClaw binary exists but doesn't run"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    fail "BoneClaw binary not found (run ./scripts/setup.sh)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 2: Backend starts
echo ""
echo "Test 2: Backend server"
cd "$PROJECT_ROOT/backend"

# Start backend in background
bun run src/index.ts &
BACKEND_PID=$!
sleep 3

# Check health endpoint
if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    success "Backend health check passed"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    fail "Backend health check failed"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Kill backend
kill $BACKEND_PID 2>/dev/null || true
wait $BACKEND_PID 2>/dev/null || true

# Test 3: Auth flow
echo ""
echo "Test 3: Authentication flow"

# Start backend again
bun run src/index.ts &
BACKEND_PID=$!
sleep 3

# Register user
REGISTER_RESULT=$(curl -sf -X POST http://localhost:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"username":"testuser_'$$'","password":"testpassword123"}' 2>/dev/null || echo "FAILED")

if echo "$REGISTER_RESULT" | grep -q '"token"'; then
    success "User registration works"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    # User might already exist, try login
    LOGIN_RESULT=$(curl -sf -X POST http://localhost:3000/api/auth/login \
        -H "Content-Type: application/json" \
        -d '{"username":"testuser","password":"testpassword123"}' 2>/dev/null || echo "FAILED")
    
    if echo "$LOGIN_RESULT" | grep -q '"token"'; then
        success "User login works"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        fail "Authentication failed"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
fi

# Kill backend
kill $BACKEND_PID 2>/dev/null || true
wait $BACKEND_PID 2>/dev/null || true

# Test 4: BoneClaw with mock API (if key provided)
echo ""
echo "Test 4: BoneClaw LLM integration"

if [ -n "$OPENROUTER_API_KEY" ]; then
    RESULT=$("$PROJECT_ROOT/boneclaw/dist/boneclaw" "Reply with just 'OK'" 2>&1 || true)
    
    if echo "$RESULT" | grep -q '"type":"agent:complete"'; then
        success "BoneClaw LLM integration works"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        fail "BoneClaw LLM call failed"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    info "Skipped (OPENROUTER_API_KEY not set)"
fi

# Test 5: Docker container build (if Docker available)
echo ""
echo "Test 5: Docker container"

if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    if docker images boneclaw-runtime:latest --format '{{.ID}}' | grep -q .; then
        success "Docker container image exists"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        info "Container not built (run ./scripts/build-container.sh)"
    fi
else
    info "Skipped (Docker not available)"
fi

# Summary
echo ""
echo "============================================"
echo "  Test Results"
echo "============================================"
echo ""
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
