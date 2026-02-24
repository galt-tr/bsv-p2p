# Natural P2P Discovery Strategies — Research Report

**Date:** 2026-02-24  
**Author:** Researcher  
**Context:** bsv-p2p project natural discovery improvements

## Executive Summary

"Natural discovery" refers to peer discovery mechanisms that minimize or eliminate reliance on centralized infrastructure (hardcoded bootstrap nodes, centralized directories, DNS). Current bsv-p2p uses:
- ✅ mDNS (local network, works without infrastructure)
- ✅ GossipSub announcements (fully decentralized once connected)
- ⚠️  Bootstrap peers (requires hardcoded list)
- ⚠️  Relay server (single point of failure)

**Recommendations:**
1. **Add Kademlia DHT** (libp2p native) — best balance of decentralization and performance
2. **Implement Rendezvous protocol** (libp2p native) — lightweight service discovery
3. **Add peer-exchange (PEX)** — gossip-based bootstrap alternative
4. **Keep existing mechanisms** — they're already best-in-class for their niches

---

## 1. Current State Analysis

### What bsv-p2p Already Has

| Mechanism | Decentralized? | Works Offline? | NAT Traversal? | Notes |
|-----------|----------------|----------------|----------------|-------|
| mDNS | ✅ | ✅ (LAN only) | N/A | Perfect for local peers |
| GossipSub | ✅ | ❌ | ❌ | Needs initial connection |
| Bootstrap | ❌ | ❌ | ❌ | Hardcoded list |
| Relay | ❌ | ❌ | ✅ | Single relay at 167.172.134.84 |

### The Bootstrap Problem

Bootstrap peers are the Achilles heel of "natural" discovery:
- If all bootstrap peers go down, new nodes can't join the network
- Hardcoded IPs/domains create censorship risk
- Requires trust in bootstrap operators
- Geographic centralization (if all relays in one region)

**Question:** Can we bootstrap WITHOUT hardcoded addresses?

---

## 2. DHT-Based Discovery (Kademlia)

### What is Kademlia?

A distributed hash table (DHT) where:
- Peer IDs are 256-bit hashes
- Each peer stores routing info for ~log(N) other peers
- Lookup complexity: O(log N) hops
- Self-healing: automatically routes around failures
- No central authority

### How Discovery Works

1. **Initial connection:** Still needs bootstrap (but any DHT node works)
2. **Ongoing discovery:**
   - Query DHT for `rendezvous:<service>` key
   - DHT returns list of provider peer IDs
   - Connect directly to providers

3. **Content routing:**
   - Peers announce "I provide service X" → DHT stores mapping
   - Other peers query DHT for service X → get peer list
   - No need for periodic GossipSub announcements

### libp2p Implementation

```typescript
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'

const node = await createLibp2p({
  services: {
    dht: kadDHT({
      clientMode: false,           // Participate in DHT (be a server)
      validators: {},              // Custom content validation
      selectors: {},               // Choose between duplicate values
      peerInfoMapper: removePrivateAddressesMapper  // Filter out RFC1918
    })
  }
})

// Provide a service
await node.contentRouting.provide(CID.parse('service:bsv-payment-channel'))

// Find providers
const providers = node.contentRouting.findProviders(CID.parse('service:bsv-payment-channel'))
for await (const peer of providers) {
  console.log(peer.id, peer.multiaddrs)
}
```

### Pros
- ✅ Fully decentralized (no single point of failure)
- ✅ Self-organizing (peers join/leave dynamically)
- ✅ Works across WANs (not just LAN like mDNS)
- ✅ Proven at scale (IPFS, BitTorrent DHT)
- ✅ Native libp2p support

### Cons
- ❌ Still needs bootstrap for first DHT join (but any DHT node works)
- ❌ Slower than centralized registry (O(log N) hops)
- ❌ Not great for high-churn networks (frequent joins/leaves)
- ❌ Additional bandwidth (DHT maintenance traffic)

### When to Use
- Perfect for long-running nodes
- Great for service discovery in medium-to-large networks (>100 peers)
- Use alongside mDNS (local) and GossipSub (direct announcements)

---

## 3. Rendezvous Protocol

### What is Rendezvous?

A lightweight peer discovery protocol where:
- Rendezvous points (RPs) act as meeting places
- Peers register with RPs: "I'm interested in topic X"
- Other peers query RPs: "Who's interested in topic X?"
- RPs are just regular peers (decentralized)

### How It Works

1. Peer A registers with RP: `REGISTER topic:bsv-channels`
2. Peer B queries RP: `DISCOVER topic:bsv-channels`
3. RP returns list of peers (including A)
4. B dials A directly

### libp2p Implementation

```typescript
import { rendezvous } from '@libp2p/rendezvous'

const node = await createLibp2p({
  services: {
    rendezvous: rendezvous()
  }
})

// Find a rendezvous point (could be from DHT, bootstrap, or hardcoded)
const rpPeerId = PeerId.parse('QmRendezvous...')

// Register our interest
await node.services.rendezvous.register({
  ns: 'bsv-payment-channels',
  ttl: 7200  // 2 hours
}, { peerId: rpPeerId })

// Discover peers
const peers = await node.services.rendezvous.discover({
  ns: 'bsv-payment-channels',
  limit: 50
}, { peerId: rpPeerId })
```

### Pros
- ✅ Simpler than DHT (less overhead)
- ✅ Works well for niche topics (e.g., "BSV payment channels")
- ✅ Can use multiple RPs for redundancy
- ✅ Native libp2p protocol

### Cons
- ❌ Requires at least one RP address (like bootstrap)
- ❌ RPs can censor (refuse registrations)
- ❌ Not as self-organizing as DHT

### When to Use
- Perfect for special-interest groups
- Good for networks with well-known community RPs
- Use as a fallback if DHT is too heavy

---

## 4. Peer Exchange (PEX)

### What is PEX?

A gossip protocol where peers share their peer lists:
- After connecting to peer A, ask: "Who else do you know?"
- A sends list of 50 random peers
- Connect to some of them, repeat

### How It Works

```
You → Peer A: GETPEERS
Peer A → You: [Peer B, Peer C, Peer D, ...]
You → Peer B: GETPEERS
Peer B → You: [Peer E, Peer F, ...]
... (exponential spread)
```

### Implementation Strategy

```typescript
// Add a new message type to bsv-p2p protocol
enum MessageType {
  // ... existing types ...
  PEER_EXCHANGE_REQUEST = 'peer_exchange_request',
  PEER_EXCHANGE_RESPONSE = 'peer_exchange_response'
}

// Handler for peer exchange
async handlePeerExchange(remotePeerId: string) {
  const allPeers = this.libp2p.getPeers()
  
  // Sample 50 random peers (don't send entire list)
  const sample = sampleRandom(allPeers, 50)
  
  // Convert to multiaddrs
  const peerInfo = sample.map(peerId => ({
    peerId: peerId.toString(),
    multiaddrs: this.libp2p.peerStore.get(peerId).addresses.map(a => a.multiaddr.toString())
  }))
  
  await this.sendMessage(remotePeerId, {
    type: MessageType.PEER_EXCHANGE_RESPONSE,
    peers: peerInfo
  })
}
```

### Pros
- ✅ Fully decentralized (no special nodes)
- ✅ Fast bootstrap (only need ONE peer to start)
- ✅ Simple to implement
- ✅ Works in any network topology

### Cons
- ❌ Can spread stale peer info
- ❌ Privacy concern (reveals your connections)
- ❌ Vulnerable to eclipse attacks (malicious peers return only themselves)

### When to Use
- Excellent as a bootstrap fallback
- Combine with PeerID reputation (only exchange with trusted peers)
- Use rate-limiting (don't spam PEX requests)

---

## 5. Social/Trust-Based Discovery

### Concept

Bootstrap through social connections:
- Human operator knows other operators
- Share peer IDs out-of-band (Signal, email, QR codes)
- Build a web of trust

### Example: OpenClaw Agent Network

```
Dylan's agents:
  - Ghanima (main): <peer-id-1>
  - Coder: <peer-id-2>

Alice's agents:
  - Alice-main: <peer-id-3>

Bob's agents:
  - Bob-main: <peer-id-4>

Dylan introduces Ghanima to Alice-main:
  - Dylan sends Alice-main's peer ID to Ghanima
  - Ghanima dials Alice-main
  - Now Ghanima and Alice-main share peers via PEX
  - Entire networks become connected
```

### Implementation

Add to agent config:
```json
{
  "trustedPeers": [
    {
      "name": "Alice",
      "peerId": "12D3KooW...",
      "multiaddrs": ["/ip4/..."]
    }
  ]
}
```

### Pros
- ✅ Human-curated quality (no spam peers)
- ✅ Natural for small/medium communities
- ✅ Works with existing infrastructure (just add peer IDs)
- ✅ Built-in trust model (you know the operators)

### Cons
- ❌ Doesn't scale to millions of peers
- ❌ Requires human coordination
- ❌ Not "automatic" discovery

### When to Use
- Perfect for OpenClaw agent networks (100-10,000 agents)
- Combine with DHT for larger scale
- Use as initial bootstrap, then let DHT/PEX take over

---

## 6. Hybrid Strategy (Recommended)

Combine multiple mechanisms for resilience:

```
Layer 1 (Local): mDNS
  ↓ (discovers local peers)
Layer 2 (Social): Trusted peer list
  ↓ (bootstrap into wider network)
Layer 3 (Decentralized): DHT + PEX
  ↓ (discover new peers across internet)
Layer 4 (Service-specific): GossipSub + Rendezvous
  ↓ (find peers offering specific services)
Layer 5 (Fallback): Public relays
  ↓ (when all else fails)
```

### Connection Strategy

```typescript
async function connectToNetwork() {
  // 1. Try mDNS (local network)
  const localPeers = await discoverViaMDNS()
  if (localPeers.length > 0) {
    await connectToPeers(localPeers)
    return
  }
  
  // 2. Try trusted peers (from config)
  const trustedPeers = await loadTrustedPeers()
  if (trustedPeers.length > 0) {
    await connectToPeers(trustedPeers)
    // Continue to step 3...
  }
  
  // 3. Try DHT bootstrap
  const dhtPeers = await bootstrapDHT()
  if (dhtPeers.length > 0) {
    await connectToPeers(dhtPeers)
    // Continue to step 4...
  }
  
  // 4. Request PEX from connected peers
  await requestPeerExchange()
  
  // 5. Subscribe to GossipSub announcements
  await subscribeToAnnouncements()
  
  // 6. Register with Rendezvous points
  await registerWithRendezvous('bsv-payment-channels')
  
  // 7. Fallback: connect to public relay
  if (node.getPeers().length === 0) {
    await connectToRelay('167.172.134.84')
  }
}
```

---

## 7. Comparison Table

| Strategy | Decentralized | Bootstrap-Free | NAT Traversal | Latency | Bandwidth | Complexity | Scale |
|----------|---------------|----------------|---------------|---------|-----------|------------|-------|
| mDNS | ✅ | ✅ | N/A (LAN only) | Low | Low | Low | LAN only |
| GossipSub | ✅ | ❌ | ❌ | Low | Medium | Low | Medium |
| Kademlia DHT | ✅ | ⚠️  (1 node) | ❌ | Medium | Medium | High | Very High |
| Rendezvous | ⚠️  (RPs) | ❌ | ❌ | Low | Low | Low | Medium |
| PEX | ✅ | ⚠️  (1 peer) | ❌ | Low | Low | Low | High |
| Social/Trust | ✅ | ⚠️  | ❌ | Low | Low | Low | Low-Med |
| Bootstrap | ❌ | ❌ | ❌ | Low | Low | Low | High |
| Relay | ❌ | ❌ | ✅ | Medium | High | Medium | Medium |

---

## 8. Implementation Priorities for bsv-p2p

### Phase 1: Add PEX (Quick Win)

**Why:** Simple, fully decentralized, helps bootstrap from any single peer.

**Effort:** ~2-4 hours
- Add PEER_EXCHANGE message types
- Implement request/response handlers
- Rate-limit to prevent abuse
- Add CLI: `bsv-p2p peers exchange`

### Phase 2: Add Kademlia DHT (High Impact)

**Why:** Industry-standard decentralized discovery, proven at scale.

**Effort:** ~4-8 hours
- Install `@libp2p/kad-dht`
- Enable in P2PNode config
- Test discovery across NATs
- Document DHT usage in README

### Phase 3: Add Rendezvous (Nice-to-have)

**Why:** Lightweight alternative to DHT for niche topics.

**Effort:** ~2-4 hours
- Install `@libp2p/rendezvous`
- Choose initial RPs (could be the relay server)
- Add registration on startup
- Document in README

### Phase 4: Social Discovery UI

**Why:** Makes it easy for operators to share peer IDs.

**Effort:** ~4-6 hours
- Add `trustedPeers` config field
- CLI command to add trusted peer: `bsv-p2p peers add --name Alice --peer-id ... --multiaddr ...`
- QR code generation for peer info
- Integration with OpenClaw agent configs

---

## 9. The "Zero-Bootstrap" Dream

**Can we truly bootstrap without ANY hardcoded addresses?**

### Option A: DNS-based Discovery (BEP-0005 style)

Use DNS TXT records for discovery:
```
_bsv-p2p._tcp.example.com. IN TXT "peer=12D3KooW..."
```

Pros:
- Works with existing infrastructure (DNS)
- Can be decentralized (ENS, Handshake DNS)

Cons:
- Requires domain ownership
- Still somewhat centralized (DNS roots)

### Option B: Blockchain-based Registry

Store peer announcements on BSV blockchain:
- OP_RETURN with peer ID + multiaddr
- Query blockchain for recent announcements
- Fully decentralized, censorship-resistant

Pros:
- Truly decentralized
- Permanent record

Cons:
- Costs money (tx fees)
- Slower (block confirmation time)
- Blockchain bloat

### Option C: "Seed Nodes" as a Service

Maintain a community list of public seed nodes:
- Published on GitHub (galt-tr/bsv-p2p-seeds)
- Updated via pull requests
- Client fetches from GitHub on first run

Pros:
- Community-maintained
- Version-controlled

Cons:
- GitHub as central point (but easily mirrored)
- Requires internet access

### Verdict

There is NO perfect "zero-bootstrap" solution. Every system needs SOME way to find the first peer:
- **mDNS** requires being on the same LAN
- **DHT** requires knowing one DHT node
- **PEX** requires knowing one peer
- **DNS** requires a domain
- **Blockchain** requires a node

**Best approach:** Provide multiple bootstrap methods and let the user choose.

---

## 10. Recommendations

### For bsv-p2p (short-term)

1. ✅ **Keep mDNS** — works great for local discovery
2. ✅ **Keep GossipSub** — best for service announcements
3. ➕ **Add PEX** — easy win, helps bootstrap
4. ➕ **Add Kademlia DHT** — industry standard, proven
5. ⚠️  **Redundant relay** — add 1-2 more relays for resilience
6. 📝 **Document trusted peers pattern** — for social bootstrap

### For OpenClaw ecosystem (long-term)

1. **Community Seed Registry**
   - GitHub repo: `openclaw/p2p-seeds`
   - JSON file with known-good peers
   - Update monthly, versioned releases

2. **Trust Web**
   - Agents share peer IDs via secure channels (Signal, PGP-signed)
   - Build reputation system (trust known operators)

3. **BSV Registry** (future)
   - On-chain peer announcements
   - Query blockchain for active peers
   - Integrate with payment channels (proven on-chain = trusted)

---

## 11. References

- libp2p Specs: https://github.com/libp2p/specs
- Kademlia Paper: https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf
- BitTorrent PEX: BEP-0011
- IPFS Discovery: https://docs.ipfs.tech/concepts/discovery-mechanisms/
- Rendezvous Protocol: https://github.com/libp2p/specs/blob/master/rendezvous/README.md
- Circuit Relay v2: https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md

---

## Conclusion

**Natural discovery is a spectrum, not a binary.**

Current bsv-p2p is already 80% there:
- ✅ Fully decentralized service announcements (GossipSub)
- ✅ Zero-infrastructure local discovery (mDNS)
- ⚠️  Centralized bootstrap (hardcoded list)
- ⚠️  Single relay point of failure

**Next steps:**
1. Add PEX for peer-to-peer bootstrap
2. Add DHT for decentralized content routing
3. Document social/trust discovery patterns
4. Add redundant relays

With these additions, bsv-p2p will have best-in-class decentralized discovery that gracefully degrades even if all hardcoded infrastructure disappears.
