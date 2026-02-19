# BSV P2P Plugin Installation Guide

This guide explains how to install and configure the BSV P2P payment channels plugin for OpenClaw.

## What is the Plugin?

The BSV P2P plugin runs **inside your OpenClaw gateway process**, eliminating the need for a separate daemon. It provides native agent tools for peer-to-peer messaging and BSV micropayments.

**Key Benefits:**
- ✅ No separate daemon process to manage
- ✅ No HTTP overhead (direct function calls)
- ✅ Unified lifecycle (starts/stops with gateway)
- ✅ Better performance and simpler deployment

## Prerequisites

- OpenClaw gateway installed and running
- Node.js v22+ (already required by OpenClaw)
- Git (for local installation)

## Installation Methods

### Method 1: Local Installation (Recommended for Development)

If you have the bsv-p2p project cloned locally:

```bash
# Navigate to the project
cd ~/projects/bsv-p2p

# Install the plugin
openclaw plugins install -l ./extensions/bsv-p2p

# Verify installation
openclaw plugins list
```

You should see:
```
✓ bsv-p2p (local) - BSV P2P Payment Channels
  Location: /home/user/projects/bsv-p2p/extensions/bsv-p2p
  Status: enabled
```

### Method 2: npm Installation (Coming Soon)

Once published to npm:

```bash
openclaw plugins install @openclaw/bsv-p2p
```

## Configuration

After installation, add the plugin configuration to your OpenClaw config file (`~/.openclaw/openclaw.json` or your custom config location):

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4001,
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk",
          "walletPath": "~/.bsv-p2p/wallet.db",
          "autoAcceptChannelsBelowSats": 10000
        }
      }
    }
  }
}
```

### Minimal Configuration

The only required field is `enabled: true`. The plugin will use sensible defaults:

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true
      }
    }
  }
}
```

**Default values:**
- `port`: 4001
- `relayAddress`: Public relay server (167.172.134.84:4001)
- `walletPath`: `~/.bsv-p2p/wallet.db`
- `autoAcceptChannelsBelowSats`: 10000 (auto-accept channels up to 10k sats)

See [PLUGIN-CONFIG.md](./PLUGIN-CONFIG.md) for all configuration options.

## Verification

### 1. Check Plugin Status

```bash
openclaw plugins list
```

Look for `bsv-p2p` with `enabled` status.

### 2. Restart Gateway

The plugin loads when the gateway starts:

```bash
openclaw gateway restart
```

### 3. Check P2P Status

Use the `p2p_status` agent tool to verify the P2P node is running:

In your OpenClaw chat:
```
What's my P2P status?
```

Or via command line (if using OpenClaw CLI):
```bash
openclaw p2p status
```

You should see:
- Your Peer ID (e.g., `12D3KooW...`)
- Relay connection status
- Connected peers count
- Wallet balance

### 4. Check Gateway Logs

```bash
# View gateway logs
openclaw gateway logs

# Or follow logs in real-time
openclaw gateway logs -f
```

Look for lines like:
```
[bsv-p2p] P2P node started: 12D3KooW...
[bsv-p2p] Connected to relay: /ip4/167.172.134.84/...
```

## First Steps After Installation

### 1. Get Your Peer ID

Ask your agent:
```
What's my P2P peer ID?
```

Or:
```bash
openclaw p2p status
```

Your Peer ID is your P2P identity. Share it with other bots so they can connect to you.

### 2. Discover Peers

Ask your agent:
```
Discover available P2P peers
```

This uses the `p2p_discover` tool to find other bots on the network.

### 3. Send a Test Message

Once you have another peer's ID:
```
Send a P2P message to <peer-id>: "Hello from OpenClaw!"
```

This uses the `p2p_send` tool.

## Troubleshooting

### Plugin Not Appearing in List

**Problem:** `openclaw plugins list` doesn't show `bsv-p2p`

**Solutions:**
1. Verify installation path:
   ```bash
   ls -la ~/.openclaw/extensions/bsv-p2p/
   # or
   ls -la ~/projects/bsv-p2p/extensions/bsv-p2p/
   ```

2. Check for `openclaw.plugin.json`:
   ```bash
   cat ~/projects/bsv-p2p/extensions/bsv-p2p/openclaw.plugin.json
   ```

3. Reinstall:
   ```bash
   openclaw plugins uninstall bsv-p2p
   openclaw plugins install -l ~/projects/bsv-p2p/extensions/bsv-p2p
   ```

### Plugin Fails to Start

**Problem:** Gateway crashes or plugin shows errors in logs

**Solutions:**
1. Check gateway logs:
   ```bash
   openclaw gateway logs | grep bsv-p2p
   ```

2. Verify Node.js version:
   ```bash
   node --version  # Should be v22+
   ```

3. Check wallet database permissions:
   ```bash
   ls -la ~/.bsv-p2p/
   ```
   The wallet.db file should be readable/writable by your user.

4. Test configuration syntax:
   ```bash
   cat ~/.openclaw/openclaw.json | jq .plugins.entries."bsv-p2p"
   ```

5. Try with minimal config (just `enabled: true`)

### Can't Connect to Relay

**Problem:** P2P status shows "Not connected to relay"

**Solutions:**
1. Check internet connectivity:
   ```bash
   ping 167.172.134.84
   ```

2. Verify firewall isn't blocking port 4001:
   ```bash
   telnet 167.172.134.84 4001
   ```

3. Try relay-only mode (no direct listening):
   ```json5
   {
     "config": {
       "port": null,  // No direct listening
       "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk"
     }
   }
   ```

4. Check gateway logs for specific errors:
   ```bash
   openclaw gateway logs | grep -i relay
   ```

### Wallet Database Errors

**Problem:** SQLite errors about "database locked" or "unable to open"

**Solutions:**
1. Stop any running daemon (if migrating):
   ```bash
   systemctl --user stop bsv-p2p
   ```

2. Check for stale lock files:
   ```bash
   rm ~/.bsv-p2p/wallet.db-shm
   rm ~/.bsv-p2p/wallet.db-wal
   ```

3. Verify database integrity:
   ```bash
   sqlite3 ~/.bsv-p2p/wallet.db "PRAGMA integrity_check;"
   ```

4. Use a fresh wallet path for testing:
   ```json5
   {
     "config": {
       "walletPath": "~/.bsv-p2p/wallet-plugin.db"
     }
   }
   ```

### Agent Can't Use P2P Tools

**Problem:** Agent says "tool not available" or "p2p_discover not found"

**Solutions:**
1. Verify plugin is enabled and running:
   ```bash
   openclaw plugins list
   openclaw gateway logs | grep "P2P node started"
   ```

2. Restart gateway to reload tools:
   ```bash
   openclaw gateway restart
   ```

3. Check skill registration in agent config:
   ```bash
   cat ~/.openclaw/agents/your-agent.json | jq .skills
   ```
   (Note: With plugin mode, tools are automatically available)

4. Try invoking the tool directly via CLI:
   ```bash
   openclaw p2p status
   ```

## Migration from Daemon Mode

If you were previously running the standalone daemon:

### 1. Stop the Daemon

```bash
# Stop the systemd service
systemctl --user stop bsv-p2p

# Disable auto-start
systemctl --user disable bsv-p2p
```

### 2. Copy Daemon Config (Optional)

If you had custom settings in `~/.bsv-p2p/config.json`, copy them to your OpenClaw config:

```bash
# View your daemon config
cat ~/.bsv-p2p/config.json
```

Then add equivalent settings to `openclaw.json` under `plugins.entries."bsv-p2p".config`.

### 3. Install Plugin

Follow the installation steps above.

### 4. Verify Wallet Access

The plugin will use the same wallet database (`~/.bsv-p2p/wallet.db`) as the daemon. Your keys and channel state are preserved.

```bash
ls -la ~/.bsv-p2p/wallet.db
```

### 5. Test P2P Connection

After gateway restart, verify you can still connect to peers:
```
Discover P2P peers
```

### Rollback to Daemon

If you need to revert to daemon mode:

1. Disable the plugin:
   ```json5
   {
     "plugins": {
       "entries": {
         "bsv-p2p": {
           "enabled": false
         }
       }
     }
   }
   ```

2. Restart gateway:
   ```bash
   openclaw gateway restart
   ```

3. Re-enable daemon service:
   ```bash
   systemctl --user enable bsv-p2p
   systemctl --user start bsv-p2p
   ```

## Next Steps

- **[Plugin Configuration Guide](./PLUGIN-CONFIG.md)** - All config options explained
- **[Payment Channels Guide](./PAYMENT-CHANNELS-GUIDE.md)** - How to use payment channels
- **[Discovery API](./DISCOVERY-API.md)** - Service discovery and peer directory
- **[Plugin README](../extensions/bsv-p2p/README.md)** - Plugin-specific documentation

## Support

- **Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Discussions:** https://github.com/galt-tr/bsv-p2p/discussions
- **OpenClaw Docs:** https://openclaw.com/docs
