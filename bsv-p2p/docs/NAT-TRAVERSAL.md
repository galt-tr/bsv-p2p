# NAT Traversal in libp2p

## The Problem

When two peers are behind different NATs (private networks), they can't directly connect:
- **Peer A:** `10.0.0.33` (private) → Router → `203.0.113.10` (public)
- **Peer B:** `192.168.1.166` (private) → Router → `198.51.100.5` (public)

Each peer only knows its private IP. Without help, they can't discover each other's public IPs or establish connections through their NATs.

## libp2p NAT Traversal Stack

libp2p provides a complete NAT traversal solution with these components:

### 1. AutoNAT (`@libp2p/autonat`)

**Purpose:** Detect if you're behind a NAT.

**How it works:**
1. Node asks other peers to dial it back on its addresses
2. If dials fail → you're behind a NAT
3. If dials succeed → you're publicly reachable

**Protocol:** `/libp2p/autonat/1.0.0`

### 2. UPnP NAT (`@libp2p/upnp-nat`)

**Purpose:** Automatically configure port forwarding on your router.

**How it works:**
1. Uses UPnP/NAT-PMP protocols to request port mapping
2. Router opens external port and forwards to your internal IP
3. You can now advertise your public IP:port

**Limitation:** Many routers have UPnP disabled or don't support it.

### 3. Circuit Relay v2 (`@libp2p/circuit-relay-v2`)

**Purpose:** Route traffic through a public relay node when direct connection isn't possible.

**How it works:**
1. Private node connects to a public relay node
2. Requests a "reservation" (relay agrees to forward traffic)
3. Advertises relay address: `/ip4/RELAY_IP/tcp/PORT/p2p/RELAY_ID/p2p-circuit/p2p/MY_ID`
4. Other peers dial through the relay

**Relay address format:**
```
/ip4/198.51.100.0/tcp/55555/p2p/QmRelay/p2p-circuit/p2p/QmAlice
       ^---- relay's address ----^        ^-- destination --^
```

### 4. DCUtR - Direct Connection Upgrade through Relay (`@libp2p/dcutr`)

**Purpose:** Hole punching — upgrade a relayed connection to direct.

**How it works:**
1. A and B connect through relay
2. Exchange their observed public addresses
3. Measure round-trip time through relay
4. Simultaneously dial each other at calculated time
5. NAT mappings are created → "holes punched"
6. Direct connection established, relay no longer needed

**Protocol:** Inspired by ICE (STUN/TURN) but decentralized.

## Implementation Plan for bsv-p2p

### Phase 1: Add AutoNAT + Circuit Relay (Essential)

```typescript
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'

const node = await createLibp2p({
  // ... existing config ...
  transports: [
    tcp(),
    circuitRelayTransport()  // Enable dialing through relays
  ],
  services: {
    // ... existing services ...
    autoNAT: autoNAT(),  // Detect NAT status
    relay: circuitRelayServer({  // Act as relay for others (if public)
      reservations: {
        maxReservations: 128
      }
    })
  }
})
```

### Phase 2: Add DCUtR for Hole Punching

```typescript
import { dcutr } from '@libp2p/dcutr'

const node = await createLibp2p({
  // ...
  services: {
    dcutr: dcutr()  // Enable hole punching
  }
})
```

### Phase 3: Add UPnP (Optional, helps some users)

```typescript
import { uPnPNAT } from '@libp2p/upnp-nat'

const node = await createLibp2p({
  // ...
  services: {
    upnp: uPnPNAT()  // Try to auto-configure router
  }
})
```

## Bootstrap/Relay Nodes

For a production deployment, you need at least one public relay node that both peers can reach:

### Option 1: Use Public IPFS Relays
The default bootstrap peers can act as relays, but they're not guaranteed.

### Option 2: Run Your Own Relay
Deploy a VPS with public IP running libp2p with `circuitRelayServer` enabled.

### Option 3: Use libp2p Public Relay List
Some community-maintained relay nodes exist.

## Connection Flow (After Implementation)

1. **Node starts:**
   - AutoNAT checks if publicly reachable
   - If not: connects to relays, gets reservation
   - Advertises relay addresses

2. **Node A wants to dial Node B:**
   - If B has direct address → try direct dial
   - If B has relay address → dial through relay
   - DCUtR attempts hole punch to upgrade to direct

3. **Successful connection:**
   - Either direct (best) or relayed (fallback)
   - Encrypted end-to-end regardless

## Required Package Updates

```bash
npm install @libp2p/autonat @libp2p/circuit-relay-v2 @libp2p/dcutr @libp2p/upnp-nat
```

## Public IP Address Announcement

To announce your public IP instead of private:

```typescript
const node = await createLibp2p({
  addresses: {
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    // Explicitly announce public IP
    announce: ['/ip4/YOUR_PUBLIC_IP/tcp/4001']
  }
})
```

Or let UPnP/AutoNAT discover and announce it automatically.

## References

- [libp2p NAT Overview](https://libp2p.io/guides/nat-overview/)
- [Circuit Relay Guide](https://libp2p.io/guides/circuit-relay/)
- [Hole Punching Guide](https://libp2p.io/guides/hole-punching/)
- [AutoNAT Spec](https://github.com/libp2p/specs/blob/master/autonat/README.md)
- [DCUtR Spec](https://github.com/libp2p/specs/blob/master/relay/DCUtR.md)
- [Circuit Relay v2 Spec](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
