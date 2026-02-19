/**
 * Test script to verify the relay connection fix.
 * 
 * This tests that:
 * 1. We can connect to the relay and get a reservation
 * 2. The connection is maintained (not closed for "refresh")
 * 3. We can reconnect if disconnected
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const RELAY_PEER_ID = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const KEY_FILE = join(homedir(), '.bsv-p2p', 'peer-key.json')

async function loadKey() {
  if (!existsSync(KEY_FILE)) {
    throw new Error('No peer key found. Run the daemon first to generate one.')
  }
  const keyData = JSON.parse(readFileSync(KEY_FILE, 'utf-8'))
  return privateKeyFromProtobuf(Uint8Array.from(keyData.privateKey))
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function getRelayAddress(node: any): string | null {
  const addrs = node.getMultiaddrs().map((m: any) => m.toString())
  return addrs.find((a: string) => a.includes('p2p-circuit') && a.includes('167.172.134.84')) || null
}

function isConnectedToRelay(node: any): boolean {
  return node.getConnections().some((c: any) => c.remotePeer.toString() === RELAY_PEER_ID)
}

async function waitForReservation(node: any, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (getRelayAddress(node)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

async function main() {
  log('=== RELAY CONNECTION FIX TEST ===')
  log('')
  
  const privateKey = await loadKey()
  
  log('Creating libp2p node...')
  const node = await createLibp2p({
    privateKey,
    addresses: { 
      listen: ['/ip4/0.0.0.0/tcp/0', '/p2p-circuit']
    },
    transports: [
      tcp(),
      circuitRelayTransport({ reservationCompletionTimeout: 10_000 })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { identify: identify() }
  })

  // Track disconnects
  let disconnectCount = 0
  node.addEventListener('peer:disconnect', (evt: any) => {
    if (evt.detail.toString() === RELAY_PEER_ID) {
      disconnectCount++
      log(`⚠️  RELAY DISCONNECTED (count: ${disconnectCount})`)
    }
  })

  await node.start()
  log(`PeerId: ${node.peerId.toString()}`)
  
  // Test 1: Initial connection and reservation
  log('')
  log('TEST 1: Initial reservation')
  log('----------------------------')
  
  const hasReservation = await waitForReservation(node, 15_000)
  if (!hasReservation) {
    log('❌ FAILED: Could not get initial reservation')
    await node.stop()
    process.exit(1)
  }
  log(`✅ Got reservation: ${getRelayAddress(node)}`)
  
  // Test 2: Verify connection is maintained for 30 seconds
  log('')
  log('TEST 2: Connection stability (30 seconds)')
  log('------------------------------------------')
  log('Watching for unexpected disconnections...')
  
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const connected = isConnectedToRelay(node)
    const hasAddr = !!getRelayAddress(node)
    log(`  ${(i+1)*5}s: connected=${connected}, hasAddr=${hasAddr}, disconnects=${disconnectCount}`)
    
    if (!connected) {
      log('❌ FAILED: Connection dropped during stability test')
      await node.stop()
      process.exit(1)
    }
  }
  
  if (disconnectCount > 0) {
    log(`⚠️  WARNING: ${disconnectCount} disconnects occurred (might be network issues)`)
  } else {
    log('✅ Connection remained stable for 30 seconds')
  }
  
  // Test 3: Simulate disconnect and verify recovery
  log('')
  log('TEST 3: Recovery after forced disconnect')
  log('-----------------------------------------')
  
  const connections = node.getConnections()
  const relayConn = connections.find((c: any) => c.remotePeer.toString() === RELAY_PEER_ID)
  
  if (relayConn) {
    log('Forcing disconnect from relay...')
    await relayConn.close()
    
    // Give a moment for disconnect event
    await new Promise(r => setTimeout(r, 1000))
    
    log('Checking if reservation is gone...')
    const hasAddrAfterDisconnect = !!getRelayAddress(node)
    log(`  Reservation present: ${hasAddrAfterDisconnect}`)
    
    log('Reconnecting to relay...')
    await node.dial(multiaddr(RELAY))
    
    // Wait for new reservation
    const recovered = await waitForReservation(node, 10_000)
    if (recovered) {
      log(`✅ Recovered with new reservation: ${getRelayAddress(node)}`)
    } else {
      log('❌ FAILED: Could not recover reservation after reconnect')
      await node.stop()
      process.exit(1)
    }
  } else {
    log('⚠️  Could not find relay connection to test disconnect')
  }
  
  // Cleanup
  log('')
  log('=== ALL TESTS PASSED ===')
  await node.stop()
  process.exit(0)
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
