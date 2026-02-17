/**
 * Payment Channel Protocol Messages
 *
 * Defines the wire protocol for payment channel operations over libp2p.
 */
import { PublicKey, Hash } from '@bsv/sdk';
/**
 * Protocol identifier for payment channel streams
 */
export const CHANNEL_PROTOCOL = '/openclaw/channel/1.0.0';
/**
 * Message types for the payment channel protocol
 */
export var ChannelMessageType;
(function (ChannelMessageType) {
    // Channel lifecycle
    ChannelMessageType["OPEN_REQUEST"] = "open_request";
    ChannelMessageType["OPEN_ACCEPT"] = "open_accept";
    ChannelMessageType["OPEN_REJECT"] = "open_reject";
    ChannelMessageType["FUNDING_CREATED"] = "funding_created";
    ChannelMessageType["FUNDING_SIGNED"] = "funding_signed";
    ChannelMessageType["CHANNEL_READY"] = "channel_ready";
    // Payments
    ChannelMessageType["UPDATE_REQUEST"] = "update_request";
    ChannelMessageType["UPDATE_ACK"] = "update_ack";
    ChannelMessageType["UPDATE_REJECT"] = "update_reject";
    // Close
    ChannelMessageType["CLOSE_REQUEST"] = "close_request";
    ChannelMessageType["CLOSE_ACCEPT"] = "close_accept";
    ChannelMessageType["CLOSE_COMPLETE"] = "close_complete";
    // Errors
    ChannelMessageType["ERROR"] = "error";
})(ChannelMessageType || (ChannelMessageType = {}));
/**
 * Serialize a message to JSON bytes
 */
export function serializeMessage(message) {
    return new TextEncoder().encode(JSON.stringify(message));
}
/**
 * Deserialize a message from JSON bytes
 */
export function deserializeMessage(data) {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json);
}
/**
 * Sign a message with a private key
 */
export function signMessage(message, privateKey) {
    // Create a copy without the signature field
    const { signature: _, ...messageWithoutSig } = message;
    const messageBytes = new TextEncoder().encode(JSON.stringify(messageWithoutSig));
    const hash = Hash.sha256(messageBytes);
    const sig = privateKey.sign(hash);
    return sig.toDER().toString('hex');
}
/**
 * Verify a message signature
 */
export function verifyMessageSignature(message, publicKey) {
    if (!message.signature)
        return false;
    try {
        const { signature, ...messageWithoutSig } = message;
        const messageBytes = new TextEncoder().encode(JSON.stringify(messageWithoutSig));
        const hash = Hash.sha256(messageBytes);
        const pubKey = PublicKey.fromString(publicKey);
        const sig = Buffer.from(signature, 'hex');
        // Import signature from DER
        const { Signature } = require('@bsv/sdk');
        const sigObj = Signature.fromDER(sig);
        return pubKey.verify(hash, sigObj);
    }
    catch {
        return false;
    }
}
