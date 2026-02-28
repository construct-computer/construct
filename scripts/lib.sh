#!/bin/bash
#
# lib.sh - Shared functions for construct.computer scripts
#
# Source this file from other scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#

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
