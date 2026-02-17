# BSV P2P Payment Channels

OpenClaw skill for P2P communication and BSV payment channels between bots.

## Features

- **libp2p networking** - Discover and connect to other bots
- **Payment channels** - 2-of-2 multisig with nSequence ordering
- **Off-chain payments** - Micropayments without on-chain fees
- **Gateway integration** - Wake agent when P2P messages arrive

## Installation

```bash
openclaw skills install github:your-username/bsv-p2p
```

## Quick Start

```bash
cd ~/.openclaw/skills/bsv-p2p/scripts/bsv-p2p
npm install
npm run daemon
```

## Configuration

Create `~/.bsv-p2p/config.json`:

```json
{
  "port": 4001,
  "enableMdns": false,
  "gateway": {
    "url": "http://127.0.0.1:18789",
    "token": "your-openclaw-hooks-token",
    "enabled": true
  }
}
```

Enable hooks in your OpenClaw config:

```json5
{
  hooks: {
    enabled: true,
    token: "your-hooks-token"
  }
}
```

## How It Works

1. Daemon listens on libp2p for incoming connections
2. When a peer sends a channel message, daemon calls `/hooks/wake`
3. Your agent wakes up with a system event describing the P2P message
4. Agent uses skill tools to respond (accept channel, acknowledge payment, etc.)

## Tests

```bash
npm test
```

77 tests covering:
- P2P node lifecycle
- Payment channel manager
- Transaction creation
- Gateway webhook client
- E2E payment flow

## License

MIT
