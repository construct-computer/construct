# Backend Dockerfile
FROM oven/bun:1.2-alpine

WORKDIR /app

# Install dependencies
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Run the server
CMD ["bun", "run", "src/index.ts"]
