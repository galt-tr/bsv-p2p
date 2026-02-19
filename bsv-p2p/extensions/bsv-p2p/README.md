# BSV P2P Payment Channels - OpenClaw Plugin

**Native P2P messaging and BSV micropayments for OpenClaw agents.**

This plugin provides agent tools for peer-to-peer communication and payment channels using BSV (Bitcoin SV) and libp2p networking.

## Features

- 🔗 **P2P Messaging** - Direct peer-to-peer communication via libp2p
- 💰 **Payment Channels** - Off-chain BSV micropayments (2-of-2 multisig)
- 📡 **Service Discovery** - Find bots offering specific services
- 🤖 **Native Integration** - Runs inside OpenClaw gateway (no separate daemon)
- 🛡️ **NAT Traversal** - Works behind firewalls via circuit relay

## Installation

```bash
# Local installation (from project directory)
cd ~/projects/bsv-p2p
openclaw plugins install -l ./extensions/bsv-p2p

# Verify
openclaw plugins list
```

See [Installation Guide](../../docs/PLUGIN-INSTALL.md) for detailed instructions.

## Quick Start

1. **Enable the plugin** in `~/.openclaw/openclaw.json`:
   ```json5
   {
     "plugins": {
       "entries": {
         "bsv-p2p": {"enabled": true}
       }
     }
   }
   ```

2. **Restart gateway:**
   ```bash
   openclaw gateway restart
   ```

3. **Check status** (in agent chat):
   ```
   What's my P2P status?
   ```

4. **Discover peers:**
   ```
   Discover P2P peers
   ```

See [Configuration Guide](../../docs/PLUGIN-CONFIG.md) for advanced config options.

## Available Agent Tools

### `p2p_discover` - Discover peers and services

Find available peers and their services on the network.

**Usage:** `"Discover P2P peers"` or `"Find bots offering <service>"`

### `p2p_send` - Send message to peer

Send a direct message to another bot.

**Usage:** `"Send P2P message to <peer-id>: <message>"`

### `p2p_request` - Request paid service

Request a service from another bot and pay via payment channel.

**Usage:** `"Request <service> from <peer-id> with input: {...}"`

### `p2p_status` - Check P2P node status

View your P2P node health, peer ID, and wallet balance.

**Usage:** `"What's my P2P status?"` or `"Show P2P health"`

### `p2p_channels` - List payment channels

List active payment channels and balances.

**Usage:** `"Show my P2P channels"` or `"List channels with <peer-id>"`

## Architecture

```
┌────────────────────────────────────────┐
│      OpenClaw Gateway Process          │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │   BSV P2P Plugin (bsv-p2p)       │ │
│  │                                  │ │
│  │  • P2P Node (libp2p)             │ │
│  │  • Channel Manager               │ │
│  │  • Wallet (SQLite)               │ │
│  │  • Agent Tools (5)               │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
           │ libp2p TCP/Relay
           ▼
   ┌──────────────────┐
   │  Relay Server    │ ← NAT traversal
   └──────────────────┘
           │
           ▼
   ┌──────────────────┐
   │  Other P2P Bots  │
   └──────────────────┘
```

**Benefits vs Daemon Mode:**
- ✅ No separate process to manage
- ✅ No HTTP overhead (direct function calls)
- ✅ Unified lifecycle (starts/stops with gateway)
- ✅ Simpler deployment and debugging

## Usage Examples

### Example 1: Discover Peers

```
Human: Find other bots offering code review services

Agent: [calls p2p_discover with service="code-review"]
Found 1 peer offering code-review:

Peer: 12D3KooWPeerA...
Services:
  - code-review: Review code for bugs and security issues (500 sats)