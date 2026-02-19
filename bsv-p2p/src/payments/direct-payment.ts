/**
 * Direct Payment Handler (BRC-105 Fallback)
 * 
 * Handles the Quote->Payment->Response flow for peers without payment channels.
 * Uses BEEF (Background Evaluation Extended Format) transactions for direct on-chain payments.
 * 
 * Flow:
 * 1. Requester sends REQUEST for a service
 * 2. Provider responds with QUOTE (pricing and payment destination)
 * 3. Requester sends ACCEPT to proceed
 * 4. Requester sends PAYMENT with BEEF transaction
 * 5. Provider validates payment and sends RESPONSE with service result
 */

import { EventEmitter } from 'events'
import { v4 as uuid } from 'uuid'
import {
  P2PMessage,
  MessageType,
  RequestPayload,
  QuotePayload,
  AcceptPayload,
  PaymentPayload,
  ResponsePayload,
  PaymentTerms,
  PaymentDestination
} from '../messages/types.js'

export interface DirectPaymentConfig {
  /** How long quotes are valid (milliseconds) */
  quoteValidityMs: number
  /** Minimum payment amount (satoshis) */
  minPaymentSats: number
  /** Maximum payment amount (satoshis) */
  maxPaymentSats: number
  /** Default BSV address for payments (if not using identity key) */
  defaultPaymentAddress?: string
  /** BSV identity key for BRC-29 derivation */
  bsvIdentityKey?: string
}

export const DEFAULT_DIRECT_PAYMENT_CONFIG: DirectPaymentConfig = {
  quoteValidityMs: 5 * 60 * 1000,    // 5 minutes
  minPaymentSats: 1,                  // 1 satoshi minimum
  maxPaymentSats: 1000000,            // 1M sats maximum (~$500 at $50k/BTC)
}

export interface Quote {
  id: string
  requestId: string
  service: string
  params: any
  terms: PaymentTerms
  createdAt: number
  expiresAt: number
  status: 'pending' | 'accepted' | 'paid' | 'expired' | 'rejected'
}

export interface PaymentRecord {
  id: string
  quoteId: string
  beef: string
  txid?: string
  amount: number
  receivedAt: number
  verified: boolean
}

/**
 * Service pricing function
 * Returns the price in satoshis for a given service request
 */
export type PricingFunction = (service: string, params: any) => Promise<number> | number

/**
 * Service handler function
 * Processes the service request after payment is verified
 */
export type ServiceHandler = (service: string, params: any) => Promise<any>

/**
 * BEEF verification function
 * Verifies a BEEF transaction (SPV proof + transaction)
 */
export type BeefVerifier = (beef: string, expectedAmount: number, payTo: PaymentDestination) => Promise<{
  valid: boolean
  txid?: string
  amount?: number
  error?: string
}>

export class DirectPaymentHandler extends EventEmitter {
  private config: DirectPaymentConfig
  private quotes: Map<string, Quote> = new Map()
  private payments: Map<string, PaymentRecord> = new Map()
  private pricingFn?: PricingFunction
  private serviceHandler?: ServiceHandler
  private beefVerifier?: BeefVerifier

  constructor(config: Partial<DirectPaymentConfig> = {}) {
    super()
    this.config = {
      ...DEFAULT_DIRECT_PAYMENT_CONFIG,
      ...config
    }

    // Start cleanup timer for expired quotes
    setInterval(() => this.cleanupExpiredQuotes(), 60 * 1000)
  }

  /**
   * Set the pricing function
   */
  setPricingFunction(fn: PricingFunction): void {
    this.pricingFn = fn
  }

  /**
   * Set the service handler
   */
  setServiceHandler(fn: ServiceHandler): void {
    this.serviceHandler = fn
  }

  /**
   * Set the BEEF verifier
   */
  setBeefVerifier(fn: BeefVerifier): void {
    this.beefVerifier = fn
  }

  /**
   * Handle incoming REQUEST - create and return a QUOTE
   */
  async handleRequest(request: P2PMessage<RequestPayload>): Promise<P2PMessage<QuotePayload>> {
    if (!this.pricingFn) {
      throw new Error('Pricing function not configured')
    }

    const payload = request.payload
    const price = await this.pricingFn(payload.service, payload.input)

    if (price < this.config.minPaymentSats || price > this.config.maxPaymentSats) {
      throw new Error(`Price ${price} sats outside acceptable range`)
    }

    const now = Date.now()
    const quoteId = uuid()
    const expiresAt = now + this.config.quoteValidityMs

    // Determine payment destination
    const payTo: PaymentDestination = {}
    if (this.config.bsvIdentityKey) {
      payTo.identityKey = this.config.bsvIdentityKey
      payTo.derivationPrefix = `payment-${quoteId}` // BRC-29 derivation
    } else if (this.config.defaultPaymentAddress) {
      payTo.address = this.config.defaultPaymentAddress
    } else {
      throw new Error('No payment destination configured')
    }

    const terms: PaymentTerms = {
      type: 'direct',
      satoshis: price,
      currency: 'bsv',
      payTo,
      expiresAt
    }

    const quote: Quote = {
      id: quoteId,
      requestId: request.id,
      service: payload.service,
      params: payload.input,
      terms,
      createdAt: now,
      expiresAt,
      status: 'pending'
    }

    this.quotes.set(quoteId, quote)
    this.emit('quote_created', quote)

    const quotePayload: QuotePayload = {
      requestId: request.id,
      quoteId,
      terms
    }

    return {
      id: uuid(),
      type: MessageType.QUOTE,
      from: request.to,
      to: request.from,
      timestamp: now,
      payload: quotePayload
    }
  }

  /**
   * Handle ACCEPT message - mark quote as accepted
   */
  handleAccept(accept: P2PMessage<AcceptPayload>): void {
    const quote = this.quotes.get(accept.payload.quoteId)
    
    if (!quote) {
      throw new Error(`Quote not found: ${accept.payload.quoteId}`)
    }

    if (quote.status !== 'pending') {
      throw new Error(`Quote already ${quote.status}`)
    }

    if (Date.now() > quote.expiresAt) {
      quote.status = 'expired'
      throw new Error('Quote has expired')
    }

    quote.status = 'accepted'
    this.emit('quote_accepted', quote)
  }

  /**
   * Handle PAYMENT message - verify BEEF and process service
   */
  async handlePayment(payment: P2PMessage<PaymentPayload>): Promise<P2PMessage<ResponsePayload>> {
    const quote = this.quotes.get(payment.payload.quoteId)
    
    if (!quote) {
      throw new Error(`Quote not found: ${payment.payload.quoteId}`)
    }

    if (quote.status !== 'accepted') {
      throw new Error(`Quote must be accepted first (current status: ${quote.status})`)
    }

    if (Date.now() > quote.expiresAt) {
      quote.status = 'expired'
      throw new Error('Quote has expired')
    }

    // Verify BEEF transaction
    if (!this.beefVerifier) {
      throw new Error('BEEF verifier not configured')
    }

    const verification = await this.beefVerifier(
      payment.payload.beef,
      quote.terms.satoshis,
      quote.terms.payTo!
    )

    if (!verification.valid) {
      throw new Error(`Payment verification failed: ${verification.error}`)
    }

    // Record the payment
    const paymentRecord: PaymentRecord = {
      id: uuid(),
      quoteId: quote.id,
      beef: payment.payload.beef,
      txid: verification.txid,
      amount: verification.amount!,
      receivedAt: Date.now(),
      verified: true
    }

    this.payments.set(paymentRecord.id, paymentRecord)
    quote.status = 'paid'
    this.emit('payment_received', { quote, payment: paymentRecord })

    // Process the service request
    if (!this.serviceHandler) {
      throw new Error('Service handler not configured')
    }

    let serviceResult: any
    let success = true
    let error: string | undefined

    try {
      serviceResult = await this.serviceHandler(quote.service, quote.params)
    } catch (err: any) {
      success = false
      error = err.message
    }

    const responsePayload: ResponsePayload = {
      requestId: quote.requestId,
      result: serviceResult,
      success,
      error
    }

    return {
      id: uuid(),
      type: MessageType.RESPONSE,
      from: payment.to,
      to: payment.from,
      timestamp: Date.now(),
      payload: responsePayload
    }
  }

  /**
   * Clean up expired quotes
   */
  private cleanupExpiredQuotes(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [id, quote] of this.quotes.entries()) {
      if (quote.expiresAt < now && quote.status === 'pending') {
        quote.status = 'expired'
        this.quotes.delete(id)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`[DirectPayment] Cleaned up ${cleaned} expired quotes`)
    }
  }

  /**
   * Get all quotes
   */
  getQuotes(): Quote[] {
    return Array.from(this.quotes.values())
  }

  /**
   * Get a specific quote
   */
  getQuote(quoteId: string): Quote | undefined {
    return this.quotes.get(quoteId)
  }

  /**
   * Get all payments
   */
  getPayments(): PaymentRecord[] {
    return Array.from(this.payments.values())
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalQuotes: number
    pendingQuotes: number
    acceptedQuotes: number
    paidQuotes: number
    expiredQuotes: number
    totalPayments: number
  } {
    const quotes = this.getQuotes()
    return {
      totalQuotes: quotes.length,
      pendingQuotes: quotes.filter(q => q.status === 'pending').length,
      acceptedQuotes: quotes.filter(q => q.status === 'accepted').length,
      paidQuotes: quotes.filter(q => q.status === 'paid').length,
      expiredQuotes: quotes.filter(q => q.status === 'expired').length,
      totalPayments: this.payments.size
    }
  }
}
