# BSV Payment Channels Research

*Date: 2026-02-17*

## Overview

Payment channels enable off-chain micropayments between two parties with only channel open/close transactions on-chain.

## Key Concepts

### How Payment Channels Work

1. **Open Channel**: Create a funding transaction with nLockTime in the future and nSequence < 0xFFFFFFFF
2. **Update Channel**: Exchange updated transaction versions between parties (increment nSequence)
3. **Close Channel**: Either party can:
   - Wait for nLockTime and broadcast latest version
   - Both parties sign with nSequence = 0xFFFFFFFF (final)
   - One party stops responding → other waits for timeout

### Technical Details

- **nSequence**: Counter that increments with each update. Lower values can replace higher values until nLockTime.
- **nLockTime**: Future time/block when transaction becomes valid. Provides dispute resolution window.
- **Double-spend protection**: Transactions go into miner double-spend monitoring pools.

### Example: Streaming Content

```
1. User sends funding tx with nLockTime = +24 hours
2. Provider sends first content frame, user signs payment for frame 1
3. Provider sends frame 2, user signs cumulative payment for frames 1+2
...
N. User wants to close, sends final message hash
N+1. Provider broadcasts final tx, claims payment
```

Each iteration only exchanges signatures, not on-chain transactions.

## Relevant BRCs

### BRC-29: Simple Authenticated P2PKH Payment Protocol
- Key derivation using derivationPrefix + derivationSuffix
- BRC-42 key derivation for privacy
- BEEF transactions for SPV proof

### BRC-105: HTTP Service Monetization Framework
- HTTP 402 Payment Required responses
- Headers: `x-bsv-payment-satoshis-required`, `x-bsv-payment-derivation-prefix`
- Client responds with `x-bsv-payment` header containing transaction
- Implemented by `@bsv/payment-express-middleware`

### BRC-70 (actually 69): Paymail Receive BEEF
- BEEF transactions via Paymail endpoints

## Implementation Options for P2P Bot Payments

### Option 1: Simple Per-Request Payments (BRC-29/105 style)
**Pros:**
- Simple to implement
- Each payment is final
- No channel state to manage

**Cons:**
- On-chain transaction for every payment
- Higher fees for frequent small payments
- Slower (wait for tx propagation)

### Option 2: Payment Channels
**Pros:**
- Off-chain updates (instant)
- Single open/close tx for many payments
- Ideal for streaming/high-frequency
- Lower total fees

**Cons:**
- More complex state management
- Requires channel lifecycle management
- Funds locked during channel lifetime
- Need timeout/dispute handling

### Option 3: Hybrid Approach (Recommended)
- **Small payments**: Direct per-request (BRC-105 style)
- **High-frequency peers**: Open payment channel
- **Streaming data**: Always use channels
- **Threshold**: Open channel after N payments to same peer

## Payment Channel Protocol for P2P

### Channel Open
```typescript
interface ChannelOpen {
  type: 'channel_open'
  fundingTxid: string
  fundingVout: number
  capacity: number          // Total sats in channel
  nLockTime: number         // Unix timestamp or block height
  partyA: {
    identityKey: string
    pubKey: string          // Channel-specific key
    initialBalance: number
  }
  partyB: {
    identityKey: string  
    pubKey: string
    initialBalance: number
  }
  signature: string         // Signed by channel opener
}
```

### Channel Update
```typescript
interface ChannelUpdate {
  type: 'channel_update'
  channelId: string
  nSequence: number         // Increment each update
  balanceA: number
  balanceB: number
  timestamp: number
  signatureA?: string       // Updated each iteration
  signatureB?: string
}
```

### Channel Close
```typescript
interface ChannelClose {
  type: 'channel_close'
  channelId: string
  finalTx: string           // BEEF of closing transaction
  cooperative: boolean      // Both parties agreed
}
```

## State Machine

```
     [PROPOSED] ──► [OPENING] ──► [OPEN] ──► [CLOSING] ──► [CLOSED]
         │              │           │            │
         ▼              ▼           ▼            ▼
     [REJECTED]    [FAILED]   [DISPUTED]    [TIMEOUT]
```

## Security Considerations

1. **Watch for cheating**: Monitor for old channel state broadcasts
2. **Timeout protection**: Always have nLockTime fallback
3. **State persistence**: Must persist channel state for recovery
4. **Double-spend monitoring**: Use miner pools for protection

## References

- BSV Wiki: https://wiki.bitcoinsv.io/index.php/Payment_Channels
- BRC-29: https://github.com/bitcoin-sv/BRCs/blob/master/payments/0029.md
- BRC-105: https://github.com/bitcoin-sv/BRCs/blob/master/payments/0105.md
- @bsv/payment-express-middleware: https://github.com/bsv-blockchain/payment-express-middleware
