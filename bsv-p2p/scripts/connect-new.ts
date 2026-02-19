import { P2PNode } from './src/daemon/node.js'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = '12D3KooWQ5xPLYSEhtPAJUE2BvR6aHfUfxKc1t89m9QYg5RNHhDv'

async function main() {
  const node = new P2PNode({ 
    port: 4008, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  console.log('My PeerId:', node.peerId)
  
  console.log('Waiting for relay...')
  await new Promise(r => setTimeout(r, 8000))
  
  const relayAddrs = node.multiaddrs.filter(a => a.includes('p2p-circuit'))
  console.log(`Got ${relayAddrs.length} relay addresses`)
  
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  console.log(`\nConnecting to ${TARGET.slice(0,20)}...`)
  
  try {
    await Promise.race([
      node.connect(relayAddr),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
    ])
    console.log('\n🎉🎉🎉 CONNECTED VIA RELAY! 🎉🎉🎉')
    console.log('Connected peers:', node.getConnectedPeers())
  } catch (e: any) {
    console.log('❌', e.message)
  }
  
  await node.stop()
  process.exit(0)
}
main()
