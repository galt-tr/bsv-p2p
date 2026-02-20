import { describe, it, expect } from 'vitest'
import { validateMessage, validateMessageSize, isQuoteExpired } from '../../../src/messages/validation.js'
import { P2PMessage, MessageType, RequestPayload, QuotePayload } from '../../../src/messages/types.js'
import { v4 as uuidv4 } from 'uuid'

describe('Message Validation', () => {
  it('should validate a valid REQUEST message', () => {
    const message: P2PMessage<RequestPayload> = {
      id: uuidv4(),
      type: MessageType.REQUEST,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        service: 'image-analysis',
        input: { imageUrl: 'https://example.com/image.jpg' },
      },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
  
  it('should reject message with invalid UUID', () => {
    const message: P2PMessage = {
      id: 'not-a-uuid',
      type: MessageType.PING,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: { timestamp: Date.now() },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid message ID (must be UUID v4)')
  })
  
  it('should reject message with old timestamp', () => {
    const message: P2PMessage = {
      id: uuidv4(),
      type: MessageType.PING,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      payload: { timestamp: Date.now() },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('too old'))).toBe(true)
  })
  
  it('should reject message with future timestamp', () => {
    const message: P2PMessage = {
      id: uuidv4(),
      type: MessageType.PING,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now() + 2 * 60 * 1000, // 2 minutes in future
      payload: { timestamp: Date.now() },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('future'))).toBe(true)
  })
  
  it('should validate REQUEST with channel payment', () => {
    const message: P2PMessage<RequestPayload> = {
      id: uuidv4(),
      type: MessageType.REQUEST,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        service: 'translate',
        input: { text: 'Hello' },
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
    
    const result = validateMessage(message)
    expect(result.valid).toBe(true)
  })
  
  it('should reject REQUEST with invalid payment', () => {
    const message: P2PMessage<RequestPayload> = {
      id: uuidv4(),
      type: MessageType.REQUEST,
      from: 'peer1',
      to: 'peer2',
      timestamp: Date.now(),
      payload: {
        service: 'translate',
        input: { text: 'Hello' },
        payment: {
          type: 'channel',
          channelId: 'channel123',
          amount: -100, // Invalid: negative amount
          update: {
            nSequence: 5,
            myBalance: 900,
            peerBalance: 100,
            signature: 'abcd1234',
          },
        },
      },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('positive'))).toBe(true)
  })
  
  it('should validate QUOTE message', () => {
    const message: P2PMessage<QuotePayload> = {
      id: uuidv4(),
      type: MessageType.QUOTE,
      from: 'peer2',
      to: 'peer1',
      timestamp: Date.now(),
      payload: {
        requestId: uuidv4(),
        quoteId: uuidv4(),
        terms: {
          type: 'direct',
          satoshis: 500,
          expiresAt: Date.now() + 60000,
        },
      },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(true)
  })
  
  it('should reject QUOTE with invalid terms', () => {
    const message: P2PMessage<QuotePayload> = {
      id: uuidv4(),
      type: MessageType.QUOTE,
      from: 'peer2',
      to: 'peer1',
      timestamp: Date.now(),
      payload: {
        requestId: uuidv4(),
        quoteId: uuidv4(),
        terms: {
          type: 'invalid' as any,
          satoshis: -100,
          expiresAt: Date.now() + 60000,
        },
      },
    }
    
    const result = validateMessage(message)
    expect(result.valid).toBe(false)
  })
  
  it('should detect expired quotes', () => {
    const expiredTime = Date.now() - 1000
    expect(isQuoteExpired(expiredTime)).toBe(true)
    
    const futureTime = Date.now() + 60000
    expect(isQuoteExpired(futureTime)).toBe(false)
  })
  
  it('should validate message size', () => {
    const smallMessage = new Uint8Array(100)
    const result1 = validateMessageSize(smallMessage, 1024)
    expect(result1.valid).toBe(true)
    
    const largeMessage = new Uint8Array(2000)
    const result2 = validateMessageSize(largeMessage, 1024)
    expect(result2.valid).toBe(false)
    expect(result2.errors.some(e => e.includes('exceeds'))).toBe(true)
  })
})
