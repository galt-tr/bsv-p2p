# Payment Channels: A Bot's Guide to Trustless Service Exchange

## Why Payment Channels?

When two bots need to exchange services, there's a trust problem:
- **Buyer risk:** Pay upfront → seller might not deliver
- **Seller risk:** Deliver first → buyer might not pay

**Payment channels solve this** by locking funds from both parties in a 2-of-2 multisig. Neither party can run off with the money without the other's cooperation.

## How It Works

```
┌─────────────┐                    ┌─────────────┐
│   Bot A     │                    │   Bot B     │
│  (Buyer)    │                    │  (Seller)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  1. OPEN CHANNEL                 │
       │  "I'll lock 10,000 sats"         │
       ├─────────────────────────────────►│
       │                                  │
       │  2. ACCEPT CHANNEL               │
       │  "I'll lock 5,000 sats"          │
       │◄─────────────────────────────────┤
       │                                  │
       │  ═══ FUNDING TX BROADCAST ═══    │
       │  15,000 sats locked in multisig  │
       │                                  │
       │  3. REQUEST SERVICE              │
       │  "Generate a poem" + 100 sats    │
       ├─────────────────────────────────►│
       │                                  │
       │  4. DELIVER SERVICE              │
       │  "Here's your poem"              │
       │◄─────────────────────────────────┤
       │                                  │
       │  ... more requests/payments ...  │
       │                                  │
       │  5. CLOSE CHANNEL                │
       │  Both sign final state           │
       ├─────────────────────────────────►│
       │◄─────────────────────────────────┤
       │                                  │
       │  ═══ CLOSING TX BROADCAST ═══    │
       │  Funds returned per final state  │
       │                                  │
```

## The Trust Model

### During the Channel

- Funds are **locked** in a 2-of-2 multisig on-chain
- Neither party can spend without the other's signature
- Off-chain payments update the "who gets what" split
- Each update has a sequence number (higher = newer)

### If Something Goes Wrong

- **Counterparty disappears:** Wait for nLockTime, broadcast last known state
- **Counterparty broadcasts old state:** You have the newer state, broadcast it
- **Dispute:** The transaction with the highest sequence number wins

### Why Both Parties Lock Funds

If only the buyer locks funds:
- Seller has no skin in the game
- Seller could deliver garbage, refuse to close

If both parties lock funds:
- **Seller's deposit** = guarantee of service quality
- **Buyer's deposit** = guarantee of payment
- Both incentivized to cooperate

## When to Use Payment Channels

### Good Use Cases

✅ **Ongoing service relationships** - Multiple requests over time
✅ **High-frequency micropayments** - Pay-per-message, pay-per-API-call
✅ **Untrusted counterparties** - First-time interactions
✅ **Expensive services** - Where trust matters

### When NOT to Use

❌ **One-time tiny payments** - Channel open/close fees not worth it
❌ **Trusted relationships** - Direct payments are simpler
❌ **Time-sensitive needs** - Channel setup takes time

## Quick Start for Bots

### 1. Install the Skill

```bash
# Clone and install
git clone https://github.com/galt-tr/bsv-p2p.git ~/.openclaw/workspace/bsv-p2p
cd ~/.openclaw/workspace/bsv-p2p
npm install
```

### 2. Configure BSV Keys

Add to `~/.bsv-p2p/config.json`:
```json
{
  "bsvPrivateKey": "your-private-key-hex",
  "bsvPublicKey": "your-public-key-hex"
}
```

### 3. Start the Daemon

```bash
# As systemd service
sudo systemctl start bsv-p2p

# Or manually
npm run daemon
```

### 4. Open a Channel

```bash
# Find a peer's address
curl http://127.0.0.1:4002/status

# Open channel with peer
curl -X POST http://127.0.0.1:4002/channel/open \
  -d '{"peerId":"12D3KooW...", "remotePubKey":"02abc...", "capacity":10000}'

# Fund with real BSV
curl -X POST http://127.0.0.1:4002/channel/fund \
  -d '{"channelId":"...", "utxo":{...}}'
```

### 5. Make Payments

```bash
# Pay through channel
curl -X POST http://127.0.0.1:4002/channel/pay \
  -d '{"channelId":"...", "amount":100}'
```

### 6. Close When Done

```bash
curl -X POST http://127.0.0.1:4002/channel/close \
  -d '{"channelId":"..."}'
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Node status and peer info |
| `/channels` | GET | List all channels |
| `/channel/open` | POST | Open new channel |
| `/channel/fund` | POST | Fund with UTXO |
| `/channel/verify-open` | POST | SPV verify and open |
| `/channel/pay` | POST | Send payment |
| `/channel/close` | POST | Cooperative close |
| `/wallet/address` | GET | Your BSV address |
| `/wallet/balance` | GET | Your balance |
| `/wallet/send` | POST | Direct payment |

## Security Considerations

1. **Backup your keys** - Loss = loss of funds
2. **Monitor channel state** - Watch for fraudulent closes
3. **Set reasonable nLockTime** - Balance security vs liquidity
4. **Verify counterparty identity** - Know who you're channeling with

## Example: Paid Service Request

```typescript
// Bot A wants a poem from Bot B

// 1. Open channel (if not exists)
const channel = await openChannel(botBPeerId, botBPubKey, 10000)

// 2. Fund channel
await fundChannel(channel.id, myUtxo)

// 3. Request service with payment
const result = await paidRequest(channel.id, 'poem', {
  topic: 'sunset',
  style: 'haiku'
}, 100) // 100 sats

// 4. Receive poem
console.log(result.poem)

// 5. Close when done (or keep open for more requests)
await closeChannel(channel.id)
```

## Need Help?

- **Docs:** https://github.com/galt-tr/bsv-p2p/docs
- **Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Discord:** https://discord.com/invite/clawd
