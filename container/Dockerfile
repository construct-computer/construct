# Sandbox container image - fully isolated user environment
FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium runtime dependencies (needed by agent-browser's bundled Chromium)
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-roboto \
    fontconfig \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    # Xvfb for non-headless mode (maximum stealth)
    xvfb \
    # PulseAudio — virtual audio backend for WebRTC (Google Meet, Zoom, etc.)
    pulseaudio \
    # General tools
    sudo \
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    procps \
    # tmux for shared terminal sessions (agent + frontend use same PTY)
    tmux \
    # Python
    python3 \
    python3-pip \
    python3-venv \
    # Build tools
    build-essential \
    # Supervisor to run multiple processes
    supervisor \
    # Clean up
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Install agent-browser globally and download its bundled Chromium.
# Use a shared path so the sandbox user (non-root) can find the browsers.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN npm install -g agent-browser && agent-browser install && chmod -R o+rx /opt/browsers

# agent-browser stream server port (WebSocket screencast)
ENV AGENT_BROWSER_STREAM_PORT=9224


# Timezone — must match the browser context timezoneId for consistency
ENV TZ=America/New_York

# Create sandbox user (use UID 1001 to avoid conflict with node user)
RUN useradd -m -s /bin/bash -u 1001 sandbox && \
    mkdir -p /home/sandbox/workspace && \
    mkdir -p /home/sandbox/.boneclaw && \
    chown -R sandbox:sandbox /home/sandbox && \
    echo 'sandbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/sandbox && \
    chmod 0440 /etc/sudoers.d/sandbox

# agent-browser config — passed to Chromium at launch time.
# - fake media devices: provides virtual camera/mic so Google Meet (and similar)
#   can call getUserMedia() and get working audio/video streams.
# - disable AutomationControlled: removes navigator.webdriver=true at the C++ level.
# - autoplay policy: allow media autoplay without user gesture (needed for WebRTC).
RUN mkdir -p /home/sandbox/.agent-browser && \
    echo '{"args":"--use-fake-device-for-media-stream,--use-fake-ui-for-media-stream,--disable-blink-features=AutomationControlled,--autoplay-policy=no-user-gesture-required"}' \
    > /home/sandbox/.agent-browser/config.json && \
    chown -R sandbox:sandbox /home/sandbox/.agent-browser

# Install global npm packages
RUN npm install -g typescript ts-node nodemon

# Configure PulseAudio system-wide so sandbox user can access it.
# Creates a virtual speaker + microphone so WebRTC has audio devices.
RUN mkdir -p /run/pulse && chmod 777 /run/pulse && \
    (adduser sandbox pulse-access 2>/dev/null || usermod -a -G pulse-access sandbox 2>/dev/null || true) && \
    mkdir -p /etc/pulse && \
    printf '%s\n' \
      'load-module module-native-protocol-unix auth-anonymous=1 socket=/run/pulse/native' \
      'load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description=Virtual_Speaker' \
      'load-module module-null-source source_name=virtual_mic source_properties=device.description=Virtual_Microphone' \
      'set-default-sink virtual_speaker' \
      'set-default-source virtual_mic' \
    > /etc/pulse/system.pa

# Create browser-server directory and copy files
WORKDIR /opt/browser-server

# Copy package files first for better caching
COPY package.json tsconfig.json ./
RUN npm install

# Copy and build browser server + desktop MCP server
COPY browser-server.ts desktop-mcp.ts ./
RUN npm run build

# --- Install boneclaw agent binary ---
# The binary must be pre-built for the matching architecture and placed in bin/.
# Build scripts auto-detect the Docker platform arch (arm64 vs x64):
#   ./scripts/build.sh boneclaw
COPY bin/boneclaw /usr/local/bin/boneclaw
RUN chmod +x /usr/local/bin/boneclaw

# notify-send shim — routes CLI `notify-send` calls through boneclaw's
# /notify HTTP endpoint so they appear as real desktop toast notifications,
# even when the LLM ignores the built-in notify tool.
# Inlined as a heredoc so it survives reset.sh --hard (which nukes container/bin/).
# Written to /usr/bin/ to overwrite any system notify-send from libnotify-bin.
COPY <<'SHIM' /usr/bin/notify-send
#!/bin/bash
set -euo pipefail
PORT="${BONECLAW_PORT:-9223}"
VARIANT="info"
TITLE=""
BODY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) echo "Usage: notify-send [OPTIONS] <summary> [body]"; exit 0 ;;
    -u|--urgency) case "${2:-normal}" in critical) VARIANT="error" ;; *) VARIANT="info" ;; esac; shift 2 ;;
    --urgency=*) case "${1#*=}" in critical) VARIANT="error" ;; *) VARIANT="info" ;; esac; shift ;;
    -i|--icon|-t|--expire-time) shift 2 ;;
    --icon=*|--expire-time=*) shift ;;
    -h|--hint) shift 2 ;;
    --hint=*) shift ;;
    -*) shift ;;
    *) if [[ -z "$TITLE" ]]; then TITLE="$1"; elif [[ -z "$BODY" ]]; then BODY="$1"; fi; shift ;;
  esac
done
if [[ -z "$TITLE" ]]; then echo "Error: summary required" >&2; exit 1; fi
JSON=$(printf '{"title":"%s","body":"%s","variant":"%s"}' \
  "$(echo "$TITLE" | sed 's/"/\\"/g')" \
  "$(echo "$BODY" | sed 's/"/\\"/g')" \
  "$VARIANT")
exec curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "$JSON" "http://127.0.0.1:${PORT}/notify"
SHIM
RUN chmod +x /usr/bin/notify-send

# Copy boneclaw config template
COPY boneclaw.yaml /etc/boneclaw/config.yaml

# Create supervisor config to run browser-server + boneclaw
RUN mkdir -p /var/log/supervisor
COPY <<EOF /etc/supervisor/conf.d/supervisord.conf
[unix_http_server]
file=/var/run/supervisor.sock

[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[program:xvfb]
command=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp
user=root
autostart=true
autorestart=true
priority=5
stdout_logfile=/var/log/supervisor/xvfb.log
stderr_logfile=/var/log/supervisor/xvfb-error.log

[program:pulseaudio]
command=/usr/bin/pulseaudio --daemonize=no --system --disallow-exit --disallow-module-loading --log-target=stderr
user=root
autostart=true
autorestart=true
priority=6
stdout_logfile=/var/log/supervisor/pulseaudio.log
stderr_logfile=/var/log/supervisor/pulseaudio-error.log

[program:tmux-session]
command=/usr/bin/tmux new-session -d -s main -c /home/sandbox/workspace
user=sandbox
autostart=true
autorestart=false
startsecs=0
priority=6
environment=HOME="/home/sandbox",USER="sandbox"
stdout_logfile=/var/log/supervisor/tmux.log
stderr_logfile=/var/log/supervisor/tmux-error.log

[program:browser-server]
command=node /opt/browser-server/dist/browser-server.js
user=sandbox
autostart=true
autorestart=true
priority=10
stdout_logfile=/var/log/supervisor/browser-server.log
stderr_logfile=/var/log/supervisor/browser-server-error.log
environment=HOME="/home/sandbox",USER="sandbox",DISPLAY=":99",AGENT_BROWSER_STREAM_PORT="9224",PLAYWRIGHT_BROWSERS_PATH="/opt/browsers",PULSE_SERVER="/run/pulse/native"

[program:boneclaw]
command=/usr/local/bin/boneclaw --config /etc/boneclaw/config.yaml
user=sandbox
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/boneclaw.log
stderr_logfile=/var/log/supervisor/boneclaw-error.log
environment=HOME="/home/sandbox",USER="sandbox",DISPLAY=":99",AGENT_BROWSER_STREAM_PORT="9224",PLAYWRIGHT_BROWSERS_PATH="/opt/browsers",AGENT_BROWSER_SESSION="default",PULSE_SERVER="/run/pulse/native"
EOF

# Set workspace directory
WORKDIR /home/sandbox/workspace

# Switch ownership of workspace to sandbox user
RUN chown -R sandbox:sandbox /home/sandbox

# Set environment
ENV HOME=/home/sandbox
ENV USER=sandbox
ENV SHELL=/bin/bash
ENV TERM=xterm-256color
ENV BONECLAW_PORT=9223

# Expose browser server port + boneclaw HTTP transport port
EXPOSE 9222 9223

# Run supervisor (which starts browser-server + boneclaw)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
