import { P2PNode } from './src/daemon/node.js'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = '12D3KooWEaP93ASxzXWJanh11xZ4UneyooPxDmQ9k6L8Rb8s9Dg4'

async function main() {
  const node = new P2PNode({ 
    port: 4006, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  
  await new Promise(r => setTimeout(r, 3000))
  
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  
  try {
    const stream = await node['node'].dialProtocol(
      multiaddr(relayAddr),
      '/openclaw/ping/1.0.0',
      { runOnLimitedConnection: true }
    )
    
    console.log('=== STREAM OBJECT ===')
    console.log('Type:', typeof stream)
    console.log('Constructor:', stream?.constructor?.name)
    
    // Check inherited properties
    console.log('\nDirect property access:')
    console.log('stream.sink:', stream.sink)
    console.log('stream.source:', stream.source)
    console.log('stream.protocol:', stream.protocol)
    console.log('stream.direction:', stream.direction)
    console.log('stream.id:', stream.id)
    
    // Check if source is iterable
    if (stream.source && typeof stream.source[Symbol.asyncIterator] === 'function') {
      console.log('\n✅ source is async iterable')
    } else {
      console.log('\n❌ source is NOT async iterable')
    }
    
    // Check if sink is callable
    if (typeof stream.sink === 'function') {
      console.log('✅ sink is a function')
    } else {
      console.log('❌ sink is NOT a function')
    }
    
    // Try reading the protocol chain
    let proto = Object.getPrototypeOf(stream)
    let depth = 0
    while (proto && depth < 5) {
      console.log(`\nPrototype level ${depth}: ${proto.constructor?.name}`)
      const keys = Object.getOwnPropertyNames(proto).filter(k => !['constructor'].includes(k))
      console.log('  Methods:', keys.slice(0, 10).join(', '))
      if (proto.sink) console.log('  HAS SINK!')
      if (proto.source) console.log('  HAS SOURCE!')
      proto = Object.getPrototypeOf(proto)
      depth++
    }
    
    await stream.close?.()
    
  } catch (e: any) {
    console.log('Error:', e.message)
    console.error(e.stack)
  }
  
  await node.stop()
  process.exit(0)
}

main().catch(console.error)
