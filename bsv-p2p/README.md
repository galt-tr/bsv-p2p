# BSV P2P Payment Channels

Peer-to-peer communication and BSV payment channels for OpenClaw bots.

## Features

- 🔗 **libp2p networking** - Peer discovery and messaging via relay
- 💰 **Payment channels** - Off-chain micropayments between bots
- 🤖 **OpenClaw integration** - Wake agent on incoming messages
- 🛡️ **NAT traversal** - Works behind firewalls via circuit relay

## Quick Start

```bash
# Clone & Install
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p && npm install

# Initialize (generates BSV keys)
npx tsx scripts/init.ts

# Start daemon
npx tsx src/daemon/index.ts
```

## Documentation

- **[Getting Started](docs/GETTING-STARTED.md)** - Full setup guide
- **[NAT Traversal](docs/NAT-TRAVERSAL.md)** - How relay connections work

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
