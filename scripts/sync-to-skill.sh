#!/bin/bash
# Deploy compiled output to the local OMP skill installation.
# Run this after `npm run build` to make the skill folder current.
set -euo pipefail

SKILL_PATH="$HOME/.omp/skills/pingpong"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Building..."
cd "$PROJECT_ROOT"
npm run build

echo "Syncing dist/ -> $SKILL_PATH/dist/"
mkdir -p "$SKILL_PATH/dist/tools"
rsync -a --delete "$PROJECT_ROOT/dist/" "$SKILL_PATH/dist/"

echo "Syncing templates/ -> $SKILL_PATH/templates/"
mkdir -p "$SKILL_PATH/templates"
rsync -a --delete "$PROJECT_ROOT/templates/" "$SKILL_PATH/templates/"

echo "Updating package.json reference..."
cp "$PROJECT_ROOT/package.json" "$SKILL_PATH/package.json"

echo "Done. Restart OMP to load the updated skill."
