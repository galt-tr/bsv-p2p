/**
 * Message serialization using protobuf
 */

import { Root, Type } from 'protobufjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { P2PMessage, MessagePayload, MessageType } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load protobuf schema
let protoRoot: Root | null = null

async function loadProto(): Promise<Root> {
  if (protoRoot) return protoRoot
  
  const protoPath = join(__dirname, 'schema.proto')
  protoRoot = await Root.load(protoPath)
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
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase)
  }
  
  if (obj !== null && typeof obj === 'object') {
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
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase)
  }
  
  if (obj !== null && typeof obj === 'object') {
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
 * Encode a P2P message to bytes using protobuf
 */
export async function encodeMessage(message: P2PMessage): Promise<Uint8Array> {
  const root = await loadProto()
  
  // Get the appropriate protobuf message type
  const payloadProtoType = getProtoType(message.type)
  const PayloadType = root.lookupType(`bsvp2p.${payloadProtoType}`)
  
  // Encode the payload first
  const payloadSnake = toSnakeCase(message.payload)
  const payloadBytes = PayloadType.encode(payloadSnake).finish()
  
  // Create envelope
  const Envelope = root.lookupType('bsvp2p.Envelope')
  const envelope = {
    id: message.id,
    type: message.type,
    from: message.from,
    to: message.to,
    timestamp: message.timestamp,
    payload: payloadBytes,
    signature: message.signature ? Buffer.from(message.signature, 'hex') : new Uint8Array(),
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
  const payload = toCamelCase(PayloadType.toObject(payloadDecoded))
  
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
