/**
 * Gateway Webhook Client
 *
 * Handles communication with OpenClaw gateway to wake the agent
 * when P2P messages arrive.
 */
import { EventEmitter } from 'events';
export interface GatewayConfig {
    /** Gateway URL (default: http://127.0.0.1:18789) */
    url?: string;
    /** Hook token for authentication */
    token?: string;
    /** Whether to enable gateway integration */
    enabled?: boolean;
}
export interface WakeOptions {
    /** Wake mode: 'now' triggers immediate heartbeat, 'next-heartbeat' waits */
    mode?: 'now' | 'next-heartbeat';
}
export interface AgentRunOptions {
    /** Human-readable name for the hook (shown in session summaries) */
    name?: string;
    /** Session key override */
    sessionKey?: string;
    /** Wake mode */
    wakeMode?: 'now' | 'next-heartbeat';
    /** Whether to deliver response to messaging channel */
    deliver?: boolean;
    /** Model override */
    model?: string;
    /** Thinking level */
    thinking?: string;
    /** Timeout in seconds */
    timeoutSeconds?: number;
}
export interface GatewayResponse {
    ok: boolean;
    error?: string;
}
export declare class GatewayClient extends EventEmitter {
    private config;
    constructor(config?: GatewayConfig);
    get isEnabled(): boolean;
    /**
     * Configure the gateway client
     */
    configure(config: Partial<GatewayConfig>): void;
    /**
     * Wake the agent with a system event (main session)
     */
    wake(text: string, options?: WakeOptions): Promise<GatewayResponse>;
    /**
     * Run an isolated agent turn (separate session)
     */
    runAgent(message: string, options?: AgentRunOptions): Promise<GatewayResponse>;
    /**
     * Format a P2P message for waking the agent
     */
    static formatP2PMessage(peerId: string, messageType: string, data: Record<string, unknown>): string;
}
/**
 * Create a gateway client from environment variables
 */
export declare function createGatewayClientFromEnv(): GatewayClient;
