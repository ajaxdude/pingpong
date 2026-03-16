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

# Get the absolute path to mcp.js
PINGPONG_MCP="${PINGPONG_DIR}/dist/mcp.js"


# Go back to original directory for config copy
cd "${ORIGINAL_DIR}"

# Create example config in current directory if it doesn't exist
if [ ! -f "pingpong.config.json" ] && [ ! -f "pingpong.config.example.json" ]; then
    echo "📝 Creating pingpong.config.example.json in current directory..."
    cp "${PINGPONG_DIR}/pingpong.config.example.json" ./pingpong.config.example.json
fi

# Copy agent template files to ~/.omp/agent/
echo ""
echo "📄 Installing agent template files..."

# Copy APPEND_SYSTEM.md if it doesn't exist or ask to overwrite
if [ -f "${OMP_AGENT_DIR}/APPEND_SYSTEM.md" ]; then
    echo "⚠️  Existing APPEND_SYSTEM.md found at ${OMP_AGENT_DIR}/APPEND_SYSTEM.md"
    
    # Check if running interactively
    if [ -t 0 ]; then
        if read -t 5 -p "Overwrite with pingpong template? [y/N] [default: N]: " overwrite; then
            if [[ $overwrite =~ ^[Yy]$ ]]; then
                cp "${PINGPONG_DIR}/templates/APPEND_SYSTEM.md" "${OMP_AGENT_DIR}/APPEND_SYSTEM.md"
                echo "✅ Updated APPEND_SYSTEM.md"
            else
                echo "⏭️  Keeping existing APPEND_SYSTEM.md"
            fi
        else
            echo ""
            echo "⏱️  No input received - keeping existing APPEND_SYSTEM.md"
        fi
    else
        echo "📋 Keeping existing APPEND_SYSTEM.md (run interactively to overwrite)"
    fi
else
    cp "${PINGPONG_DIR}/templates/APPEND_SYSTEM.md" "${OMP_AGENT_DIR}/APPEND_SYSTEM.md"
    echo "✅ Created APPEND_SYSTEM.md"
fi

# Copy LLAMACPP.md if it doesn't exist or ask to overwrite
if [ -f "${OMP_AGENT_DIR}/LLAMACPP.md" ]; then
    echo "⚠️  Existing LLAMACPP.md found at ${OMP_AGENT_DIR}/LLAMACPP.md"
    
    # Check if running interactively
    if [ -t 0 ]; then
        if read -t 5 -p "Overwrite with pingpong template? [y/N] [default: N]: " overwrite; then
            if [[ $overwrite =~ ^[Yy]$ ]]; then
                cp "${PINGPONG_DIR}/templates/LLAMACPP.md" "${OMP_AGENT_DIR}/LLAMACPP.md"
                echo "✅ Updated LLAMACPP.md"
            else
                echo "⏭️  Keeping existing LLAMACPP.md"
            fi
        else
            echo ""
            echo "⏱️  No input received - keeping existing LLAMACPP.md"
        fi
    else
        echo "📋 Keeping existing LLAMACPP.md (run interactively to overwrite)"
    fi
else
    cp "${PINGPONG_DIR}/templates/LLAMACPP.md" "${OMP_AGENT_DIR}/LLAMACPP.md"
    echo "✅ Created LLAMACPP.md"
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
    jq --arg index "${PINGPONG_MCP}" '.mcpServers.pingpong = {
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
      "args": ["${PINGPONG_MCP}"]
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
      "args": ["${PINGPONG_MCP}"]
    }
  }
}
EOF
    echo "✅ Created MCP configuration with pingpong server"
else
    # mcp.json exists - try interactive, fallback to automatic
    if [ -t 0 ]; then
        # Try interactive mode with timeout
        echo "⚠️  Existing MCP configuration found at ${MCP_CONFIG}"
        echo ""
        echo "Choose an option (will auto-select option 1 in 5 seconds):"
        echo "  1) Add pingpong to existing configuration (recommended)"
        echo "  2) Replace entire MCP configuration"
        echo "  3) Skip MCP configuration"
        echo ""
        
        # Read with timeout (requires bash 4+)
        if read -t 5 -p "Enter choice (1-3) [default: 1]: " choice; then
            case $choice in
                1|"")
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
                    echo "❌ Invalid choice. Adding pingpong to existing configuration..."
                    add_pingpong_to_config
                    ;;
            esac
        else
            # Timeout or no input - use default
            echo ""
            echo "⏱️  No input received - using default option (add to existing config)"
            add_pingpong_to_config
        fi
    else
        # No terminal - automatic mode
        echo "⚠️  Existing MCP configuration found at ${MCP_CONFIG}"
        echo "📋 Running in automatic mode - adding pingpong to existing configuration..."
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
echo "   4. Restart your oh-my-pi agent to load the MCP configuration and templates"
echo ""
echo "📖 Full documentation: https://github.com/ajaxdude/pingpong"
echo ""
echo "🔧 Installed templates:"
echo "   ${OMP_AGENT_DIR}/APPEND_SYSTEM.md - Agent system prompt template"
echo "   ${OMP_AGENT_DIR}/LLAMACPP.md - LLM configuration template"
echo ""
if [ -f "${MCP_CONFIG}" ]; then
    echo "🔧 MCP Configuration:"
    echo "   Location: ${MCP_CONFIG}"
    echo "   Content:"
    cat "${MCP_CONFIG}" | head -20
fi