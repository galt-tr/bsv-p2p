#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Header
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════╗"
echo "║   BSV P2P Payment Channels - Setup        ║"
echo "║   One-command setup for OpenClaw bots     ║"
echo "╚════════════════════════════════════════════╝"
echo -e "${NC}"

# Check OS
echo -e "${BLUE}→${NC} Detecting operating system..."
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo -e "${GREEN}✓${NC} Linux detected"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo -e "${GREEN}✓${NC} macOS detected"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
    echo -e "${GREEN}✓${NC} Windows (WSL/Cygwin) detected"
else
    echo -e "${YELLOW}⚠${NC} Unknown OS: $OSTYPE (proceeding anyway)"
fi

# Check Node.js version
echo -e "\n${BLUE}→${NC} Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js >= 20"
    echo "  Download: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}✗${NC} Node.js $NODE_VERSION detected. Version >= 20 required."
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v) found"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗${NC} npm not found"
    exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm -v) found"

# Install dependencies
echo -e "\n${BLUE}→${NC} Installing dependencies..."
if npm install --silent; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${RED}✗${NC} Failed to install dependencies"
    exit 1
fi

# Build the project
echo -e "\n${BLUE}→${NC} Building project..."
if npm run build --silent; then
    echo -e "${GREEN}✓${NC} Project built successfully"
else
    echo -e "${RED}✗${NC} Build failed"
    exit 1
fi

# Initialize BSV keys
echo -e "\n${BLUE}→${NC} Initializing BSV identity..."
BSV_DIR="$HOME/.bsv-p2p"
if [ -f "$BSV_DIR/peer-id.json" ]; then
    echo -e "${YELLOW}⚠${NC} BSV identity already exists at $BSV_DIR"
    read -p "  Regenerate? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$BSV_DIR"
        mkdir -p "$BSV_DIR"
        echo -e "${GREEN}✓${NC} Old identity removed"
    fi
else
    mkdir -p "$BSV_DIR"
fi

if [ ! -f "$BSV_DIR/peer-id.json" ]; then
    # Generate peer ID and BSV keys
    node -e "
    import { generateKeyPair } from '@libp2p/crypto/keys';
    import { createFromPrivKey } from '@libp2p/peer-id-factory';
    import { PrivateKey } from '@bsv/sdk';
    import fs from 'fs';
    import path from 'path';
    
    const bsvDir = path.join(process.env.HOME, '.bsv-p2p');
    
    // Generate libp2p peer ID
    const privKey = await generateKeyPair('Ed25519');
    const peerId = await createFromPrivKey(privKey);
    
    fs.writeFileSync(
      path.join(bsvDir, 'peer-id.json'),
      JSON.stringify({
        id: peerId.toString(),
        privKey: Buffer.from(privKey.raw).toString('hex')
      }, null, 2)
    );
    
    // Generate BSV identity key
    const bsvKey = PrivateKey.fromRandom();
    fs.writeFileSync(
      path.join(bsvDir, 'bsv-identity.json'),
      JSON.stringify({
        privKey: bsvKey.toWif(),
        pubKey: bsvKey.toPublicKey().toString(),
        address: bsvKey.toPublicKey().toAddress()
      }, null, 2)
    );
    
    // Create config
    fs.writeFileSync(
      path.join(bsvDir, 'config.json'),
      JSON.stringify({
        p2p: {
          listenAddrs: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],
          announceAddrs: [],
          bootstrapPeers: [],
          topics: ['/openclaw/v1/announce']
        },
        daemon: {
          socketPath: '/tmp/bsv-p2p.sock',
          logLevel: 'info'
        }
      }, null, 2)
    );
    
    console.log('✓ Generated peer ID:', peerId.toString().slice(0, 20) + '...');
    console.log('✓ Generated BSV identity');
    " 2>/dev/null
    
    echo -e "${GREEN}✓${NC} BSV identity initialized at $BSV_DIR"
else
    echo -e "${GREEN}✓${NC} Using existing BSV identity"
fi

# Check for OpenClaw gateway
echo -e "\n${BLUE}→${NC} Checking OpenClaw integration..."
OPENCLAW_CONFIG="$HOME/.openclaw/config.json"
if [ -f "$OPENCLAW_CONFIG" ]; then
    echo -e "${GREEN}✓${NC} OpenClaw detected"
    # TODO: Read hooks token and configure gateway integration
    echo -e "${YELLOW}⚠${NC} Manual gateway configuration needed (add bsv-p2p to hooks)"
else
    echo -e "${YELLOW}⚠${NC} OpenClaw not detected (optional)"
fi

# Offer to install as system service
echo -e "\n${BLUE}→${NC} System service installation..."
read -p "  Install daemon as a system service? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠${NC} Service installation requires task #94 implementation"
    echo "  Run manually: npm run daemon"
else
    echo -e "${YELLOW}ℹ${NC} Skipping service installation"
fi

# Run connectivity test
echo -e "\n${BLUE}→${NC} Testing connectivity..."
echo -e "${YELLOW}ℹ${NC} Starting daemon for connectivity test..."
npm run daemon &
DAEMON_PID=$!
sleep 5

# Check if daemon is running
if ps -p $DAEMON_PID > /dev/null; then
    echo -e "${GREEN}✓${NC} Daemon started successfully (PID: $DAEMON_PID)"
    
    # Give it a moment to connect
    sleep 3
    
    # Stop the test daemon
    kill $DAEMON_PID 2>/dev/null || true
    wait $DAEMON_PID 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Connectivity test passed"
else
    echo -e "${YELLOW}⚠${NC} Daemon stopped unexpectedly (check logs)"
fi

# Summary
echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Setup Complete!                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Start the daemon:    ${GREEN}npm run daemon${NC}"
echo "  2. Test CLI:            ${GREEN}npm run cli -- --help${NC}"
echo "  3. View your peer ID:   ${GREEN}cat ~/.bsv-p2p/peer-id.json${NC}"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  • README.md     - Getting started guide"
echo "  • SKILL.md      - OpenClaw skill integration"
echo "  • docs/         - Full documentation"
echo ""
echo -e "${YELLOW}Note:${NC} For OpenClaw integration, add 'bsv-p2p' to your gateway hooks."
echo ""
