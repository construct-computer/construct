#!/bin/bash
# Quick reset - no prompts, just removes containers and database

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Removing sandbox containers..."
docker rm -f $(docker ps -a --filter "name=sandbox-" --format "{{.Names}}" 2>/dev/null) 2>/dev/null || true

echo "Removing database..."
rm -f "$PROJECT_DIR/backend/data/construct.db"* 2>/dev/null || true

echo "Done! Clear browser localStorage and restart servers."
