import { P2PNode } from './src/daemon/node.js'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = process.argv[2] || '12D3KooWDG6xCHg7ocsP7genHLwaR7TJdQDDkjek63cx4YME54AV'

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
  await new Promise(r => setTimeout(r, 5000))
  console.log('Connected peers:', node.getConnectedPeers())
  
  // Try to connect via relay
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  console.log(`\nDialing via relay: ${TARGET.slice(0,20)}...`)
  
  try {
    await Promise.race([
      node.connect(relayAddr),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
    ])
    console.log('✅ CONNECTED VIA RELAY!')
    console.log('All connected peers:', node.getConnectedPeers())
  } catch (e: any) {
    console.log('❌ Failed:', e.message)
  }
  
  await node.stop()
  process.exit(0)
}

main().catch(console.error)
