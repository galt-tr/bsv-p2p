#!/usr/bin/env npx tsx
/**
 * Send a P2P message to another peer
 * 
 * Usage: npx tsx send-message.ts <peerId> <message>
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { MessageHandler, MessageType, Message } from './src/protocol/index.js'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

// Always use ephemeral keys for CLI - don't steal daemon's reservation!
async function loadKey() {
  return await generateKeyPair('Ed25519')
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    console.log('Usage: npx tsx send-message.ts <peerId> <message>')
    console.log('       npx tsx send-message.ts <peerId> --request <service> [params-json]')
    process.exit(1)
  }
  
  const toPeerId = args[0]
  const isRequest = args[1] === '--request'
  
  const privateKey = await loadKey()
  
  const node = await createLibp2p({
    privateKey,
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [
      tcp(),
      circuitRelayTransport({ discoverRelays: 1 })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { identify: identify() }
  })

  await node.start()
  console.log('Started:', node.peerId.toString())

  // Wait for relay
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log('Connected to relay')
        resolve()
      }
    })
  })
  
  await new Promise(r => setTimeout(r, 2000))

  // Set up message handler
  const handler = new MessageHandler({
    node,
    peerId: node.peerId.toString(),
    relayAddr: RELAY,
    onMessage: (msg: Message, peerId: string) => {
      console.log(`\n📥 Response from ${peerId.substring(0, 16)}...`)
      console.log(JSON.stringify(msg, null, 2))
    }
  })
  handler.register()

  try {
    if (isRequest) {
      // Service request mode
      const service = args[2]
      const params = args[3] ? JSON.parse(args[3]) : {}
      
      console.log(`\n📤 Sending request to ${toPeerId.substring(0, 16)}...`)
      console.log(`Service: ${service}`)
      console.log(`Params: ${JSON.stringify(params)}`)
      
      const response = await handler.request(toPeerId, service, params, 60000)
      console.log('\n📥 Response:')
      console.log(JSON.stringify(response, null, 2))
      
    } else {
      // Text message mode
      const content = args.slice(1).join(' ')
      
      console.log(`\n📤 Sending to ${toPeerId.substring(0, 16)}...`)
      console.log(`Message: ${content}`)
      
      const msg = await handler.sendText(toPeerId, content)
      console.log('✅ Sent!')
      console.log(`Message ID: ${msg.id}`)
    }
    
  } catch (err: any) {
    console.error('❌ Error:', err.message)
  }
  
  // Wait a moment for any responses
  await new Promise(r => setTimeout(r, 2000))
  
  await node.stop()
}

main().catch(console.error)
