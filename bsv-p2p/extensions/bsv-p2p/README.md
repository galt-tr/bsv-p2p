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
  - code-review: Review code for bugs and security issues (500 sats)```

### Example 2: Request Paid Service

```
Human: Request a poem about Bitcoin from that peer

Agent: [calls p2p_request with service="poem-generation", input={"topic": "Bitcoin"}]
Opening payment channel with PeerA...
Channel opened with 10,000 sat capacity.

Requesting poem-generation service...
Received quote: 100 sats

Paying 100 sats via channel...
Payment sent.

Service result received:
{
  "poem": "In ledgers we trust,\nSatoshis flow peer to peer,\nFreedom through Bitcoin."
}

Channel remains open for future requests.
```

### Example 3: Check Channels

```
Human: Show me my payment channels

Agent: [calls p2p_channels]
You have 1 active payment channel:

Channel with 12D3KooWPeerA...:
- Status: open
- Capacity: 10,000 sats
- Your balance: 9,900 sats
- Their balance: 100 sats
- Payments made: 1
```

## FAQ

### How is this different from the daemon?

The **daemon** is a standalone process that runs separately from OpenClaw. The **plugin** runs inside the gateway process.

| Feature | Plugin | Daemon |
|---------|--------|--------|
| Process | Inside gateway | Separate (systemd) |
| API | Direct function calls | HTTP (localhost:4002) |
| Lifecycle | Gateway start/stop | Manual/systemd |
| Overhead | Low (in-process) | Higher (HTTP) |
| Best for | OpenClaw users | Standalone bots |

**Migration:** See [Installation Guide](../../docs/PLUGIN-INSTALL.md#migration-from-daemon-mode).

### Do I need to open ports?

**No** (usually). The plugin uses **relay connections** by default, which work behind NAT/firewalls. Direct connections (port 4001) are optional and only useful if:
- You're on a public IP
- You've configured port forwarding
- You're on the same LAN with mDNS enabled

### How secure are payment channels?

Payment channels use:
- **2-of-2 multisig** - Both parties must sign to spend funds
- **nSequence** - Transaction ordering prevents old states from being broadcast
- **BSV signatures** - secp256k1 cryptography

**Security notes:**
- ⚠️ This is experimental software (use testnet first)
- ⚠️ Wallet keys stored in plaintext (Task #100 will add keychain integration)
- ⚠️ Channel timeouts not yet enforced (cooperative close only)

### Can I run both plugin and daemon?

**Not simultaneously.** They both access `~/.bsv-p2p/wallet.db` and will conflict. Choose one:
- **Plugin**: For OpenClaw agents (recommended)
- **Daemon**: For standalone bots or non-OpenClaw use cases

### How do I backup my wallet?

```bash
# Backup wallet database
cp ~/.bsv-p2p/wallet.db ~/.bsv-p2p/wallet.db.backup

# Restore
cp ~/.bsv-p2p/wallet.db.backup ~/.bsv-p2p/wallet.db
```

**Important:** The wallet.db contains your BSV private keys. Keep backups secure!

### What BSV network does this use?

Currently **regtest/testnet only**. Mainnet support requires:
- SPV implementation (Task #102)
- Transaction broadcasting (Task #103)
- Channel timeouts and dispute resolution

## Troubleshooting

### "P2P node not running"

**Cause:** Plugin service failed to start.

**Fix:**
1. Check gateway logs: `openclaw gateway logs | grep bsv-p2p`
2. Verify plugin is enabled in config
3. Restart gateway: `openclaw gateway restart`

### "Can't connect to relay"

**Cause:** Network issues or relay server down.

**Fix:**
1. Ping relay: `ping 167.172.134.84`
2. Check firewall (allow outbound TCP 4001)
3. Try relay-only mode: `"config": {"port": null}`

### "Channel rejected"

**Cause:** Peer's `autoAcceptChannelsBelowSats` too low or manual approval required.

**Fix:**
- Ask peer to increase their threshold
- Or wait for manual approval

### "Database locked"

**Cause:** Daemon still running or stale lock file.

**Fix:**
```bash
# Stop daemon
systemctl --user stop bsv-p2p

# Remove lock files
rm ~/.bsv-p2p/wallet.db-shm
rm ~/.bsv-p2p/wallet.db-wal

# Restart gateway
openclaw gateway restart
```

## Development

### Plugin Structure

```
extensions/bsv-p2p/
├── openclaw.plugin.json       # Manifest
├── index.ts                   # Entry point
├── README.md                  # This file
├── services/
│   └── p2p-node.ts           # Background service
└── tools/
    ├── p2p_discover.ts
    ├── p2p_send.ts
    ├── p2p_request.ts
    ├── p2p_status.ts
    └── p2p_channels.ts
```

### Building from Source

```bash
cd ~/projects/bsv-p2p

# Install deps
npm install

# Build
npm run build

# Install plugin
openclaw plugins install -l ./extensions/bsv-p2p
```

### Testing

```bash
# Run unit tests
npm test

# Test plugin integration
openclaw gateway restart
openclaw gateway logs -f  # Watch for errors
```

## Documentation

- **[Installation Guide](../../docs/PLUGIN-INSTALL.md)** - Detailed setup instructions
- **[Configuration Reference](../../docs/PLUGIN-CONFIG.md)** - All config options
- **[Payment Channels Guide](../../docs/PAYMENT-CHANNELS-GUIDE.md)** - How payment channels work
- **[Discovery API](../../docs/DISCOVERY-API.md)** - Service discovery protocol
- **[Architecture](../../docs/ARCHITECTURE.md)** - System design and technical details

## Support

- **Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Discussions:** https://github.com/galt-tr/bsv-p2p/discussions
- **OpenClaw Docs:** https://openclaw.com/docs/plugins

## License

MIT
