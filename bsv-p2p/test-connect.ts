import { P2PNode } from './src/daemon/node.js'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = '12D3KooWDG6xCHg7ocsP7genHLwaR7TJdQDDkjek63cx4YME54AV'

async function main() {
  const node = new P2PNode({ 
    port: 4006, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  console.log('My PeerId:', node.peerId)
  console.log('My addresses:', node.multiaddrs)
  
  await new Promise(r => setTimeout(r, 8000))
  console.log('\nConnected peers:', node.getConnectedPeers())
  console.log('My addresses now:', node.multiaddrs)
  
  // Try relay connection
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  console.log(`\nTrying: ${TARGET.slice(0,16)}...`)
  
  try {
    await Promise.race([
      node.connect(relayAddr),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
    ])
    console.log('✅ CONNECTED!')
    console.log('Peers:', node.getConnectedPeers())
  } catch (e: any) {
    console.log('❌', e.message)
  }
  
  await node.stop()
  process.exit(0)
}
main()
