/**
 * Paid Haiku Service Example
 * 
 * Demonstrates the full flow:
 * 1. Register a service on the P2P network
 * 2. Receive paid requests from other agents
 * 3. Generate haiku and send response
 * 4. (Future: Accept payment via channel)
 * 
 * Run with: npx tsx examples/paid-haiku-service.ts
 */

const API_PORT = 4003

interface ServiceRequest {
  id: string
  type: string
  service: string
  params: { topic?: string }
  from: string
}

// Simple haiku generator
function generateHaiku(topic: string): string {
  const haikus: Record<string, string> = {
    bitcoin: `Satoshis flowing\nPeer to peer without borders\nFreedom in each block`,
    payment: `Channels open wide\nMicropayments stream like rain\nSettlement awaits`,
    agent: `Bots talk to bots now\nServices exchanged for sats\nThe future is here`,
    default: `Words flow like water\nFive seven five syllables\nNature speaks to us`
  }
  return haikus[topic.toLowerCase()] || haikus.default
}

async function registerService() {
  const response = await fetch(`http://127.0.0.1:${API_PORT}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'haiku',
      name: 'Haiku Generator',
      description: 'Generate a haiku on any topic. Quick, cheap, poetic.',
      price: 10,
      currency: 'bsv'
    })
  })
  const result = await response.json()
  console.log('✅ Service registered:', result)
}

async function handleRequest(request: ServiceRequest): Promise<string> {
  const topic = request.params?.topic || 'default'
  console.log(`📝 Generating haiku for topic: ${topic}`)
  
  const haiku = generateHaiku(topic)
  
  // In a real implementation, we'd:
  // 1. Check for valid payment in the request
  // 2. Or open a channel if this is first request
  // 3. Deduct from channel balance
  
  return haiku
}

async function sendResponse(peerId: string, haiku: string, requestId: string) {
  const response = await fetch(`http://127.0.0.1:${API_PORT}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      peerId,
      message: JSON.stringify({
        type: 'paid:result',
        requestId,
        result: haiku,
        price: 10,
        currency: 'bsv'
      })
    })
  })
  const result = await response.json()
  console.log('📤 Response sent:', result.success ? '✓' : '✗')
}

async function main() {
  console.log('🎋 Paid Haiku Service Starting...\n')
  
  // Register the service
  await registerService()
  
  console.log('\n📡 Service ready! Waiting for requests...')
  console.log('   Other agents can request haikus by sending:')
  console.log('   { type: "paid:request", service: "haiku", params: { topic: "bitcoin" } }')
  console.log('\n   Press Ctrl+C to stop\n')
  
  // In a real implementation, we'd listen for incoming messages
  // For now, this is a demonstration of the service structure
}

main().catch(console.error)
