#!/bin/bash

# Pingpong Automated Installation Script for Oh-My-Pi
# This script installs pingpong as a skill in oh-my-pi and configures MCP

set -e

echo "🎯 Installing Pingpong for Oh-My-Pi..."

# Remember the original working directory
ORIGINAL_DIR="$(pwd)"

# Detect oh-my-pi directories
OMP_SKILLS_DIR="${HOME}/.omp/skills"
OMP_AGENT_DIR="${HOME}/.omp/agent"
PINGPONG_DIR="${OMP_SKILLS_DIR}/pingpong"
MCP_CONFIG="${OMP_AGENT_DIR}/mcp.json"

# Create directories if they don't exist
mkdir -p "${OMP_SKILLS_DIR}"
mkdir -p "${OMP_AGENT_DIR}"

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

# Get the absolute path to index.js
PINGPONG_INDEX="${PINGPONG_DIR}/dist/index.js"

# Go back to original directory for config copy
cd "${ORIGINAL_DIR}"

# Create example config in current directory if it doesn't exist
if [ ! -f "pingpong.config.json" ] && [ ! -f "pingpong.config.example.json" ]; then
    echo "📝 Creating pingpong.config.example.json in current directory..."
    cp "${PINGPONG_DIR}/pingpong.config.example.json" ./pingpong.config.example.json
fi

# Handle MCP configuration
echo ""
echo "🔧 Configuring MCP for Oh-My-Pi..."

# Function to add pingpong to existing config
add_pingpong_to_config() {
    local temp_file=$(mktemp)
    
    # Check if pingpong already exists in config
    if grep -q '"pingpong"' "${MCP_CONFIG}"; then
        echo "🔄 Pingpong already exists in MCP configuration. Updating..."
        # Remove existing pingpong entry
        jq 'del(.mcpServers.pingpong)' "${MCP_CONFIG}" > "${temp_file}"
        mv "${temp_file}" "${MCP_CONFIG}"
    fi
    
    # Add pingpong to existing config
    temp_file=$(mktemp)
    jq --arg index "${PINGPONG_INDEX}" '.mcpServers.pingpong = {
        "type": "stdio",
        "command": "node",
        "args": [$index]
    }' "${MCP_CONFIG}" > "${temp_file}"
    mv "${temp_file}" "${MCP_CONFIG}"
    echo "✅ Added pingpong to MCP configuration"
}

# Function to replace entire config
replace_config() {
    cat > "${MCP_CONFIG}" <<EOF
{
  "mcpServers": {
    "pingpong": {
      "type": "stdio",
      "command": "node",
      "args": ["${PINGPONG_INDEX}"]
    }
  }
}
EOF
    echo "✅ Replaced MCP configuration with pingpong server"
}

if [ ! -f "${MCP_CONFIG}" ]; then
    # Create new mcp.json
    echo "📝 Creating new MCP configuration at ${MCP_CONFIG}..."
    cat > "${MCP_CONFIG}" <<EOF
{
  "mcpServers": {
    "pingpong": {
      "type": "stdio",
      "command": "node",
      "args": ["${PINGPONG_INDEX}"]
    }
  }
}
EOF
    echo "✅ Created MCP configuration with pingpong server"
else
    # mcp.json exists - check if running interactively
    if [ -t 0 ]; then
        # Running interactively (terminal input available)
        echo "⚠️  Existing MCP configuration found at ${MCP_CONFIG}"
        echo ""
        echo "Choose an option:"
        echo "  1) Add pingpong to existing configuration (recommended)"
        echo "  2) Replace entire MCP configuration"
        echo "  3) Skip MCP configuration"
        echo ""
        read -p "Enter choice (1-3): " choice

        case $choice in
            1)
                echo "➕ Adding pingpong to existing MCP configuration..."
                add_pingpong_to_config
                ;;
            2)
                echo "🔄 Replacing MCP configuration..."
                replace_config
                ;;
            3)
                echo "⏭️  Skipping MCP configuration"
                echo "   You can manually add pingpong to ${MCP_CONFIG} later"
                ;;
            *)
                echo "❌ Invalid choice. Skipping MCP configuration"
                ;;
        esac
    else
        # Running non-interactively (piped input)
        echo "⚠️  Existing MCP configuration found at ${MCP_CONFIG}"
        echo "📋 Running in non-interactive mode - adding pingpong to existing configuration..."
        echo "   (To run interactively: download script and run directly)"
        add_pingpong_to_config
    fi
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Copy pingpong.config.example.json to your project root as pingpong.config.json"
echo "   2. Edit pingpong.config.json to set your LLM endpoint (default: http://127.0.0.1:8080/v1/chat/completions)"
echo "   3. Ensure llama.cpp is running on port 8080"
echo "   4. Restart your oh-my-pi agent to load the MCP configuration"
echo ""
echo "📖 Full documentation: https://github.com/ajaxdude/pingpong"
echo ""
if [ -f "${MCP_CONFIG}" ]; then
    echo "🔧 MCP Configuration:"
    echo "   Location: ${MCP_CONFIG}"
    echo "   Content:"
    cat "${MCP_CONFIG}" | head -20
fi