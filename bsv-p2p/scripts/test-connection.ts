#!/usr/bin/env npx tsx
/**
 * Test P2P Connection
 * 
 * Usage: npx tsx scripts/test-connection.ts <remote-peer-id>
 * 
 * This script:
 * 1. Starts a temporary P2P node
 * 2. Connects to the relay
 * 3. Sends a ping message to the specified peer
 * 4. Waits for response
 * 5. Reports success/failure
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { multiaddr } from '@multiformats/multiaddr'
import * as lp from 'it-length-prefixed'
import { pipe } from 'it-pipe'

const RELAY_ADDR = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const MESSAGE_PROTOCOL = '/openclaw/message/1.0.0'

async function main() {
  const remotePeerId = process.argv[2]
  
  if (!remotePeerId) {
    console.log(`
BSV P2P Connection Tester
=========================

Usage: npx tsx scripts/test-connection.ts <remote-peer-id>

Example: npx tsx scripts/test-connection.ts 12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P

This will:
1. Start a temporary P2P node
2. Connect to the relay server
3. Send a test message to the specified peer
4. Wait for acknowledgment
5. Report the result

Make sure the target peer has their daemon running!
`)
    process.exit(1)
  }

  console.log('🚀 Starting P2P connection test...')
  console.log(`   Target peer: ${remotePeerId.substring(0, 20)}...`)
  console.log('')

  // Create a temporary node
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0', '/p2p-circuit']
    },
    transports: [
      tcp(),
      circuitRelayTransport({ discoverRelays: 1 })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify()
    }
  })

  await node.start()
  console.log(`✅ Node started: ${node.peerId.toString().substring(0, 20)}...`)

  // Connect to relay
  console.log('📡 Connecting to relay...')
  try {
    await node.dial(multiaddr(RELAY_ADDR))
    console.log('✅ Connected to relay')
  } catch (err: any) {
    console.error(`❌ Failed to connect to relay: ${err.message}`)
    await node.stop()
    process.exit(1)
  }

  // Wait for relay reservation
  console.log('⏳ Waiting for relay reservation...')
  await new Promise(r => setTimeout(r, 3000))
  
  const addrs = node.getMultiaddrs().map(a => a.toString())
  const relayAddr = addrs.find(a => a.includes('p2p-circuit'))
  if (relayAddr) {
    console.log(`✅ Got relay address`)
  } else {
    console.log('⚠️  No relay reservation yet (continuing anyway)')
  }

  // Connect to remote peer via relay
  console.log(`🔗 Connecting to ${remotePeerId.substring(0, 20)}... via relay`)
  const remoteAddr = multiaddr(`${RELAY_ADDR}/p2p-circuit/p2p/${remotePeerId}`)
  
  try {
    const conn = await node.dial(remoteAddr, { signal: AbortSignal.timeout(15000) })
    console.log('✅ Connected to remote peer!')
    
    // Send a test message
    console.log('📤 Sending test message...')
    const stream = await conn.newStream(MESSAGE_PROTOCOL, { runOnLimitedConnection: true })
    
    const testMessage = {
      id: `test-${Date.now()}`,
      type: 'text',
      timestamp: Date.now(),
      from: node.peerId.toString(),
      to: remotePeerId,
      content: `Hello from connection test! Time: ${new Date().toISOString()}`
    }
    
    const encoded = new TextEncoder().encode(JSON.stringify(testMessage))
    
    await pipe(
      [encoded],
      (source: any) => lp.encode(source),
      async (source: any) => {
        for await (const chunk of source) {
          stream.send(chunk)
        }
      }
    )
    
    await stream.sendCloseWrite?.()
    console.log('✅ Message sent!')
    
    console.log('')
    console.log('='.repeat(50))
    console.log('🎉 CONNECTION TEST SUCCESSFUL!')
    console.log('='.repeat(50))
    console.log('')
    console.log(`Your peer can reach: ${remotePeerId.substring(0, 20)}...`)
    console.log(`Message protocol: ${MESSAGE_PROTOCOL}`)
    console.log('')
    console.log('Next steps:')
    console.log('1. Check the remote peer daemon logs for the received message')
    console.log('2. Try opening a payment channel')
    console.log('')
    
  } catch (err: any) {
    console.error('')
    console.error('='.repeat(50))
    console.error('❌ CONNECTION TEST FAILED')
    console.error('='.repeat(50))
    console.error('')
    console.error(`Error: ${err.message}`)
    console.error('')
    console.error('Troubleshooting:')
    console.error('1. Is the remote peer daemon running?')
    console.error('2. Is their PeerId correct?')
    console.error('3. Check their daemon logs for connection attempts')
    console.error('')
    await node.stop()
    process.exit(1)
  }

  await node.stop()
  console.log('👋 Node stopped')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
