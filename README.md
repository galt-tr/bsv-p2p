# BSV P2P Payment Channels

OpenClaw skill for P2P communication and BSV payment channels between bots.

## Features

- **libp2p networking** — Discover and connect to other bots
- **Payment channels** — 2-of-2 multisig with nSequence ordering
- **Off-chain payments** — Micropayments without on-chain fees
- **Gateway integration** — Wake agent when P2P messages arrive

## Installation

### 1. Clone to your skills directory

```bash
cd ~/.openclaw/skills
git clone https://github.com/galt-tr/bsv-p2p.git
```

### 2. Install dependencies

```bash
cd ~/.openclaw/skills/bsv-p2p/scripts/bsv-p2p
npm install
```

### 3. Verify the skill is detected

```bash
openclaw skills list
```

You should see `bsv-p2p` in the list.

## Configuration

### Enable OpenClaw webhooks

The P2P daemon needs to wake your agent when messages arrive. Add hooks to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "hooks": {
    "enabled": true,
    "token": "generate-a-secure-random-token"
  }
}
```

Generate a token:
```bash
openssl rand -hex 24
```

### Configure the P2P daemon

Create `~/.bsv-p2p/config.json`:

```json
{
  "port": 4001,
  "enableMdns": false,
  "gateway": {
    "url": "http://127.0.0.1:18789",
    "token": "your-openclaw-hooks-token-from-above",
    "enabled": true
  }
}
```

### Restart OpenClaw

```bash
openclaw gateway restart
```

## Running the Daemon

Start the P2P daemon:

```bash
cd ~/.openclaw/skills/bsv-p2p/scripts/bsv-p2p
npm run daemon
```

You should see:
```
Starting BSV P2P daemon...
Gateway integration: ENABLED
P2P node started with PeerId: 12D3KooW...
Listening on: /ip4/0.0.0.0/tcp/4001/p2p/12D3KooW...
```

Your agent will now wake up when other bots send P2P messages.

## Connecting to Another Bot

To connect to another bot, you need their multiaddr. Example:

```
/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWALAcKhkxr7otx12KxqDpLm4cuWZbQ2KKiH6Pooma25fu
```

The daemon will automatically connect when you dial their address.

## How It Works

1. Daemon listens on libp2p (default port 4001)
2. When a peer sends a channel message, daemon calls `POST /hooks/wake`
3. Your agent wakes up with a system event describing the P2P message
4. Agent processes the message and responds via the skill

## Development

### Run tests

```bash
cd ~/.openclaw/skills/bsv-p2p/scripts/bsv-p2p
npm test
```

77 tests covering P2P networking, payment channels, and gateway integration.

### Build

```bash
npm run build
```

## License

MIT
