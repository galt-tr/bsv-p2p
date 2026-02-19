/**
 * Local test: Start two nodes on different ports and test ping between them
 * 
 * KEY FINDING: In libp2p v3, the handler receives the STREAM DIRECTLY,
 * not { stream, connection }. This is a breaking change from v2.
 */
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { generateKeyPair } from '@libp2p/crypto/keys'

async function main() {
  console.log('=== Starting Server Node ===')
  
  const serverKey = await generateKeyPair('Ed25519')
  const server = await createLibp2p({
    privateKey: serverKey,
    addresses: { listen: ['/ip4/127.0.0.1/tcp/4010'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() }
  })
  
  await server.start()
  console.log('Server PeerId:', server.peerId.toString())
  const serverAddr = server.getMultiaddrs()[0]
  console.log('Server address:', serverAddr?.toString())

  // In libp2p v3, handler receives stream directly (not { stream, connection })
  await server.handle('/test/ping/1.0.0', async (stream: any) => {
    console.log('[Server] Handler called! Stream type:', stream?.constructor?.name)
    
    try {
      let pingData = ''
      console.log('[Server] Reading data...')
      
      // Stream itself is async iterable in v3
      for await (const chunk of stream) {
        const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray()
        pingData += new TextDecoder().decode(bytes)
        console.log('[Server] Got chunk:', pingData.length, 'bytes total')
      }
      console.log('[Server] Read complete, received:', pingData)
      
      const ping = JSON.parse(pingData)
      const pong = JSON.stringify({ type: 'pong', timestamp: Date.now(), inResponseTo: ping.timestamp })
      
      console.log('[Server] Sending pong...')
      const sent = stream.send(new TextEncoder().encode(pong))
      console.log('[Server] Send result:', sent)
      
      console.log('[Server] Closing write...')
      await stream.sendCloseWrite?.()
      console.log('[Server] Done')
      
    } catch (err: any) {
      console.error('[Server] Handler error:', err.message)
      console.error(err.stack)
    }
  })
  console.log('[Server] Handler registered')
  
  console.log('\n=== Starting Client Node ===')
  const clientKey = await generateKeyPair('Ed25519')
  const client = await createLibp2p({
    privateKey: clientKey,
    addresses: { listen: ['/ip4/127.0.0.1/tcp/4011'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() }
  })
  await client.start()
  console.log('Client PeerId:', client.peerId.toString())
  
  await new Promise(r => setTimeout(r, 2000))
  
  console.log('\n=== Testing Ping ===')
  try {
    console.log('Dialing server...')
    await client.dial(serverAddr!)
    console.log('[Client] Connected to server')
    
    await new Promise(r => setTimeout(r, 500))
    
    console.log('[Client] Dialing protocol...')
    const stream = await client.dialProtocol(serverAddr!, '/test/ping/1.0.0')
    
    console.log('[Client] Got stream, status:', (stream as any).status)
    
    if ((stream as any).status !== 'open') {
      throw new Error('Stream not open: ' + (stream as any).status)
    }
    
    const pingMsg = JSON.stringify({ type: 'ping', timestamp: Date.now() })
    console.log('\n📤 Sending:', pingMsg)
    
    const sent = (stream as any).send(new TextEncoder().encode(pingMsg))
    console.log('Send result:', sent)
    
    console.log('Closing write side...')
    await (stream as any).sendCloseWrite?.()
    
    console.log('Reading response...')
    let response = ''
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      const data = chunk instanceof Uint8Array ? chunk : (chunk as any).subarray()
      response += new TextDecoder().decode(data)
      console.log('📥 Got chunk')
    }
    
    console.log('\n🎉 SUCCESS!')
    console.log('Response:', response)
    
  } catch (e: any) {
    console.log('❌ Failed:', e.message)
    console.error(e.stack)
  }
  
  await client.stop()
  await server.stop()
  process.exit(0)
}

main().catch(console.error)
