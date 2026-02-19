# BSV P2P Daemon

The BSV P2P daemon is a persistent background process that maintains libp2p connections, handles incoming messages, and manages payment channels.

## Installation

### Quick Install

```bash
# Install as a system service (starts on boot)
npm run daemon:install

# Or manually
bash scripts/install-service.sh
```

This will:
- **Linux**: Create a systemd user service
- **macOS**: Create a launchd agent
- **Auto-start**: Service starts on boot
- **Auto-restart**: Restarts on crash

### Uninstall

```bash
npm run daemon:uninstall
```

## Manual Usage

If you don't want to install as a service:

```bash
# Run in foreground
npm run daemon

# Or run the built version
node dist/daemon/index.js
```

## Service Management

### Linux (systemd)

```bash
# Check status
systemctl --user status bsv-p2p

# Start/stop/restart
systemctl --user start bsv-p2p
systemctl --user stop bsv-p2p
systemctl --user restart bsv-p2p

# View logs (live)
journalctl --user -u bsv-p2p -f

# View recent logs
journalctl --user -u bsv-p2p -n 100

# Disable auto-start
systemctl --user disable bsv-p2p
```

### macOS (launchd)

```bash
# Check status
launchctl list | grep bsv-p2p

# Start/stop
launchctl start com.bsv-p2p.daemon
launchctl stop com.bsv-p2p.daemon

# View logs
tail -f ~/.bsv-p2p/daemon.log
tail -f ~/.bsv-p2p/daemon-error.log

# Disable auto-start
launchctl unload ~/Library/LaunchAgents/com.bsv-p2p.daemon.plist
```

## Configuration

The daemon reads configuration from `~/.bsv-p2p/config.json`:

```json
{
  "p2p": {
    "listenAddrs": [
      "/ip4/0.0.0.0/tcp/4001",
      "/ip4/0.0.0.0/tcp/4002/ws"
    ],
    "announceAddrs": [],
    "bootstrapPeers": [],
    "topics": ["/openclaw/v1/announce"]
  },
  "daemon": {
    "socketPath": "/tmp/bsv-p2p.sock",
    "logLevel": "info"
  }
}
```

## Logs

- **Linux**: `journalctl --user -u bsv-p2p`
- **macOS**: `~/.bsv-p2p/daemon.log` and `daemon-error.log`
- **Manual run**: stdout/stderr

## Troubleshooting

### Service won't start

```bash
# Check logs for errors
journalctl --user -u bsv-p2p -n 50

# Verify Node.js path
which node

# Rebuild project
npm run build

# Try manual run to see errors
npm run daemon
```

### Port already in use

Edit `~/.bsv-p2p/config.json` and change the port numbers in `listenAddrs`.

### Can't connect to relay

Check your firewall settings. The daemon needs outbound access to:
- TCP port 4001 (libp2p)
- WebSocket connections

## OpenClaw Integration

To wake your OpenClaw agent on incoming P2P messages, add the daemon to your gateway hooks:

```json
{
  "hooks": {
    "bsv-p2p": {
      "command": "bsv-p2p",
      "args": ["notify", "--session", "${SESSION}"],
      "trigger": "incoming-message"
    }
  }
}
```

## Advanced

### Run as system service (requires root)

```bash
sudo bash scripts/install-service.sh

# Manage as system service
sudo systemctl status bsv-p2p
sudo systemctl start bsv-p2p
sudo journalctl -u bsv-p2p -f
```

### Custom installation location

Edit `scripts/install-service.sh` and update `PROJECT_ROOT` before running.

### Multiple instances

You can run multiple daemons with different peer IDs:

```bash
# Create separate directories
mkdir -p ~/.bsv-p2p-alice
mkdir -p ~/.bsv-p2p-bob

# Set env var before starting
BSV_P2P_HOME=~/.bsv-p2p-alice npm run daemon
```
