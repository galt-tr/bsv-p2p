import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GatewayClient, createGatewayClientFromEnv } from '../../src/daemon/gateway.js'

describe('GatewayClient', () => {
  describe('configuration', () => {
    it('should default to disabled when no token provided', () => {
      const client = new GatewayClient()
      expect(client.isEnabled).toBe(false)
    })

    it('should be enabled when token is provided', () => {
      const client = new GatewayClient({
        token: 'test-token',
        enabled: true
      })
      expect(client.isEnabled).toBe(true)
    })

    it('should not be enabled if enabled=false even with token', () => {
      const client = new GatewayClient({
        token: 'test-token',
        enabled: false
      })
      expect(client.isEnabled).toBe(false)
    })

    it('should allow reconfiguration', () => {
      const client = new GatewayClient()
      expect(client.isEnabled).toBe(false)
      
      client.configure({ token: 'test-token', enabled: true })
      expect(client.isEnabled).toBe(true)
    })
  })

  describe('wake', () => {
    let client: GatewayClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      global.fetch = mockFetch
      client = new GatewayClient({
        url: 'http://localhost:18789',
        token: 'test-token',
        enabled: true
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should not call fetch when disabled', async () => {
      const disabledClient = new GatewayClient({ enabled: false })
      const result = await disabledClient.wake('test message')
      
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Gateway not enabled')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should call /hooks/wake with correct payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })

      const result = await client.wake('Test wake message', { mode: 'now' })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:18789/hooks/wake',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token'
          },
          body: JSON.stringify({
            text: 'Test wake message',
            mode: 'now'
          })
        })
      )
    })

    it('should default to mode=now', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })

      await client.wake('Test message')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            text: 'Test message',
            mode: 'now'
          })
        })
      )
    })

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      
      // Add error listener to prevent unhandled error exception
      const errorHandler = vi.fn()
      client.on('error', errorHandler)

      const result = await client.wake('Test message')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Network error')
      expect(errorHandler).toHaveBeenCalled()
    })

    it('should handle non-ok responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      })
      
      // Add error listener to prevent unhandled error exception
      client.on('error', () => {})

      const result = await client.wake('Test message')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })

    it('should emit events on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })

      const wakeHandler = vi.fn()
      client.on('wake', wakeHandler)

      await client.wake('Test message', { mode: 'next-heartbeat' })

      expect(wakeHandler).toHaveBeenCalledWith({
        text: 'Test message',
        mode: 'next-heartbeat'
      })
    })

    it('should emit error events on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error')
      })

      const errorHandler = vi.fn()
      client.on('error', errorHandler)

      await client.wake('Test message')

      expect(errorHandler).toHaveBeenCalledWith({
        type: 'wake',
        status: 500,
        error: 'Server error'
      })
    })
  })

  describe('runAgent', () => {
    let client: GatewayClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      global.fetch = mockFetch
      client = new GatewayClient({
        url: 'http://localhost:18789',
        token: 'test-token',
        enabled: true
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should call /hooks/agent with message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })

      const result = await client.runAgent('Process this P2P request', {
        name: 'P2P',
        deliver: true
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:18789/hooks/agent',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token'
          }
        })
      )

      // Verify the body was sent correctly
      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.message).toBe('Process this P2P request')
      expect(body.name).toBe('P2P')
      expect(body.deliver).toBe(true)
      expect(body.wakeMode).toBe('now')
    })

    it('should strip undefined options from payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })

      await client.runAgent('Test')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      
      // Should not have undefined keys
      expect(Object.keys(body)).toEqual(['message', 'wakeMode', 'deliver'])
    })
  })

  describe('formatP2PMessage', () => {
    it('should format message with peer and type', () => {
      const result = GatewayClient.formatP2PMessage(
        '12D3KooWGUN2tiLR6JV1584AeuE9MkLhfoJpuiEmAu5HiNRuas7n',
        'channel_open',
        { capacity: 1000, lockTime: 3600 }
      )

      expect(result).toContain('12D3KooWGUN2tiL')
      expect(result).toContain('channel_open')
      expect(result).toContain('1000')
    })
  })

  describe('createGatewayClientFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should create disabled client when no token in env', () => {
      delete process.env.OPENCLAW_HOOKS_TOKEN
      const client = createGatewayClientFromEnv()
      expect(client.isEnabled).toBe(false)
    })

    it('should create enabled client when token is in env', () => {
      process.env.OPENCLAW_HOOKS_TOKEN = 'env-token'
      const client = createGatewayClientFromEnv()
      expect(client.isEnabled).toBe(true)
    })

    it('should use custom URL from env', () => {
      process.env.OPENCLAW_HOOKS_TOKEN = 'env-token'
      process.env.OPENCLAW_GATEWAY_URL = 'http://custom:9999'
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK')
      })
      global.fetch = mockFetch

      const client = createGatewayClientFromEnv()
      client.wake('test')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:9999/hooks/wake',
        expect.any(Object)
      )
    })
  })
})
