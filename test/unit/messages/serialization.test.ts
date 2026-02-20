import { describe, it, expect } from 'vitest'
import { encodeMessage, decodeMessage, serializeToJSON, deserializeFromJSON } from '../../../src/messages/serialization.js'
import { P2PMessage, MessageType, RequestPayload } from '../../../src/messages/types.js'
import { v4 as uuidv4 } from 'uuid'

describe('Message Serialization', () => {
  it('should encode and decode a REQUEST message', async () => {
    const message: P2PMessage<RequestPayload> = {
      id: uuidv4(),
      type: MessageType.REQUEST,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        service: 'image-analysis',
        input: { imageUrl: 'https://example.com/image.jpg' },
        meta: { key: 'value' },
      },
    }
    
    const bytes = await encodeMessage(message)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    
    const decoded = await decodeMessage(bytes)
    expect(decoded.id).toBe(message.id)
    expect(decoded.type).toBe(message.type)
    expect(decoded.from).toBe(message.from)
    expect(decoded.to).toBe(message.to)
    expect(decoded.timestamp).toBe(message.timestamp)
    expect(decoded.payload).toEqual(message.payload)
  })
  
  it('should handle REQUEST with channel payment', async () => {
    const message: P2PMessage<RequestPayload> = {
      id: uuidv4(),
      type: MessageType.REQUEST,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        service: 'translate',
        input: { text: 'Hello', targetLang: 'es' },
        payment: {
          type: 'channel',
          channelId: 'channel123',
          amount: 100,
          update: {
            nSequence: 5,
            myBalance: 900,
            peerBalance: 100,
            signature: 'abcd1234',
          },
        },
      },
    }
    
    const bytes = await encodeMessage(message)
    const decoded = await decodeMessage(bytes)
    
    // Debug: log the decoded payload
    console.log('Decoded payload:', JSON.stringify(decoded.payload, null, 2))
    
    expect(decoded.payload).toHaveProperty('payment')
    const payload = decoded.payload as RequestPayload
    expect(payload.payment).toBeDefined()
    expect(payload.payment?.channelId).toBe('channel123')
    expect(payload.payment?.amount).toBe(100)
    expect(payload.payment?.update).toBeDefined()
    expect(payload.payment?.update.nSequence).toBe(5)
  })
  
  it('should serialize and deserialize to JSON', () => {
    const message: P2PMessage = {
      id: uuidv4(),
      type: MessageType.PING,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        timestamp: Date.now(),
      },
    }
    
    const json = serializeToJSON(message)
    expect(json).toContain(message.id)
    
    const deserialized = deserializeFromJSON(json)
    expect(deserialized.id).toBe(message.id)
    expect(deserialized.type).toBe(message.type)
  })
  
  it('should handle signature in envelope', async () => {
    const message: P2PMessage = {
      id: uuidv4(),
      type: MessageType.PING,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        timestamp: Date.now(),
      },
      signature: '0123456789abcdef',
    }
    
    const bytes = await encodeMessage(message)
    const decoded = await decodeMessage(bytes)
    
    expect(decoded.signature).toBe(message.signature)
  })
})
