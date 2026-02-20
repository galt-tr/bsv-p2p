# BSV P2P Bot Developer Guide

This guide shows bot developers how to build services that accept BSV micropayments and consume paid services from other bots.

## Table of Contents

1. [Overview](#overview)
2. [Service Provider: Offering Paid Services](#service-provider-offering-paid-services)
3. [Service Consumer: Using Paid Services](#service-consumer-using-paid-services)
4. [Payment Channel Lifecycle](#payment-channel-lifecycle)
5. [Error Handling](#error-handling)
6. [Best Practices](#best-practices)

---

## Overview

BSV P2P payment channels enable **trustless service exchange** between bots:

- **No prepayment risk**: Funds locked in 2-of-2 multisig (neither party can steal)
- **Instant payments**: Off-chain state updates (no blockchain delay)
- **Micropayment-friendly**: Pay per request, as low as 1 satoshi
- **Efficient**: Open once, make hundreds of payments, close once

**Use cases:**
- AI-to-AI API calls (pay per request)
- Content generation services
- Data processing pipelines
- Bot-to-bot marketplaces

---

## Service Provider: Offering Paid Services

### Step 1: Announce Your Service

Use the `p2p_discover` tool to make your service discoverable:

```typescript
// In your bot's service handler
const serviceAnnouncement = {
  id: 'poem-generation',
  name: 'Poem Generation',
  description: 'Generate custom poems on any topic',
  pricing: {
    model: 'per-request',
    baseSatoshis: 100,  // 100 sats per poem
    details: 'Fixed price per poem, any topic'
  },
  metadata: {
    maxLength: 500,
    supportedStyles: ['haiku', 'sonnet', 'free-verse']
  }
};

// Announce via GossipSub (automatic with plugin)
await p2pNode.announceService(serviceAnnouncement);
```

**Agent setup (OpenClaw):**

Your agent should handle incoming service requests:

```typescript
// In your agent's system prompt or handler
When you receive a P2P service request for "poem-generation":
1. Check the input (topic, style)
2. Generate the poem
3. Return {poem: "...", metadata: {...}}
```

### Step 2: Handle Incoming Requests

**Automatic handling (plugin mode):**

The plugin automatically routes service requests to your agent. You just need to respond with the result.

**Example agent conversation:**

```
[Incoming P2P message from 12D3KooWCustomer...]
Request: poem-generation
Input: {"topic": "Bitcoin", "style": "haiku"}
Payment: 100 sats (pending)

Agent: [generates poem]
Sending response:
{
  "poem": "Satoshis flow free\nPeer to peer, no middleman\nBitcoin lights the way",
  "metadata": {"words": 12, "lines": 3}
}

Payment received: 100 sats
```

### Step 3: Accept Payment Channels

Configure auto-accept for low-value channels:

```json5
{
  "config": {
    "autoAcceptChannelsBelowSats": 10000  // Auto-accept up to 10k sats
  }
}
```

Or handle manually:

```typescript
// Listen for channel requests
p2pNode.on('channel:request', async (request) => {
  const { peerId, capacity, purpose } = request;
  
  // Decide whether to accept
  if (capacity <= 10000 && isTrustedPeer(peerId)) {
    await channelManager.acceptChannel(request.id);
  } else {
    // Request manual approval
    await notifyOperator('Channel request needs approval', request);
  }
});
```

### Step 4: Price Your Services

**Pricing strategies:**

1. **Fixed per-request**: Simple, predictable (e.g., 100 sats per poem)
2. **Usage-based**: Charge by compute (e.g., 10 sats per 100 tokens)
3. **Tiered**: Different prices for different quality levels
4. **Dynamic**: Adjust based on demand

**Example pricing:**

```typescript
const pricing = {
  'poem-generation': {
    haiku: 50,
    sonnet: 150,
    freeVerse: 100
  },
  'code-review': {
    small: 500,   // < 100 lines
    medium: 1000, // 100-500 lines
    large: 2500   // 500+ lines
  }
};

function calculatePrice(service, input) {
  if (service === 'poem-generation') {
    return pricing[service][input.style] || 100;
  }
  if (service === 'code-review') {
    const lines = input.code.split('\n').length;
    if (lines < 100) return pricing[service].small;
    if (lines < 500) return pricing[service].medium;
    return pricing[service].large;
  }
}
```

---

## Service Consumer: Using Paid Services

### Step 1: Discover Services

Ask your agent to discover available services:

```
Human: What paid services are available on the P2P network?

Agent: [calls p2p_discover]
Found 3 service providers:

1. PeerA (12D3KooW...):
   - poem-generation: Generate custom poems (100 sats)
   - translation: Translate text (50 sats/100 words)

2. PeerB (12D3KooW...):
   - code-review: Review code for bugs (500-2500 sats)
   
3. PeerC (12D3KooW...):
   - data-analysis: Analyze CSV data (1000 sats)
```

### Step 2: Request a Service

Use the `p2p_request` tool:

```
Human: Request a haiku about Bitcoin from PeerA

Agent: [calls p2p_request]
{
  "peerId": "12D3KooWPeerA...",
  "service": "poem-generation",
  "input": {"topic": "Bitcoin", "style": "haiku"},
  "maxPayment": 150  // Willing to pay up to 150 sats
}
```

**What happens behind the scenes:**

1. **Channel check**: Plugin checks if a channel exists with PeerA
2. **Open channel** (if needed): Opens channel with your configured capacity
3. **Send request**: Sends service request to PeerA
4. **Receive quote**: PeerA responds with price (100 sats)
5. **Verify price**: Checks if 100 ≤ 150 (maxPayment)
6. **Pay**: Updates channel state (-100 sats local, +100 sats remote)
7. **Receive result**: PeerA sends the poem
8. **Return**: Agent shows you the result

```
Agent: Service completed! Paid 100 sats.

Result:
"Satoshis flow free
Peer to peer, no middleman
Bitcoin lights the way"

Channel remains open for future requests.
```

### Step 3: Handle Errors

**What if the service fails?**

```
Agent: [calls p2p_request]
Error: Service request failed - timeout waiting for response

No payment was made (channel state unchanged).
```

**Payment channels ensure:**
- ✅ No payment without result (state only updates after both parties sign)
- ✅ No double-spending (nSequence prevents replaying old states)
- ✅ Fair exchange (both parties must cooperate)

---

## Payment Channel Lifecycle

### Opening a Channel

**Option 1: Automatic (recommended)**

```
Human: Request service X from peer Y

Agent: [No existing channel with Y]
Opening payment channel with 10,000 sat capacity...
Channel opened: #abc123
[proceeds with request]
```

**Option 2: Manual**

```
Human: Open a payment channel with peer Y, 20k sats

Agent: [calls p2p_channels with action="open"]
Channel opened successfully:
- Peer: 12D3KooWPeerY...
- Capacity: 20,000 sats
- Your balance: 20,000 sats
- Their balance: 0 sats
```

### Making Payments

Payments are **instant** (off-chain state updates):

```
Request 1: -100 sats → Balance: 19,900 / 100
Request 2: -250 sats → Balance: 19,650 / 350
Request 3: -50 sats  → Balance: 19,600 / 400
```

Each payment:
1. Creates new channel state
2. Both parties sign
3. Updates balance
4. Invalidates previous state

### Closing a Channel

**Option 1: Cooperative close (recommended)**

```
Human: Close my channel with peer Y

Agent: [calls p2p_channels with action="close"]
Closing channel #abc123...
Broadcasting final state to blockchain...
Done! Final balances:
- You received: 19,600 sats
- They received: 400 sats
```

**Option 2: Automatic close (planned)**

Channels will auto-close after inactivity (Task #103).

---

## Error Handling

### Common Errors and Solutions

#### 1. Channel Capacity Exceeded

```
Error: Insufficient channel capacity (requested 5000 sats, available 500 sats)
```

**Solution:**
- Close and reopen with higher capacity
- Or open a second channel

#### 2. Peer Offline

```
Error: Peer not reachable (timeout after 30s)
```

**Solution:**
- Retry later
- Check peer's relay connection
- Try a different peer for the service

#### 3. Service Request Rejected

```
Error: Service request rejected by peer
```

**Possible reasons:**
- Peer no longer offers that service
- Input validation failed
- Peer's queue is full

**Solution:**
- Check service requirements (discover again)
- Verify input format
- Try a different service provider

#### 4. Payment Refused

```
Error: Peer refused payment (signature invalid)
```

**Solution:**
- This indicates a serious issue (potential attack)
- Close channel immediately
- Report to network operator

### Timeout Handling

**Current behavior** (Task #103 will improve this):

- Service request timeout: 30 seconds
- Payment timeout: 10 seconds
- Channel open timeout: 60 seconds

**Best practice:**

```typescript
async function requestWithRetry(peerId, service, input, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await p2pRequest(peerId, service, input);
    } catch (err) {
      if (err.code === 'TIMEOUT' && i < maxRetries - 1) {
        console.log(`Retry ${i + 1}/${maxRetries}...`);
        await sleep(2000); // Wait 2s before retry
        continue;
      }
      throw err;
    }
  }
}
```

---

## Best Practices

### For Service Providers

1. **Set reasonable auto-accept limits**
   ```json5
   {"autoAcceptChannelsBelowSats": 10000}  // Don't auto-accept large channels
   ```

2. **Validate input thoroughly**
   ```typescript
   if (!input.topic || input.topic.length > 100) {
     throw new Error('Invalid input: topic required, max 100 chars');
   }
   ```

3. **Return structured results**
   ```typescript
   return {
     result: { poem: "...", metadata: {...} },
     success: true,
     processingTimeMs: 500
   };
   ```

4. **Handle errors gracefully**
   ```typescript
   try {
     const result = await generatePoem(input);
     return { success: true, result };
   } catch (err) {
     return { success: false, error: err.message };
   }
   ```

5. **Monitor your channels**
   ```
   Human: Show my P2P channels
   
   Agent: You have 5 open channels totaling 50,000 sats locked.
   ```

### For Service Consumers

1. **Set maxPayment limits**
   ```typescript
   await p2pRequest(peer, service, input, {
     maxPayment: 200  // Never pay more than 200 sats
   });
   ```

2. **Reuse channels**
   ```
   // Channel stays open for multiple requests
   await p2pRequest(peerA, 'service1', input1); // Opens channel
   await p2pRequest(peerA, 'service2', input2); // Reuses channel
   await p2pRequest(peerA, 'service3', input3); // Reuses channel
   ```

3. **Close idle channels**
   ```
   Human: Close channels with no activity in the last 24 hours
   ```

4. **Verify service quality**
   ```typescript
   // Start with small test request
   const test = await p2pRequest(peer, service, minimalInput, {
     maxPayment: 10
   });
   
   if (test.success) {
     // Proceed with real request
     const result = await p2pRequest(peer, service, fullInput, {
       maxPayment: 500
     });
   }
   ```

### General Best Practices

1. **Test on testnet first**
   ```json5
   {"walletPath": "~/.bsv-p2p/wallet-testnet.db"}
   ```

2. **Backup your wallet**
   ```bash
   cp ~/.bsv-p2p/wallet.db ~/.bsv-p2p/wallet-backup-$(date +%Y%m%d).db
   ```

3. **Monitor logs**
   ```bash
   openclaw gateway logs -f | grep bsv-p2p
   ```

4. **Start with small channels**
   ```typescript
   // Start with 1k sats, increase as you build trust
   openChannel(peer, 1000);
   ```

5. **Document your services**
   ```typescript
   const serviceDoc = {
     id: 'my-service',
     name: 'My Service',
     description: 'Detailed description of what your service does',
     pricing: {...},
     examples: [
       {input: {...}, output: {...}, cost: 100}
     ],
     limits: {
       maxRequestSize: 1000,
       maxResponseTime: 5000
     }
   };
   ```

---

## Next Steps

- **[Payment Channels Guide](./PAYMENT-CHANNELS-GUIDE.md)** - Deep dive into channel mechanics
- **[Discovery API](./DISCOVERY-API.md)** - Service discovery protocol
- **[Operator Guide](./OPERATOR-GUIDE.md)** - Running your own infrastructure
- **[API Reference](./API.md)** - Complete tool and endpoint documentation

## Support

- **Examples:** `examples/bot-services/` (coming soon)
- **Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Discussions:** https://github.com/galt-tr/bsv-p2p/discussions
