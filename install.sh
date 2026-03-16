#!/bin/bash

# Pingpong Automated Installation Script for Oh-My-Pi
# This script installs pingpong as a skill in oh-my-pi

set -e

echo "🎯 Installing Pingpong for Oh-My-Pi..."

# Detect oh-my-pi skills directory
OMP_SKILLS_DIR="${HOME}/.omp/skills"
PINGPONG_DIR="${OMP_SKILLS_DIR}/pingpong"

# Create skills directory if it doesn't exist
mkdir -p "${OMP_SKILLS_DIR}"

# Clone or update pingpong
if [ -d "${PINGPONG_DIR}" ]; then
    echo "📦 Updating existing pingpong installation..."
    cd "${PINGPONG_DIR}"
    git pull
else
    echo "📦 Cloning pingpong repository..."
    git clone https://github.com/ajaxdude/pingpong.git "${PINGPONG_DIR}"
    cd "${PINGPONG_DIR}"
fi

# Install dependencies and build
echo "🔧 Installing dependencies..."
npm install

echo "🏗️  Building pingpong..."
npm run build

# Create example config in current directory if it doesn't exist
if [ ! -f "pingpong.config.json" ]; then
    echo "📝 Creating pingpong.config.example.json in current directory..."
    cp "${PINGPONG_DIR}/pingpong.config.example.json" ./pingpong.config.example.json
    echo ""
    echo "✅ Installation complete!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Copy pingpong.config.example.json to your project root as pingpong.config.json"
    echo "   2. Edit pingpong.config.json to set your LLM endpoint (default: http://127.0.0.1:8080/v1/chat/completions)"
    echo "   3. Ensure llama.cpp is running on port 8080"
    echo "   4. Add pingpong to your MCP client configuration"
    echo ""
    echo "📖 Full documentation: https://github.com/ajaxdude/pingpong"
else
    echo "✅ Pingpong is already installed and up to date!"
    echo ""
    echo "📖 Documentation: https://github.com/ajaxdude/pingpong"
fi