# Manual E2E Test: Plugin-Based Paid Poem Service

This document describes how to perform a full end-to-end test of the BSV P2P payment channels using native OpenClaw plugin tools, replicating the golden test (task #19) but with plugin tools instead of HTTP API.

## Prerequisites

1. Two OpenClaw gateway instances (can be on same machine with different ports)
2. bsv-p2p plugin installed on both
3. Test BSV wallet with some funds (10k+ sats recommended)
4. Access to a relay server (default: 167.172.134.84:4001)

## Setup

### Gateway A (Alice - Service Consumer)

```bash
# Use default port 3000
export OPENCLAW_PORT=3000
export OPENCLAW_CONFIG=~/.openclaw-alice/openclaw.json

# Configure plugin
cat > ~/.openclaw-alice/openclaw.json <<'EOF'
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4101,
          "walletPath": "~/.openclaw-alice/bsv-wallet.db",
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk"
        }
      }
    }
  }
}
EOF

# Start gateway
openclaw gateway start
```

### Gateway B (Bob - Service Provider)

```bash
# Use port 3001
export OPENCLAW_PORT=3001
export OPENCLAW_CONFIG=~/.openclaw-bob/openclaw.json

# Configure plugin
cat > ~/.openclaw-bob/openclaw.json <<'EOF'
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4102,
          "walletPath": "~/.openclaw-bob/bsv-wallet.db",
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk",
          "autoAcceptChannelsBelowSats": 100000
        }
      }
    }
  }
}
EOF

# Start gateway
openclaw gateway start
```

## Test Procedure

### Step 1: Verify P2P Status

**Alice:**
```
Human: What's my P2P status?

Agent: [calls p2p_status]
Expected: Shows peer ID, relay connection, healthy status
```

**Bob:**
```
Human: What's my P2P status?

Agent: [calls p2p_status]
Expected: Shows peer ID, relay connection, healthy status
```

**Verification:**
- Both nodes show as healthy
- Both are connected to relay
- Note down both peer IDs for next steps

### Step 2: Discovery

**Alice:**
```
Human: Discover P2P peers

Agent: [calls p2p_discover]
Expected: Shows Bob's peer ID and any services he's offering
```

**Verification:**
- Bob appears in discovery results
- If Bob is advertising services, they're listed

### Step 3: Open Payment Channel

**Alice:**
```
Human: Open a 10000 satoshi payment channel with [Bob's peer ID] using pubkey [Bob's BSV pubkey]

Agent: [calls p2p_channels with action=open, peerId=..., satoshis=10000, pubkey=...]
Expected: Channel opens successfully, funding tx broadcasts
```

**Verification:**
- Alice sees "Channel opened" message
- Check blockchain: 1 new transaction (funding tx)
- Alice's wallet balance decreases by ~10000 sats (plus fees)

### Step 4: Verify Channel Listing

**Alice:**
```
Human: Show my P2P channels

Agent: [calls p2p_channels with action=list]
Expected: Shows 1 open channel with Bob
- Capacity: 10000 sats
- Alice balance: 10000 sats
- Bob balance: 0 sats
- State: open
```

### Step 5: Request Paid Services (6 Poems)

**Alice (repeat 6 times with different topics):**
```
Human: Request a poem about Bitcoin from [Bob's peer ID]

Agent: [calls p2p_request with service="poem-generation", input={"topic": "Bitcoin"}, maxPayment=100]
Expected: Poem delivered, 100 sats paid off-chain
```

**Topics for 6 requests:**
1. Bitcoin
2. Payment channels
3. P2P networks
4. Satoshi Nakamoto
5. Decentralization
6. Digital gold

**Verification after each request:**
- Alice receives poem response
- NO new blockchain transactions
- Internal channel state updates (verify in Step 6)

### Step 6: Verify Channel Balances After Payments

**Alice:**
```
Human: Show my P2P channels

Agent: [calls p2p_channels with action=list]
Expected: Channel still open, updated balances:
- Alice balance: 9400 sats (10000 - 600)
- Bob balance: 600 sats (6 × 100)
- Payments made: 6
```

**Verification:**
- Channel remains open
- Balances match expectations
- Still only 1 on-chain transaction (the funding tx)

### Step 7: Close Payment Channel

**Alice:**
```
Human: Close channel [channel ID from listing]

Agent: [calls p2p_channels with action=close, channelId=...]
Expected: Channel closes, settlement tx broadcasts
```

**Verification:**
- Alice sees "Channel closed" message
- Check blockchain: 1 NEW transaction (settlement tx)
- **Total on-chain txs: 2** (funding + settlement)

### Step 8: Final Balance Verification

**Alice:**
```
Human: What's my BSV balance?

Expected: Balance reflects:
- Initial balance
- Minus 10000 (funding)
- Plus 9400 (settlement)
- Minus fees (~200-500 sats total)
```

**Bob:**
```
Human: What's my BSV balance?

Expected: Balance reflects:
- Initial balance
- Plus 600 sats (earned from poems)
```

## Success Criteria

✅ **On-chain transactions: EXACTLY 2**
- 1 funding transaction (channel open)
- 1 settlement transaction (channel close)

✅ **Off-chain payments: 6**
- All happened without blockchain transactions
- Verified by checking blockchain explorer

✅ **Final balances:**
- Alice: Started with X, ended with X - 600 - fees
- Bob: Started with Y, ended with Y + 600

✅ **All interactions via plugin tools:**
- p2p_discover
- p2p_channels (list/open/close)
- p2p_request
- p2p_status

## Troubleshooting

### "Cannot find peer"
- Verify both nodes connected to same relay
- Check firewall isn't blocking relay connection
- Wait 30s for peer discovery to propagate

### "Channel open failed"
- Verify Alice has sufficient BSV balance
- Check Bob's autoAcceptChannelsBelowSats threshold
- Verify Bob's pubkey is correct

### "Service request timeout"
- Bob might not be running service handler
- Check Bob's gateway logs for errors
- Verify channel is actually open (p2p_channels list)

### "More than 2 on-chain txs"
- Bug: payments went on-chain instead of off-chain
- Check payment amounts (should be below channel capacity)
- Verify channel was open when payments were made

## Automation (Future)

This manual test could be automated with:
1. OpenClaw session API (send commands to agents)
2. Blockchain explorer API (verify tx count)
3. Wallet balance queries (verify final amounts)
4. Test orchestration script

See `test/plugin/e2e-plugin.test.ts` for partial automation approach.

## Notes

- Use testnet/regtest for initial testing
- This test requires real P2P networking (can't be fully mocked)
- Budget 15-30 minutes for full test run
- Keep gateway logs open for debugging

## Related Documentation

- `extensions/bsv-p2p/README.md` - Plugin usage guide
- `docs/PAYMENT-CHANNELS-GUIDE.md` - Technical details
- `test/e2e/golden-poem.test.ts` - HTTP API version of this test
