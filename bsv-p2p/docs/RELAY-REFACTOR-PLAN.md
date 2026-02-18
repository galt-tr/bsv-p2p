# Circuit Relay v2 Refactor Plan

## Executive Summary

Our relay reservations are unreliable because we're fundamentally misunderstanding the circuit relay v2 protocol. This document explains the correct flow, identifies our mistakes, and provides a concrete implementation plan.

---

## Part 1: Circuit Relay v2 - First Principles

### 1.1 The Problem Relay Solves

When peers are behind NAT, they cannot receive incoming connections directly. A relay server acts as a bridge:

```
┌──────────┐                  ┌──────────┐                  ┌──────────┐
│  Peer A  │                  │  Relay   │                  │  Peer B  │
│ (NAT'd)  │ ◄── connection ──│ (Public) │── connection ──► │ (NAT'd)  │
└──────────┘                  └──────────┘                  └──────────┘
     │                             │                             │
     │ A connects to relay         │                             │
     │ A makes RESERVATION ────────│                             │
     │ A keeps connection open     │                             │
     │                             │                             │
     │                             │◄──── B wants to reach A ────│
     │                             │      B sends CONNECT to R   │
     │◄──── Relay forwards ────────│                             │
     │      STOP/CONNECT to A      │                             │
     │                             │                             │
     │ A ◄═══════════════════ RELAYED CONNECTION ══════════════► B
```

### 1.2 The Reservation Protocol

From the spec (circuit-v2.md):

> **A keeps the connection to R alive for the duration of the reservation, refreshing the reservation as needed.**
>
> **The reservation remains valid until its expiration, as long as there is an active connection from the peer to the relay. If the peer disconnects, the reservation is no longer valid.**

This is the **critical insight** we missed:

1. **Reservation requires a persistent connection to the relay**
2. **If you disconnect, your reservation is IMMEDIATELY invalid**
3. **Refreshing means sending a new RESERVE message on the SAME connection**

### 1.3 Reservation Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RESERVATION LIFECYCLE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. DIAL relay                                                      │
│       │                                                             │
│       ▼                                                             │
│  2. Send HopMessage { type: RESERVE }                               │
│       │                                                             │
│       ▼                                                             │
│  3. Receive HopMessage {                                            │
│       type: STATUS,                                                 │
│       status: OK,                                                   │
│       reservation: {                                                │
│         expire: <unix_timestamp>,   ◄── Expiration time!            │
│         addrs: [...],               ◄── Relay addresses to advertise│
│         voucher: <signed_cert>                                      │
│       },                                                            │
│       limit: { duration, data }     ◄── Per-connection limits       │
│     }                                                               │
│       │                                                             │
│       ▼                                                             │
│  4. KEEP CONNECTION OPEN            ◄── CRITICAL!                   │
│       │                                                             │
│       ├─── Before expiration: Send another RESERVE ◄── Refresh      │
│       │                                                             │
│       └─── If connection drops: RESERVATION INVALID ◄── Game over   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 Connection Flow (B connecting to A through relay)

1. B dials relay address: `/ip4/RELAY/tcp/PORT/p2p/RELAY_ID/p2p-circuit/p2p/PEER_A_ID`
2. B sends `HopMessage { type: CONNECT, peer: { id: A } }` to relay
3. Relay checks: Does A have a valid reservation AND active connection?
4. If yes: Relay opens `/libp2p/circuit/relay/0.2.0/stop` stream to A
5. Relay sends `StopMessage { type: CONNECT, peer: { id: B } }` to A
6. A responds with `StopMessage { type: STATUS, status: OK }`
7. Relay responds to B with `HopMessage { type: STATUS, status: OK }`
8. Streams are bridged: B ↔ Relay ↔ A

---

## Part 2: What We're Doing Wrong

### 2.1 Fatal Mistake: Closing Connection to Refresh

Our current `refreshRelayReservation()`:

```typescript
// ❌ WRONG - This destroys our reservation!
async refreshRelayReservation(): Promise<boolean> {
  // Close existing connection to relay to force new reservation
  const relayConn = connections.find(c => c.remotePeer.toString() === relayPeerId)
  if (relayConn) {
    await relayConn.close()  // ← THIS INVALIDATES OUR RESERVATION
    await new Promise(r => setTimeout(r, 1000))
  }
  
  // Re-dial relay
  await this.dialRelay(RELAY_ADDR)  // ← New reservation, but transient gap
  // ...
}
```

**Why this is wrong:**
- Closing the connection immediately invalidates the reservation
- There's a window where we have NO valid reservation
- During this window, peers cannot reach us
- Even after re-dialing, it takes time to establish new reservation

### 2.2 Misunderstanding discoverRelays

```typescript
circuitRelayTransport({
  discoverRelays: 1  // ← This is for DISCOVERING relays, not connecting to known ones
})
```

`discoverRelays: 1` tells libp2p to automatically discover relay peers and request reservations. But:
- We have a **known, specific relay** we want to use
- We should be explicitly managing the connection to that relay
- Auto-discovery is unreliable for our use case

### 2.3 No Reservation Expiration Tracking

We don't track when our reservation expires:

```typescript
// We only check if we HAVE a relay address, not if it's still valid
hasRelayReservation(): boolean {
  return addrs.some(a => a.includes('p2p-circuit') && a.includes('167.172.134.84'))
}
```

The reservation might have expired, but we still see the old addresses until libp2p cleans them up.

### 2.4 Insufficient Health Monitoring

Our health monitor checks:
- ✅ Whether we have relay addresses
- ✅ Whether we're connected to relay
- ❌ Whether our reservation is actually valid
- ❌ Whether the relay can still route traffic to us

---

## Part 3: The Go Implementation Approach

The Go library (`go-p2p-message-bus`) takes a simpler, more robust approach:

### 3.1 Static Relay Configuration

```go
hostOpts = append(hostOpts,
  libp2p.EnableRelay(),
  libp2p.EnableAutoRelayWithStaticRelays(relayPeers),  // ← Key difference
)
```

`EnableAutoRelayWithStaticRelays`:
- Provides a list of known relays
- libp2p maintains connections to these relays
- Automatically handles reservation refresh
- Built-in connection management

### 3.2 Bootstrap = Relay

```go
bootstrapPeers, relayPeers := getBootstrapAndRelayPeers(config, clientLogger)
// ...
// Use the same bootstrap peers as relay peers
clientLogger.Infof("Using bootstrap peers as relay peers")
return bootstrapPeers, bootstrapPeers
```

Simple principle: If you're using a peer for bootstrap, you can probably use it as a relay too.

### 3.3 Connection Maintenance

```go
func (c *client) maintainBootstrapConnections(ctx context.Context, bootstrapPeers []peer.AddrInfo) {
  ticker := time.NewTicker(30 * time.Second)
  for {
    select {
    case <-ticker.C:
      for _, peerInfo := range bootstrapPeers {
        if c.host.Network().Connectedness(peerInfo.ID) != network.Connected {
          // Reconnect to bootstrap peer
          go c.host.Connect(ctx, peerInfo)
        }
      }
    }
  }
}
```

They maintain the connection, not the reservation explicitly. By keeping the connection alive, the reservation stays valid.

---

## Part 4: Simplified Architecture

### 4.1 Design Principles

1. **Maintain Connection, Not Reservation** - Keep the relay connection alive; don't close it
2. **Use libp2p's Built-in Relay Management** - Stop fighting the framework
3. **Monitor Connection State** - Focus on connection health, not reservation refresh
4. **Fail Fast, Recover Fast** - If connection drops, reconnect immediately

### 4.2 New Connection Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NEW RELAY CONNECTION FLOW                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  STARTUP:                                                           │
│  1. Create libp2p node with circuitRelayTransport                   │
│  2. Connect to relay server (bootstrap peer)                        │
│  3. libp2p automatically requests reservation                       │
│  4. Wait for relay address in multiaddrs                            │
│                                                                     │
│  RUNTIME:                                                           │
│  5. Monitor connection to relay (every 10s)                         │
│  6. If connection drops:                                            │
│     - Log warning                                                   │
│     - Immediately attempt reconnect                                 │
│     - libp2p handles reservation                                    │
│  7. libp2p handles reservation refresh internally                   │
│                                                                     │
│  NEVER:                                                             │
│  - Close relay connection intentionally                             │
│  - Manually send RESERVE messages                                   │
│  - Assume reservation is valid just because we have addresses       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Component Responsibilities

| Component | Old Responsibility | New Responsibility |
|-----------|-------------------|-------------------|
| `P2PNode` | Manual reservation refresh | Connection maintenance only |
| `circuitRelayTransport` | Discover relays | Handle reservation lifecycle |
| `HealthMonitor` | Check relay addresses | Monitor connection state |
| `dialRelay()` | Force reconnection | Initial connection only |

---

## Part 5: Implementation Changes

### 5.1 Remove Broken Refresh Logic

**Delete:**
```typescript
// DELETE THESE METHODS
async refreshRelayReservation(): Promise<boolean> { ... }
startReservationRefresh(intervalMs: number = 300000): void { ... }
stopReservationRefresh(): void { ... }
private reservationRefreshInterval: NodeJS.Timeout | null = null
```

**Replace with:** Simple connection monitoring.

### 5.2 Update Node Configuration

**Before:**
```typescript
transports: [
  tcp(),
  circuitRelayTransport({
    discoverRelays: 1  // ← Unreliable auto-discovery
  })
],
```

**After:**
```typescript
import { multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'

const RELAY_ADDR = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

// Parse relay info
const relayMa = multiaddr(RELAY_ADDR)
const relayPeerId = peerIdFromString('12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk')

// Configure transport with explicit relay
transports: [
  tcp(),
  circuitRelayTransport({
    // No discoverRelays - we'll manage our own relay
  })
],
```

### 5.3 Add Connection Maintenance Loop

**New method:**
```typescript
/**
 * Maintain connection to relay server.
 * This is the KEY to keeping reservations valid.
 */
private startRelayConnectionMaintenance(): void {
  const RELAY_PEER_ID = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
  const CHECK_INTERVAL = 10_000  // Check every 10 seconds
  
  const maintainConnection = async () => {
    if (!this.node) return
    
    const connections = this.node.getConnections()
    const relayConnection = connections.find(
      c => c.remotePeer.toString() === RELAY_PEER_ID
    )
    
    if (!relayConnection) {
      console.log('[Relay] Connection lost, reconnecting...')
      try {
        await this.dialRelay(RELAY_ADDR)
        console.log('[Relay] Reconnected successfully')
      } catch (err: any) {
        console.error('[Relay] Reconnection failed:', err.message)
      }
    } else {
      // Connection exists - reservation should be valid
      // libp2p handles refresh internally
    }
  }
  
  this.relayMaintenanceInterval = setInterval(maintainConnection, CHECK_INTERVAL)
  
  // Also run immediately
  maintainConnection()
}
```

### 5.4 Improved Startup Sequence

**New startup flow:**
```typescript
async start(): Promise<void> {
  // ... create node ...
  
  await this.node.start()
  
  // 1. Connect to relay immediately
  console.log('[Startup] Connecting to relay...')
  await this.dialRelay(RELAY_ADDR)
  
  // 2. Wait for reservation (with timeout)
  const hasReservation = await this.waitForReservation(30_000)
  if (!hasReservation) {
    throw new Error('Failed to acquire relay reservation')
  }
  
  // 3. Start connection maintenance (NOT reservation refresh)
  this.startRelayConnectionMaintenance()
  
  console.log('[Startup] Ready with relay address:', this.getRelayAddress())
}

/**
 * Wait for relay address to appear in our multiaddrs.
 * This indicates reservation was successful.
 */
private async waitForReservation(timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  
  while (Date.now() - start < timeoutMs) {
    const relayAddr = this.getRelayAddress()
    if (relayAddr) {
      return true
    }
    await new Promise(r => setTimeout(r, 500))
  }
  
  return false
}

/**
 * Get our relay circuit address if we have a valid reservation.
 */
getRelayAddress(): string | null {
  const addrs = this.multiaddrs
  return addrs.find(a => 
    a.includes('p2p-circuit') && 
    a.includes('167.172.134.84')
  ) || null
}
```

### 5.5 Updated Health Monitor

**Focus on connection state, not reservation:**
```typescript
async checkHealth(): Promise<HealthStatus> {
  const errors: string[] = []
  
  // Check relay connection (most important!)
  const relayPeerId = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
  const connections = this.node.getConnections()
  const relayConnection = connections.find(c => c.remotePeer.toString() === relayPeerId)
  
  if (!relayConnection) {
    errors.push('No connection to relay server')
  } else {
    // Check connection age - old connections might be stale
    const connectionAge = Date.now() - (relayConnection.timeline?.open || 0)
    if (connectionAge > 30 * 60 * 1000) {  // 30 minutes
      console.log('[Health] Relay connection is old, will refresh on next maintenance cycle')
    }
  }
  
  // Relay address check (secondary - can lag behind actual state)
  const relayAddr = this.node.getRelayAddress()
  if (!relayAddr) {
    errors.push('No relay address advertised')
  }
  
  return {
    isHealthy: errors.length === 0,
    relayConnected: !!relayConnection,
    relayAddress: relayAddr,
    errors
  }
}
```

### 5.6 Handle Connection Events

**Listen for disconnection:**
```typescript
private setupEventHandlers(): void {
  // ... existing handlers ...
  
  // React to relay disconnection immediately
  this.node.addEventListener('peer:disconnect', (evt) => {
    const peerId = evt.detail.toString()
    
    if (peerId === '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk') {
      console.warn('[Relay] ⚠️ Disconnected from relay server!')
      
      // Trigger immediate reconnection (don't wait for maintenance loop)
      setImmediate(async () => {
        try {
          await this.dialRelay(RELAY_ADDR)
          console.log('[Relay] Reconnected after disconnect')
        } catch (err) {
          console.error('[Relay] Failed to reconnect:', err)
        }
      })
    }
  })
}
```

---

## Part 6: Code Changes Summary

### Files to Modify

| File | Changes |
|------|---------|
| `src/daemon/node.ts` | Remove refresh logic, add connection maintenance |
| `src/daemon/index.ts` | Update startup sequence, remove reservation refresh calls |

### Methods to Delete

- `refreshRelayReservation()`
- `startReservationRefresh()`
- `stopReservationRefresh()`
- `reservationRefreshInterval` property

### Methods to Add

- `startRelayConnectionMaintenance()`
- `stopRelayConnectionMaintenance()`
- `waitForReservation(timeoutMs)`
- `getRelayAddress()`

### Methods to Update

- `start()` - New startup sequence
- `stop()` - Cleanup maintenance interval
- `setupEventHandlers()` - Add disconnect handler
- `DaemonHealthMonitor.checkHealth()` - Focus on connection state

---

## Part 7: Testing Plan

### 7.1 Unit Tests

```typescript
describe('Relay Connection', () => {
  it('should connect to relay on startup', async () => {
    const node = new P2PNode()
    await node.start()
    
    expect(node.getRelayAddress()).toBeTruthy()
  })
  
  it('should reconnect when relay connection drops', async () => {
    const node = new P2PNode()
    await node.start()
    
    // Simulate disconnect
    const connections = node.getConnections()
    const relayConn = connections.find(c => 
      c.remotePeer.toString().includes('12D3KooWNhNQ9A'))
    await relayConn.close()
    
    // Wait for maintenance loop
    await new Promise(r => setTimeout(r, 15_000))
    
    expect(node.getRelayAddress()).toBeTruthy()
  })
  
  it('should NOT close relay connection during normal operation', async () => {
    const node = new P2PNode()
    await node.start()
    
    const relayPeerId = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
    let disconnectCount = 0
    
    node.on('peer:disconnect', (peerId) => {
      if (peerId === relayPeerId) disconnectCount++
    })
    
    // Run for 5 minutes
    await new Promise(r => setTimeout(r, 5 * 60_000))
    
    expect(disconnectCount).toBe(0)
  })
})
```

### 7.2 Integration Tests

1. **Two peers communicating via relay:**
   - Start peer A, get relay address
   - Start peer B, dial peer A via relay
   - Exchange messages
   - Verify messages received

2. **Relay recovery after network blip:**
   - Start peer, get relay address
   - Temporarily block relay (iptables)
   - Unblock after 30 seconds
   - Verify peer recovers relay address

3. **Long-running stability:**
   - Start peer
   - Run for 2 hours
   - Periodically check relay address exists
   - Verify no unexpected disconnects

---

## Part 8: Migration Checklist

### Before Starting
- [ ] Backup current `node.ts`
- [ ] Document current behavior
- [ ] Set up test environment

### Implementation
- [ ] Remove broken refresh methods from `node.ts`
- [ ] Add connection maintenance loop
- [ ] Update startup sequence
- [ ] Add disconnect event handler
- [ ] Update health monitor
- [ ] Update daemon `index.ts`

### Testing
- [ ] Test fresh start → relay address acquired
- [ ] Test relay disconnect → automatic reconnect
- [ ] Test long-running stability (1+ hour)
- [ ] Test peer-to-peer messaging via relay

### Deployment
- [ ] Update running daemons
- [ ] Monitor logs for relay issues
- [ ] Verify cross-peer communication

---

## Appendix A: Relay Server Configuration

Our relay server (`relay-server/index.js`) configuration:

```javascript
relay: circuitRelayServer({
  reservations: {
    maxReservations: 1024,      // Max peers that can reserve
    reservationTtl: 1800000,    // 30 minutes reservation lifetime
    defaultDurationLimit: 600000,  // 10 min per relayed connection
    defaultDataLimit: BigInt(1 << 27)  // 128 MB per connection
  }
})
```

**Reservation TTL: 30 minutes** - This is how long a reservation lasts. libp2p should automatically refresh before expiration, but only if the connection is maintained.

---

## Appendix B: Debugging Commands

```bash
# Check if relay is reachable
nc -zv 167.172.134.84 4001

# Check daemon relay address
curl -s localhost:8080/status | jq '.relayAddress'

# Watch relay connection events
npx tsx src/daemon/index.ts 2>&1 | grep -i relay

# Test connectivity through relay
npx tsx ping-peer.ts <other-peer-id>
```

---

## Appendix C: References

- [Circuit Relay v2 Spec](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
- [go-p2p-message-bus](https://github.com/bsv-blockchain/go-p2p-message-bus)
- [js-libp2p Circuit Relay](https://github.com/libp2p/js-libp2p/tree/main/packages/transport-circuit-relay-v2)
- [libp2p NAT Traversal](https://docs.libp2p.io/concepts/nat/)

---

*Plan Version: 1.0*
*Created: 2026-02-18*
*Author: Ghanima (Research Subagent)*
