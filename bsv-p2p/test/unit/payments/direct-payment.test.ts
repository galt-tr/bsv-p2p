import { describe, it, expect, beforeEach } from 'vitest'
import { DirectPaymentHandler, Quote, PaymentRecord } from '../../../src/payments/direct-payment.js'
import { P2PMessage, MessageType, RequestPayload, PaymentPayload } from '../../../src/messages/types.js'
import { v4 as uuid } from 'uuid'

describe('Direct Payment Handler', () => {
  let handler: DirectPaymentHandler

  beforeEach(() => {
    handler = new DirectPaymentHandler({
      quoteValidityMs: 1000, // 1 second for testing
      defaultPaymentAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    })
  })

  describe('Configuration', () => {
    it('should create handler with default config', () => {
      const h = new DirectPaymentHandler()
      expect(h).toBeDefined()
    })

    it('should accept custom config', () => {
      const h = new DirectPaymentHandler({
        quoteValidityMs: 60000,
        minPaymentSats: 10,
        maxPaymentSats: 5000
      })
      expect(h).toBeDefined()
    })

    it('should allow setting pricing function', () => {
      handler.setPricingFunction((service, params) => 100)
      expect(() => handler.setPricingFunction(() => 200)).not.toThrow()
    })

    it('should allow setting service handler', () => {
      handler.setServiceHandler(async (service, params) => ({ result: 'ok' }))
      expect(() => handler.setServiceHandler(async () => ({}))).not.toThrow()
    })

    it('should allow setting BEEF verifier', () => {
      handler.setBeefVerifier(async (beef, amount, payTo) => ({ valid: true }))
      expect(() => handler.setBeefVerifier(async () => ({ valid: false }))).not.toThrow()
    })
  })

  describe('Quote Creation', () => {
    beforeEach(() => {
      handler.setPricingFunction((service) => {
        if (service === 'poem') return 100
        if (service === 'image') return 500
        return 50
      })
    })

    it('should create a quote from a request', async () => {
      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'poem',
          input: { topic: 'love' }
        }
      }

      const quote = await handler.handleRequest(request)

      expect(quote.type).toBe(MessageType.QUOTE)
      expect(quote.payload.terms.satoshis).toBe(100)
      expect(quote.payload.terms.type).toBe('direct')
      expect(quote.payload.terms.payTo).toBeDefined()
    })

    it('should use pricing function to determine price', async () => {
      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'image',
          input: { prompt: 'sunset' }
        }
      }

      const quote = await handler.handleRequest(request)
      expect(quote.payload.terms.satoshis).toBe(500)
    })

    it('should set expiration time', async () => {
      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'poem',
          input: {}
        }
      }

      const quote = await handler.handleRequest(request)
      const now = Date.now()
      
      expect(quote.payload.terms.expiresAt).toBeGreaterThan(now)
      expect(quote.payload.terms.expiresAt).toBeLessThan(now + 2000)
    })

    it('should throw error if pricing function not set', async () => {
      const h = new DirectPaymentHandler()
      
      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'poem',
          input: {}
        }
      }

      await expect(h.handleRequest(request)).rejects.toThrow('Pricing function not configured')
    })

    it('should emit quote_created event', async () => {
      let emittedQuote: Quote | null = null
      handler.on('quote_created', (quote) => {
        emittedQuote = quote
      })

      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'poem',
          input: {}
        }
      }

      await handler.handleRequest(request)
      
      expect(emittedQuote).not.toBeNull()
      expect(emittedQuote?.service).toBe('poem')
    })
  })

  describe('Quote Acceptance', () => {
    let quoteId: string

    beforeEach(async () => {
      handler.setPricingFunction(() => 100)
      
      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'test',
          input: {}
        }
      }

      const quote = await handler.handleRequest(request)
      quoteId = quote.payload.quoteId
    })

    it('should accept a valid quote', () => {
      const accept: P2PMessage = {
        id: uuid(),
        type: MessageType.ACCEPT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: { quoteId }
      }

      expect(() => handler.handleAccept(accept)).not.toThrow()
      
      const quote = handler.getQuote(quoteId)
      expect(quote?.status).toBe('accepted')
    })

    it('should throw error for non-existent quote', () => {
      const accept: P2PMessage = {
        id: uuid(),
        type: MessageType.ACCEPT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: { quoteId: 'non-existent' }
      }

      expect(() => handler.handleAccept(accept)).toThrow('Quote not found')
    })

    it('should throw error for expired quote', async () => {
      // Wait for quote to expire
      await new Promise(resolve => setTimeout(resolve, 1100))

      const accept: P2PMessage = {
        id: uuid(),
        type: MessageType.ACCEPT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: { quoteId }
      }

      expect(() => handler.handleAccept(accept)).toThrow('expired')
    })

    it('should emit quote_accepted event', () => {
      let emittedQuote: Quote | null = null
      handler.on('quote_accepted', (quote) => {
        emittedQuote = quote
      })

      const accept: P2PMessage = {
        id: uuid(),
        type: MessageType.ACCEPT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: { quoteId }
      }

      handler.handleAccept(accept)
      expect(emittedQuote).not.toBeNull()
    })
  })

  describe('Payment Processing', () => {
    let quoteId: string

    beforeEach(async () => {
      handler.setPricingFunction(() => 100)
      handler.setServiceHandler(async (service, params) => {
        return { poem: 'Roses are red...' }
      })
      handler.setBeefVerifier(async (beef, amount, payTo) => {
        return { valid: true, txid: 'mock-txid', amount }
      })

      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'poem',
          input: { topic: 'love' }
        }
      }

      const quote = await handler.handleRequest(request)
      quoteId = quote.payload.quoteId

      // Accept the quote
      handler.handleAccept({
        id: uuid(),
        type: MessageType.ACCEPT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: { quoteId }
      })
    })

    it('should process payment and return response', async () => {
      const payment: P2PMessage<PaymentPayload> = {
        id: uuid(),
        type: MessageType.PAYMENT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          quoteId,
          beef: 'mock-beef-data'
        }
      }

      const response = await handler.handlePayment(payment)

      expect(response.type).toBe(MessageType.RESPONSE)
      expect(response.payload.success).toBe(true)
      expect(response.payload.result).toBeDefined()
    })

    it('should verify BEEF transaction', async () => {
      let verifiedBeef = ''
      handler.setBeefVerifier(async (beef, amount, payTo) => {
        verifiedBeef = beef
        return { valid: true, txid: 'mock-txid', amount }
      })

      const payment: P2PMessage<PaymentPayload> = {
        id: uuid(),
        type: MessageType.PAYMENT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          quoteId,
          beef: 'test-beef-data'
        }
      }

      await handler.handlePayment(payment)
      expect(verifiedBeef).toBe('test-beef-data')
    })

    it('should reject invalid payment', async () => {
      handler.setBeefVerifier(async (beef, amount, payTo) => {
        return { valid: false, error: 'Invalid SPV proof' }
      })

      const payment: P2PMessage<PaymentPayload> = {
        id: uuid(),
        type: MessageType.PAYMENT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          quoteId,
          beef: 'invalid-beef'
        }
      }

      await expect(handler.handlePayment(payment)).rejects.toThrow('Payment verification failed')
    })

    it('should emit payment_received event', async () => {
      let emittedPayment: any = null
      handler.on('payment_received', (data) => {
        emittedPayment = data
      })

      const payment: P2PMessage<PaymentPayload> = {
        id: uuid(),
        type: MessageType.PAYMENT,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          quoteId,
          beef: 'mock-beef'
        }
      }

      await handler.handlePayment(payment)
      expect(emittedPayment).not.toBeNull()
      expect(emittedPayment.quote).toBeDefined()
      expect(emittedPayment.payment).toBeDefined()
    })
  })

  describe('Statistics', () => {
    it('should return stats', () => {
      const stats = handler.getStats()
      expect(stats.totalQuotes).toBe(0)
      expect(stats.pendingQuotes).toBe(0)
      expect(stats.totalPayments).toBe(0)
    })

    it('should track quote counts', async () => {
      handler.setPricingFunction(() => 100)

      const request: P2PMessage<RequestPayload> = {
        id: uuid(),
        type: MessageType.REQUEST,
        from: 'peer1',
        to: 'peer2',
        timestamp: Date.now(),
        payload: {
          service: 'test',
          input: {}
        }
      }

      await handler.handleRequest(request)

      const stats = handler.getStats()
      expect(stats.totalQuotes).toBe(1)
      expect(stats.pendingQuotes).toBe(1)
    })
  })
})
