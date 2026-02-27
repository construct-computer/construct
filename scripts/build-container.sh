#!/bin/bash
# Build the BoneClaw runtime Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  Building BoneClaw Runtime Container"
echo "============================================"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo "Error: Docker daemon is not running"
    exit 1
fi

cd "$PROJECT_ROOT"

# Build the container
echo "Building container image..."
echo "This may take several minutes on first build."
echo ""

docker build \
    -t boneclaw-runtime:latest \
    -f container/Dockerfile \
    . \
    --progress=plain

echo ""
echo "============================================"
echo "  Build Complete!"
echo "============================================"
echo ""
echo "Image: boneclaw-runtime:latest"
echo "Size: $(docker images boneclaw-runtime:latest --format '{{.Size}}')"
echo ""
echo "Test the container:"
echo ""
echo "  docker run -it --rm \\"
echo "    -e OPENROUTER_API_KEY=your-key \\"
echo "    -e BONECLAW_AUTOSTART=1 \\"
echo "    -p 9223:9223 \\"
echo "    boneclaw-runtime:latest"
echo ""
