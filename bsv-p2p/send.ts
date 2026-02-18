#!/usr/bin/env npx tsx
/**
 * Send a message via the running daemon's API
 * 
 * Usage: npx tsx send.ts <peerId> "message"
 */

const API_URL = 'http://127.0.0.1:4002'

async function main() {
  const peerId = process.argv[2]
  const message = process.argv[3]
  
  if (!peerId || !message) {
    console.log('Usage: npx tsx send.ts <peerId> "message"')
    console.log('')
    console.log('This sends via the running daemon (stable peer ID)')
    process.exit(1)
  }
  
  try {
    const res = await fetch(`${API_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId, message })
    })
    
    const data = await res.json()
    
    if (data.success) {
      console.log(`✅ Sent from ${data.from}`)
    } else {
      console.log(`❌ Error: ${data.error}`)
      process.exit(1)
    }
  } catch (err: any) {
    console.error(`❌ Failed to connect to daemon API: ${err.message}`)
    console.error('Is the daemon running? Check: sudo systemctl status bsv-p2p')
    process.exit(1)
  }
}

main()
