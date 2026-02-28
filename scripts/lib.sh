#!/bin/bash
#
# lib.sh - Shared functions for construct.computer scripts
#
# Source this file from other scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#

# Base Docker image used by the sandbox container Dockerfile.
# Keep in sync with container/Dockerfile FROM line.
DOCKER_BASE_IMAGE="node:20-bookworm-slim"

# Detect the Bun cross-compilation target for the Docker container.
#
# Docker pulls images matching the host architecture by default, so the
# boneclaw binary must be compiled for the same arch.  We check `docker info`
# first (most accurate — reflects the actual Docker daemon arch), then fall
# back to `uname -m` on the host.
#
# Returns one of: bun-linux-x64, bun-linux-arm64
detect_bun_target() {
    local arch=""

    # Prefer Docker daemon architecture (handles remote Docker, colima, etc.)
    if command -v docker &>/dev/null; then
        arch=$(docker info --format '{{.Architecture}}' 2>/dev/null || true)
    fi

    # Fall back to host architecture
    if [ -z "$arch" ]; then
        arch=$(uname -m)
    fi

    case "$arch" in
        x86_64|amd64)   echo "bun-linux-x64" ;;
        aarch64|arm64)   echo "bun-linux-arm64" ;;
        *)
            echo "Error: unsupported architecture '$arch'" >&2
            echo "bun-linux-x64"  # safe default
            ;;
    esac
}

# Pull all base Docker images required by the container build.
# This runs before `docker build` so that:
#   1. Network failures surface early with a clear message
#   2. Subsequent builds can run fully offline from cache
#
# Passes through any failure so callers can abort before attempting the build.
pull_base_images() {
    echo "  Pulling base image: ${DOCKER_BASE_IMAGE}..."
    if ! docker pull "$DOCKER_BASE_IMAGE"; then
        echo ""
        echo "ERROR: Failed to pull ${DOCKER_BASE_IMAGE}." >&2
        echo "Check your network connection and Docker Hub access." >&2
        echo "If you're offline, this will work if the image was previously pulled." >&2
        return 1
    fi
}
