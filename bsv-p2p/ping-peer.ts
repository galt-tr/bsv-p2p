import { P2PNode } from './src/daemon/node.js'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = process.argv[2] || '12D3KooWEaP93ASxzXWJanh11xZ4UneyooPxDmQ9k6L8Rb8s9Dg4'

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
    
    // In libp2p v3, use stream.send() for writing
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    
    const sent = (stream as any).send(encoder.encode(pingMsg))
    console.log('Send result:', sent)
    
    // Read response using async iterator
    console.log('Waiting for response...')
    let response = ''
    
    // Set a timeout for reading
    const timeout = setTimeout(() => {
      console.log('⏰ Timeout waiting for response')
      stream.abort(new Error('Timeout'))
    }, 5000)
    
    try {
      for await (const chunk of stream) {
        response += decoder.decode(chunk instanceof Uint8Array ? chunk : chunk.subarray())
        console.log('📥 Received chunk:', response)
        // After getting response, break
        break
      }
      clearTimeout(timeout)
    } catch (e: any) {
      clearTimeout(timeout)
      if (e.message !== 'Timeout') throw e
    }
    
    if (response) {
      console.log('\n🎉 PING/PONG SUCCESS!')
      console.log('Response:', response)
    }
    
    await stream.close?.()
    
  } catch (e: any) {
    console.log('❌ Failed:', e.message)
    console.error(e.stack)
  }
  
  await node.stop()
  process.exit(0)
}

main().catch(console.error)
