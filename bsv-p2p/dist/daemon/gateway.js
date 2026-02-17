/**
 * Gateway Webhook Client
 *
 * Handles communication with OpenClaw gateway to wake the agent
 * when P2P messages arrive.
 */
import { EventEmitter } from 'events';
export class GatewayClient extends EventEmitter {
    config;
    constructor(config = {}) {
        super();
        this.config = {
            url: config.url ?? 'http://127.0.0.1:18789',
            token: config.token ?? '',
            enabled: config.enabled ?? false
        };
    }
    get isEnabled() {
        return this.config.enabled && this.config.token.length > 0;
    }
    /**
     * Configure the gateway client
     */
    configure(config) {
        if (config.url !== undefined)
            this.config.url = config.url;
        if (config.token !== undefined)
            this.config.token = config.token;
        if (config.enabled !== undefined)
            this.config.enabled = config.enabled;
    }
    /**
     * Wake the agent with a system event (main session)
     */
    async wake(text, options = {}) {
        if (!this.isEnabled) {
            console.log('[Gateway] Not enabled, skipping wake');
            return { ok: false, error: 'Gateway not enabled' };
        }
        const endpoint = `${this.config.url}/hooks/wake`;
        const payload = {
            text,
            mode: options.mode ?? 'now'
        };
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const error = await response.text();
                console.error(`[Gateway] Wake failed: ${response.status} - ${error}`);
                this.emit('error', { type: 'wake', status: response.status, error });
                return { ok: false, error };
            }
            console.log(`[Gateway] Wake successful: "${text.substring(0, 50)}..."`);
            this.emit('wake', { text, mode: options.mode ?? 'now' });
            return { ok: true };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error(`[Gateway] Wake error: ${error}`);
            this.emit('error', { type: 'wake', error });
            return { ok: false, error };
        }
    }
    /**
     * Run an isolated agent turn (separate session)
     */
    async runAgent(message, options = {}) {
        if (!this.isEnabled) {
            console.log('[Gateway] Not enabled, skipping agent run');
            return { ok: false, error: 'Gateway not enabled' };
        }
        const endpoint = `${this.config.url}/hooks/agent`;
        const payload = {
            message,
            name: options.name,
            sessionKey: options.sessionKey,
            wakeMode: options.wakeMode ?? 'now',
            deliver: options.deliver ?? true,
            model: options.model,
            thinking: options.thinking,
            timeoutSeconds: options.timeoutSeconds
        };
        // Remove undefined fields
        const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([_, v]) => v !== undefined));
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                },
                body: JSON.stringify(cleanPayload)
            });
            if (!response.ok) {
                const error = await response.text();
                console.error(`[Gateway] Agent run failed: ${response.status} - ${error}`);
                this.emit('error', { type: 'agent', status: response.status, error });
                return { ok: false, error };
            }
            console.log(`[Gateway] Agent run started: "${message.substring(0, 50)}..."`);
            this.emit('agent', { message, options });
            return { ok: true };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error(`[Gateway] Agent run error: ${error}`);
            this.emit('error', { type: 'agent', error });
            return { ok: false, error };
        }
    }
    /**
     * Format a P2P message for waking the agent
     */
    static formatP2PMessage(peerId, messageType, data) {
        const preview = JSON.stringify(data).substring(0, 200);
        return `[P2P] Message from ${peerId.substring(0, 16)}...: ${messageType}\n${preview}`;
    }
}
/**
 * Create a gateway client from environment variables
 */
export function createGatewayClientFromEnv() {
    return new GatewayClient({
        url: process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789',
        token: process.env.OPENCLAW_HOOKS_TOKEN ?? '',
        enabled: !!process.env.OPENCLAW_HOOKS_TOKEN
    });
}
