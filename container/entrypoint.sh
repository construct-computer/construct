#!/bin/bash
# BoneClaw Container Entrypoint - Minimal and efficient

set -e

# Start virtual display (minimal resources)
Xvfb :99 -screen 0 1280x720x16 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Wait for display
sleep 1

# Write config from environment if provided
if [ -n "$OPENROUTER_API_KEY" ]; then
    mkdir -p /home/agent/.boneclaw
    cat > /home/agent/.boneclaw/config.json << EOFCONFIG
{
  "openrouter": {
    "apiKey": "${OPENROUTER_API_KEY}",
    "model": "${OPENROUTER_MODEL:-nvidia/nemotron-nano-9b-v2:free}",
    "baseUrl": "https://openrouter.ai/api/v1"
  },
  "identity": {
    "name": "${BONECLAW_AGENT_NAME:-BoneClaw Agent}",
    "description": "${BONECLAW_AGENT_DESCRIPTION:-An autonomous AI agent}"
  },
  "goals": ${BONECLAW_GOALS:-[]},
  "schedules": ${BONECLAW_SCHEDULES:-[]},
  "memory": {
    "persistPath": "/home/agent/.boneclaw/memory",
    "maxContextTokens": 8000
  },
  "heartbeat": {
    "intervalMs": 60000
  },
  "workspace": "/home/agent"
}
EOFCONFIG
fi

# Graceful shutdown
cleanup() {
    echo "Shutting down..."
    kill $XVFB_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Start BoneClaw
if [ "$BONECLAW_AUTOSTART" = "1" ]; then
    exec /usr/local/bin/boneclaw --autonomous
else
    # Interactive mode - read from stdin
    exec /usr/local/bin/boneclaw
fi
