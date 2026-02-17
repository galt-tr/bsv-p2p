import { P2PNode } from './src/daemon/node.js'
import { pipe } from 'it-pipe'
import { encode, decode } from 'it-length-prefixed'
import { fromString, toString } from 'uint8arrays'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = process.argv[2] || '12D3KooWSPQk2DTx6kxUCQu2Rn7LDywfy9HAmwwEnoFsEskzhdDW'

async function main() {
  const node = new P2PNode({ 
    port: 4005, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  console.log('My PeerId:', node.peerId)
  
  // Wait for relay connection
  console.log('Connecting to relay...')
  await new Promise(r => setTimeout(r, 3000))
  
  // Connect via relay
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  console.log(`\nDialing peer via relay...`)
  
  try {
    await node.connect(relayAddr)
    console.log('✅ Connected to peer!')
    
    // Open a stream to send a ping
    console.log('\nOpening stream to /openclaw/ping/1.0.0...')
    const stream = await node['node'].dialProtocol(
      multiaddr(relayAddr),
      '/openclaw/ping/1.0.0',
      { runOnLimitedConnection: true }
    )
    
    const pingMsg = JSON.stringify({ type: 'ping', timestamp: Date.now(), from: node.peerId })
    console.log('📤 Sending:', pingMsg)
    
    // Send ping and read response
    let response = ''
    await pipe(
      [fromString(pingMsg)],
      encode,
      stream,
      decode,
      async function (source) {
        for await (const msg of source) {
          response = toString(msg.subarray())
          console.log('📥 Received:', response)
          break
        }
      }
    )
    
    if (response) {
      console.log('\n🎉 PING/PONG SUCCESS!')
    }
    
  } catch (e: any) {
    console.log('❌ Failed:', e.message)
  }
  
  await node.stop()
  process.exit(0)
}

main().catch(console.error)
