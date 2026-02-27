# BoneClaw Runtime Container - Minimal footprint
# Uses pre-compiled binary, no runtime dependencies

# ===========================================
# Stage 1: Build BoneClaw binary for Linux
# ===========================================
FROM oven/bun:1.2-debian AS builder

WORKDIR /build/boneclaw
COPY boneclaw/package.json boneclaw/bun.lock* ./
RUN bun install --frozen-lockfile

COPY boneclaw/src ./src
COPY boneclaw/tsconfig.json ./

# Compile to standalone binary (Bun embeds runtime)
# Target: linux-x64 for container compatibility
RUN bun build src/main.ts --compile --target=bun-linux-x64 --outfile /build/boneclaw-bin

# ===========================================
# Stage 2: Minimal runtime image
# ===========================================
FROM debian:bookworm-slim

# Install only essential dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium and minimal deps
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    # Virtual display
    xvfb \
    # Essential utilities
    bash \
    curl \
    ca-certificates \
    # Node.js for agent-browser (minimal)
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install agent-browser
RUN npm install -g agent-browser --omit=dev && \
    agent-browser install && \
    npm cache clean --force

# Create agent user with minimal permissions
RUN useradd -m -s /bin/bash -u 1000 agent && \
    mkdir -p /home/agent/.boneclaw/memory && \
    chown -R agent:agent /home/agent

# Copy the compiled BoneClaw binary (no runtime needed!)
COPY --from=builder /build/boneclaw-bin /usr/local/bin/boneclaw
RUN chmod +x /usr/local/bin/boneclaw

# Copy entrypoint
COPY container/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/agent

# Environment
ENV HOME=/home/agent \
    DISPLAY=:99 \
    AGENT_BROWSER_STREAM_PORT=9223 \
    CHROMIUM_PATH=/usr/bin/chromium \
    # Reduce Chromium memory usage
    CHROME_FLAGS="--disable-dev-shm-usage --no-sandbox --disable-gpu --disable-software-rasterizer"

# Expose ports for streaming
EXPOSE 9223

# Switch to non-root user
USER agent

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://localhost:9223/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
