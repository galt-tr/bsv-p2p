# BSV P2P Payment Channels

**Trustless service exchange between AI agents.**

When two bots need to exchange services, who goes first? Pay upfront and risk non-delivery? Deliver first and risk non-payment?

**Payment channels solve this** by locking funds from BOTH parties in a 2-of-2 multisig. Neither can take the money without cooperation. Services and payments exchange off-chain (instant, free), then settle on-chain when done.

## Installation Modes

1. **OpenClaw Plugin** (recommended) - Runs inside OpenClaw gateway, no separate daemon needed
2. **Standalone Daemon** - Separate process for non-OpenClaw bots

This README covers both modes. OpenClaw users should follow the plugin installation guide.

## Features

- 🔗 **libp2p networking** - Peer discovery and messaging via relay
- 💰 **Payment channels** - 2-of-2 multisig with off-chain updates
- 📡 **Service discovery** - Find bots offering specific services via GossipSub
- 🤖 **OpenClaw plugin** - Native agent tools (no HTTP, runs in-process)
- 🛡️ **NAT traversal** - Works behind firewalls via circuit relay
- ✅ **Battle-tested** - First real AI-to-AI payment channel closed on BSV mainnet!

## Use Cases

- **Paid API calls** - Bot charges per request
- **Service marketplaces** - Discover and pay for bot services
- **Streaming payments** - Pay-per-message conversations
- **Escrow** - Both parties locked until service complete

## Quick Start

### For OpenClaw Users (Recommended)

Install as a native OpenClaw plugin:

```bash
# Clone the repository
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p

# Install dependencies
npm install

# Install as OpenClaw plugin
openclaw plugins install -l ./extensions/bsv-p2p

# Enable in your OpenClaw config (~/.openclaw/openclaw.json)
# Add: {"plugins": {"entries": {"bsv-p2p": {"enabled": true}}}}

# Restart gateway
openclaw gateway restart

# Verify (in agent chat)
# "What's my P2P status?"
```

See **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** for detailed instructions.

### For Standalone Bots (Legacy)

Run as a separate daemon process:

```bash
# Clone
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p

# One-command setup (installs deps, builds, generates keys)
npm run setup

# Initialize (generates BSV keys)
npx tsx scripts/init.ts

# Start daemon
npx tsx src/daemon/index.ts
```

See **[Daemon Guide](docs/DAEMON.md)** for daemon mode setup.

## Service Discovery

Bots can announce services they offer and discover peers offering specific services:

```bash
# Register a service your bot offers
npm run services register --id=code-review --name="Code Review" --price=1000

# Find bots offering code review
npm run services discover --service=code-review

# List your registered services
npm run services list

# Get discovery stats
npm run services stats
```

Services are announced via GossipSub every 5 minutes. Other bots discover them automatically.

## Documentation

### Plugin Mode (OpenClaw)

- **[Plugin Installation Guide](docs/PLUGIN-INSTALL.md)** - Install and configure the plugin
- **[Plugin Configuration Reference](docs/PLUGIN-CONFIG.md)** - All config options
- **[Plugin README](extensions/bsv-p2p/README.md)** - Plugin-specific documentation

### Daemon Mode (Standalone Bots)

- **[Daemon Guide](docs/DAEMON.md)** - Setup and management
- **[Getting Started](docs/GETTING-STARTED.md)** - Full daemon setup guide

### General

- **[Payment Channels Guide](docs/PAYMENT-CHANNELS-GUIDE.md)** - How payment channels work
- **[Discovery API](docs/DISCOVERY-API.md)** - Service discovery and peer directory
- **[NAT Traversal](docs/NAT-TRAVERSAL.md)** - How relay connections work
- **[Architecture](docs/ARCHITECTURE.md)** - System design and technical details

## Test Connection

```bash
# Test connection to another peer
npx tsx scripts/test-connection.ts <peer-id>

# Send a message
npx tsx send-message.ts <peer-id> "Hello!"
```

## Architecture

```
┌─────────────┐         ┌─────────────┐
│   Bot A     │         │   Bot B     │
│  (Alice)    │         │   (Bob)     │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │    ┌───────────┐      │
       └────┤  Relay    ├──────┘
            │  Server   │
            └───────────┘
```

Both bots connect to the relay server, which forwards messages between them.

## Payment Channel Flow

1. **Open** - Alice opens channel, funding 10k sats
2. **Pay** - Alice sends payments to Bob (off-chain state updates)
3. **Service** - Alice pays for Bob's services (e.g., poem generation)
4. **Close** - Either party closes, settling final balances on-chain

## Test Status

```
71 tests passing
- Unit tests: ChannelManager, transactions, protocol
- E2E tests: Full channel lifecycle
```

## Relay Server

Public relay at `167.172.134.84:4001`

PeerId: `12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk`

## License

MIT

## Links

- [GitHub](https://github.com/galt-tr/bsv-p2p)
- [OpenClaw](https://github.com/openclaw/openclaw)
