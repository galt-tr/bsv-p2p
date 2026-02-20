/**
 * Message serialization using protobuf
 */

import protobuf from 'protobufjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { P2PMessage, MessagePayload, MessageType } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load protobuf schema
let protoRoot: protobuf.Root | null = null

async function loadProto(): Promise<protobuf.Root> {
  if (protoRoot) return protoRoot
  
  const protoPath = join(__dirname, 'schema.proto')
  protoRoot = await protobuf.load(protoPath)
  return protoRoot
}

/**
 * Get protobuf message type for a given message type
 */
function getProtoType(type: MessageType): string {
  const typeMap: Record<MessageType, string> = {
    [MessageType.ANNOUNCE]: 'Announce',
    [MessageType.DISCOVER]: 'Discover',
    [MessageType.REQUEST]: 'Request',
    [MessageType.QUOTE]: 'Quote',
    [MessageType.ACCEPT]: 'Accept',
    [MessageType.PAYMENT]: 'Payment',
    [MessageType.RESPONSE]: 'Response',
    [MessageType.REJECT]: 'Reject',
    [MessageType.PING]: 'Ping',
    [MessageType.PONG]: 'Pong',
    [MessageType.ERROR]: 'Error',
    [MessageType.CHANNEL_PROPOSE]: 'ChannelPropose',
    [MessageType.CHANNEL_ACCEPT]: 'ChannelAccept',
    [MessageType.CHANNEL_REJECT]: 'ChannelReject',
    [MessageType.CHANNEL_CLOSE]: 'ChannelClose',
  }
  
  return typeMap[type]
}

/**
 * Convert TypeScript camelCase to protobuf snake_case
 */
function toSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }
  
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
    return obj
  }
  
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase)
  }
  
  if (typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      result[snakeKey] = toSnakeCase(obj[key])
    }
    return result
  }
  
  return obj
}

/**
 * Convert protobuf snake_case to TypeScript camelCase
 */
function toCamelCase(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }
  
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
    return obj
  }
  
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase)
  }
  
  if (typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
      result[camelKey] = toCamelCase(obj[key])
    }
    return result
  }
  
  return obj
}

/**
 * Prepare payload for protobuf encoding
 * Note: protobuf.js expects camelCase field names and handles snake_case conversion internally
 */
function preparePayload(type: MessageType, payload: any): any {
  const prepared = { ...payload }
  
  // Handle special cases that need JSON encoding to bytes
  if (type === MessageType.REQUEST && prepared.input !== undefined) {
    prepared.input = Buffer.from(JSON.stringify(payload.input))
  }
  
  if (type === MessageType.RESPONSE && prepared.result !== undefined) {
    prepared.result = Buffer.from(JSON.stringify(payload.result))
  }
  
  if (type === MessageType.ERROR && prepared.details !== undefined) {
    prepared.details = Buffer.from(JSON.stringify(payload.details))
  }
  
  return prepared
}

/**
 * Process decoded payload
 * Note: protobuf.js toObject() already returns camelCase, no conversion needed
 */
function processPayload(type: MessageType, payload: any): any {
  // Decode JSON-encoded fields from bytes
  if (type === MessageType.REQUEST && payload.input instanceof Uint8Array) {
    payload.input = JSON.parse(Buffer.from(payload.input).toString('utf8'))
  }
  
  if (type === MessageType.RESPONSE && payload.result instanceof Uint8Array) {
    payload.result = JSON.parse(Buffer.from(payload.result).toString('utf8'))
  }
  
  if (type === MessageType.ERROR && payload.details instanceof Uint8Array) {
    payload.details = JSON.parse(Buffer.from(payload.details).toString('utf8'))
  }
  
  return payload
}

/**
 * Encode a P2P message to bytes using protobuf
 */
export async function encodeMessage(message: P2PMessage): Promise<Uint8Array> {
  const root = await loadProto()
  
  // Get the appropriate protobuf message type
  const payloadProtoType = getProtoType(message.type)
  const PayloadType = root.lookupType(`bsvp2p.${payloadProtoType}`)
  
  // Prepare and encode the payload
  const payloadPrepared = preparePayload(message.type, message.payload)
  
  // Debug: log prepared payload
  if (process.env.DEBUG_PROTO) {
    console.log('Prepared payload:', JSON.stringify(payloadPrepared, null, 2))
  }
  
  // Verify and create the message (ensures nested messages are properly created)
  const errMsg = PayloadType.verify(payloadPrepared)
  if (errMsg) {
    throw new Error(`Payload verification failed: ${errMsg}`)
  }
  
  const payloadMessage = PayloadType.create(payloadPrepared)
  const payloadBytes = PayloadType.encode(payloadMessage).finish()
  
  // Create envelope
  const Envelope = root.lookupType('bsvp2p.Envelope')
  const envelope: any = {
    id: message.id,
    type: message.type,
    from: message.from,
    to: message.to,
    timestamp: message.timestamp,
    payload: payloadBytes,
  }
  
  // Only add signature if present
  if (message.signature) {
    envelope.signature = Buffer.from(message.signature, 'hex')
  }
  
  return Envelope.encode(envelope).finish()
}

/**
 * Decode bytes to a P2P message using protobuf
 */
export async function decodeMessage(bytes: Uint8Array): Promise<P2PMessage> {
  const root = await loadProto()
  
  // Decode envelope
  const Envelope = root.lookupType('bsvp2p.Envelope')
  const envelope = Envelope.decode(bytes) as any
  
  // Decode payload based on type
  const payloadProtoType = getProtoType(envelope.type as MessageType)
  const PayloadType = root.lookupType(`bsvp2p.${payloadProtoType}`)
  const payloadDecoded = PayloadType.decode(envelope.payload)
  const payloadObject = PayloadType.toObject(payloadDecoded, {
    bytes: Buffer,
    longs: Number,
    enums: String,
    defaults: false,  // Only include fields that were actually set
  })
  const payload = processPayload(envelope.type, payloadObject)
  
  return {
    id: envelope.id,
    type: envelope.type as MessageType,
    from: envelope.from,
    to: envelope.to,
    timestamp: Number(envelope.timestamp),
    payload: payload as MessagePayload,
    signature: envelope.signature?.length > 0 
      ? Buffer.from(envelope.signature).toString('hex')
      : undefined,
  }
}

/**
 * Serialize a message to JSON (for debugging/logging)
 */
export function serializeToJSON(message: P2PMessage): string {
  return JSON.stringify(message, null, 2)
}

/**
 * Deserialize a message from JSON
 */
export function deserializeFromJSON(json: string): P2PMessage {
  return JSON.parse(json) as P2PMessage
}
