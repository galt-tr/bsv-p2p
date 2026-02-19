#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="bsv-p2p"

echo -e "${BLUE}BSV P2P Daemon Service Installer${NC}\n"

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    echo -e "${RED}✗${NC} Unsupported OS: $OSTYPE"
    exit 1
fi

# Function to install systemd service (Linux)
install_systemd() {
    echo -e "${BLUE}→${NC} Installing systemd service..."
    
    # Check if we should use user or system service
    if [ "$EUID" -eq 0 ]; then
        SERVICE_DIR="/etc/systemd/system"
        SYSTEMCTL="systemctl"
        echo -e "${YELLOW}⚠${NC} Installing as system service (root)"
    else
        SERVICE_DIR="$HOME/.config/systemd/user"
        SYSTEMCTL="systemctl --user"
        echo -e "${BLUE}ℹ${NC} Installing as user service"
    fi
    
    mkdir -p "$SERVICE_DIR"
    
    # Generate systemd unit file
    cat > "$SERVICE_DIR/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=BSV P2P Payment Channels Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_ROOT
ExecStart=$(which node) $PROJECT_ROOT/dist/daemon/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"

[Install]
WantedBy=default.target
EOF

    echo -e "${GREEN}✓${NC} Service file created at $SERVICE_DIR/${SERVICE_NAME}.service"
    
    # Reload systemd
    $SYSTEMCTL daemon-reload
    echo -e "${GREEN}✓${NC} systemd reloaded"
    
    # Enable service
    $SYSTEMCTL enable ${SERVICE_NAME}.service
    echo -e "${GREEN}✓${NC} Service enabled (will start on boot)"
    
    # Start service
    $SYSTEMCTL start ${SERVICE_NAME}.service
    echo -e "${GREEN}✓${NC} Service started"
    
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""
    echo "Manage the service with:"
    echo "  ${GREEN}$SYSTEMCTL status ${SERVICE_NAME}${NC}  - Check status"
    echo "  ${GREEN}$SYSTEMCTL start ${SERVICE_NAME}${NC}   - Start daemon"
    echo "  ${GREEN}$SYSTEMCTL stop ${SERVICE_NAME}${NC}    - Stop daemon"
    echo "  ${GREEN}$SYSTEMCTL restart ${SERVICE_NAME}${NC} - Restart daemon"
    echo "  ${GREEN}journalctl --user -u ${SERVICE_NAME} -f${NC} - View logs"
}

# Function to install launchd service (macOS)
install_launchd() {
    echo -e "${BLUE}→${NC} Installing launchd service..."
    
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.${SERVICE_NAME}.daemon.plist"
    
    mkdir -p "$PLIST_DIR"
    
    # Generate launchd plist
    cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.${SERVICE_NAME}.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$PROJECT_ROOT/dist/daemon/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_ROOT</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/.bsv-p2p/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.bsv-p2p/daemon-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

    echo -e "${GREEN}✓${NC} Service file created at $PLIST_FILE"
    
    # Load service
    launchctl load "$PLIST_FILE"
    echo -e "${GREEN}✓${NC} Service loaded and started"
    
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""
    echo "Manage the service with:"
    echo "  ${GREEN}launchctl list | grep ${SERVICE_NAME}${NC} - Check status"
    echo "  ${GREEN}launchctl start com.${SERVICE_NAME}.daemon${NC} - Start daemon"
    echo "  ${GREEN}launchctl stop com.${SERVICE_NAME}.daemon${NC} - Stop daemon"
    echo "  ${GREEN}tail -f ~/.bsv-p2p/daemon.log${NC} - View logs"
}

# Function to uninstall service
uninstall_service() {
    echo -e "${YELLOW}Uninstalling ${SERVICE_NAME} service...${NC}\n"
    
    if [ "$OS" = "linux" ]; then
        if [ "$EUID" -eq 0 ]; then
            SYSTEMCTL="systemctl"
            SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
        else
            SYSTEMCTL="systemctl --user"
            SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
        fi
        
        $SYSTEMCTL stop ${SERVICE_NAME}.service 2>/dev/null || true
        $SYSTEMCTL disable ${SERVICE_NAME}.service 2>/dev/null || true
        rm -f "$SERVICE_FILE"
        $SYSTEMCTL daemon-reload
        echo -e "${GREEN}✓${NC} Service uninstalled"
        
    elif [ "$OS" = "macos" ]; then
        PLIST_FILE="$HOME/Library/LaunchAgents/com.${SERVICE_NAME}.daemon.plist"
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        rm -f "$PLIST_FILE"
        echo -e "${GREEN}✓${NC} Service uninstalled"
    fi
}

# Main
case "${1:-install}" in
    install)
        if [ "$OS" = "linux" ]; then
            install_systemd
        elif [ "$OS" = "macos" ]; then
            install_launchd
        fi
        ;;
    uninstall)
        uninstall_service
        ;;
    *)
        echo "Usage: $0 [install|uninstall]"
        exit 1
        ;;
esac
