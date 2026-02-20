/**
 * Message validation
 */

import { P2PMessage, MessageType, MessagePayload } from './types.js'
import { validate as validateUUID } from 'uuid'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate a P2P message
 */
export function validateMessage(message: P2PMessage): ValidationResult {
  const errors: string[] = []
  
  // Validate envelope
  if (!validateUUID(message.id)) {
    errors.push('Invalid message ID (must be UUID v4)')
  }
  
  if (!Object.values(MessageType).includes(message.type)) {
    errors.push(`Invalid message type: ${message.type}`)
  }
  
  if (!message.from || typeof message.from !== 'string') {
    errors.push('Missing or invalid "from" field')
  }
  
  if (!message.to || typeof message.to !== 'string') {
    errors.push('Missing or invalid "to" field')
  }
  
  if (!message.timestamp || typeof message.timestamp !== 'number') {
    errors.push('Missing or invalid timestamp')
  }
  
  // Check timestamp is not too old or in the future
  const now = Date.now()
  const maxAge = 5 * 60 * 1000  // 5 minutes
  const maxFuture = 30 * 1000   // 30 seconds
  
  if (message.timestamp < now - maxAge) {
    errors.push(`Message too old (timestamp: ${message.timestamp}, now: ${now})`)
  }
  
  if (message.timestamp > now + maxFuture) {
    errors.push(`Message timestamp in future (timestamp: ${message.timestamp}, now: ${now})`)
  }
  
  if (!message.payload || typeof message.payload !== 'object') {
    errors.push('Missing or invalid payload')
  }
  
  // Validate payload based on message type
  if (message.payload) {
    const payloadErrors = validatePayload(message.type, message.payload)
    errors.push(...payloadErrors)
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate message payload based on type
 */
function validatePayload(type: MessageType, payload: MessagePayload): string[] {
  const errors: string[] = []
  
  switch (type) {
    case MessageType.ANNOUNCE:
      validateAnnounce(payload as any, errors)
      break
    
    case MessageType.REQUEST:
      validateRequest(payload as any, errors)
      break
    
    case MessageType.QUOTE:
      validateQuote(payload as any, errors)
      break
    
    case MessageType.PAYMENT:
      validatePayment(payload as any, errors)
      break
    
    case MessageType.RESPONSE:
      validateResponse(payload as any, errors)
      break
    
    case MessageType.REJECT:
      validateReject(payload as any, errors)
      break
    
    case MessageType.CHANNEL_PROPOSE:
      validateChannelPropose(payload as any, errors)
      break
    
    case MessageType.CHANNEL_ACCEPT:
      validateChannelAccept(payload as any, errors)
      break
    
    case MessageType.CHANNEL_REJECT:
      validateChannelReject(payload as any, errors)
      break
    
    case MessageType.CHANNEL_CLOSE:
      validateChannelClose(payload as any, errors)
      break
  }
  
  return errors
}

function validateAnnounce(payload: any, errors: string[]): void {
  if (!payload.peerId) errors.push('Announce missing peerId')
  if (!payload.bsvIdentityKey) errors.push('Announce missing bsvIdentityKey')
  if (!Array.isArray(payload.services)) errors.push('Announce missing or invalid services array')
  if (!Array.isArray(payload.multiaddrs)) errors.push('Announce missing or invalid multiaddrs array')
  if (!payload.timestamp) errors.push('Announce missing timestamp')
}

function validateRequest(payload: any, errors: string[]): void {
  if (!payload.service || typeof payload.service !== 'string') {
    errors.push('Request missing or invalid service')
  }
  
  if (payload.input === undefined) {
    errors.push('Request missing input')
  }
  
  // If payment is provided, validate it
  if (payload.payment) {
    if (payload.payment.type !== 'channel') {
      errors.push('Invalid payment type (must be "channel")')
    }
    if (!payload.payment.channelId) {
      errors.push('Payment missing channelId')
    }
    if (typeof payload.payment.amount !== 'number' || payload.payment.amount <= 0) {
      errors.push('Payment amount must be positive number')
    }
    if (!payload.payment.update) {
      errors.push('Payment missing update')
    } else {
      validateChannelUpdate(payload.payment.update, errors)
    }
  }
}

function validateChannelUpdate(update: any, errors: string[]): void {
  if (typeof update.nSequence !== 'number' || update.nSequence < 0) {
    errors.push('ChannelUpdate nSequence must be non-negative number')
  }
  if (typeof update.myBalance !== 'number' || update.myBalance < 0) {
    errors.push('ChannelUpdate myBalance must be non-negative number')
  }
  if (typeof update.peerBalance !== 'number' || update.peerBalance < 0) {
    errors.push('ChannelUpdate peerBalance must be non-negative number')
  }
  if (!update.signature || typeof update.signature !== 'string') {
    errors.push('ChannelUpdate missing or invalid signature')
  }
}

function validateQuote(payload: any, errors: string[]): void {
  if (!payload.requestId) errors.push('Quote missing requestId')
  if (!payload.quoteId) errors.push('Quote missing quoteId')
  if (!payload.terms) errors.push('Quote missing terms')
  
  if (payload.terms) {
    if (!['direct', 'channel'].includes(payload.terms.type)) {
      errors.push('Quote terms type must be "direct" or "channel"')
    }
    if (typeof payload.terms.satoshis !== 'number' || payload.terms.satoshis <= 0) {
      errors.push('Quote terms satoshis must be positive number')
    }
    if (!payload.terms.expiresAt) {
      errors.push('Quote terms missing expiresAt')
    }
  }
}

function validatePayment(payload: any, errors: string[]): void {
  if (!payload.quoteId) errors.push('Payment missing quoteId')
  if (!payload.beef || typeof payload.beef !== 'string') {
    errors.push('Payment missing or invalid beef')
  }
}

function validateResponse(payload: any, errors: string[]): void {
  if (!payload.requestId) errors.push('Response missing requestId')
  if (typeof payload.success !== 'boolean') errors.push('Response missing or invalid success')
  
  if (!payload.success && !payload.error) {
    errors.push('Response with success=false must include error message')
  }
  
  // If paymentAck is provided, validate it
  if (payload.paymentAck) {
    if (!payload.paymentAck.channelId) {
      errors.push('PaymentAck missing channelId')
    }
    if (typeof payload.paymentAck.nSequence !== 'number') {
      errors.push('PaymentAck missing or invalid nSequence')
    }
    if (!payload.paymentAck.counterSignature) {
      errors.push('PaymentAck missing counterSignature')
    }
  }
}

function validateReject(payload: any, errors: string[]): void {
  if (!payload.requestId) errors.push('Reject missing requestId')
  if (!payload.reason) errors.push('Reject missing reason')
}

function validateChannelPropose(payload: any, errors: string[]): void {
  if (!payload.proposalId) errors.push('ChannelPropose missing proposalId')
  if (typeof payload.capacity !== 'number' || payload.capacity <= 0) {
    errors.push('ChannelPropose capacity must be positive number')
  }
  if (typeof payload.lockTimeHours !== 'number' || payload.lockTimeHours <= 0) {
    errors.push('ChannelPropose lockTimeHours must be positive number')
  }
  if (!payload.myPubKey) errors.push('ChannelPropose missing myPubKey')
}

function validateChannelAccept(payload: any, errors: string[]): void {
  if (!payload.proposalId) errors.push('ChannelAccept missing proposalId')
  if (!payload.myPubKey) errors.push('ChannelAccept missing myPubKey')
  if (!payload.signature) errors.push('ChannelAccept missing signature')
}

function validateChannelReject(payload: any, errors: string[]): void {
  if (!payload.proposalId) errors.push('ChannelReject missing proposalId')
  if (!payload.reason) errors.push('ChannelReject missing reason')
}

function validateChannelClose(payload: any, errors: string[]): void {
  if (!payload.channelId) errors.push('ChannelClose missing channelId')
  if (!['cooperative', 'force'].includes(payload.type)) {
    errors.push('ChannelClose type must be "cooperative" or "force"')
  }
}

/**
 * Validate quote expiration
 */
export function isQuoteExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt
}

/**
 * Validate message size (prevent DoS)
 */
export function validateMessageSize(bytes: Uint8Array, maxSize = 1024 * 1024): ValidationResult {
  const errors: string[] = []
  
  if (bytes.length > maxSize) {
    errors.push(`Message size ${bytes.length} exceeds maximum ${maxSize}`)
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}
