/**
 * Plugin Integration Test: Tool Registration and Interface Validation
 * 
 * This test verifies that the BSV P2P plugin correctly registers all tools
 * with proper interfaces. It does NOT test actual P2P communication, which
 * requires real network setup and is better suited for manual testing.
 * 
 * For full E2E testing with real P2P communication and payment channels,
 * see docs/MANUAL-E2E-TEST.md
 * 
 * Test Coverage:
 * 1. Plugin registers successfully
 * 2. All 5 tools are registered with correct names
 * 3. Tools have proper parameter schemas
 * 4. Tools can be invoked (even if P2P node is offline)
 * 5. Tools return proper response format
 */

import { describe, it, expect, beforeAll } from 'vitest'

// Import plugin
import registerPlugin from '../../extensions/bsv-p2p/index.js'

describe('Plugin Integration: Tool Registration', () => {
  // Mock plugin API
  const createMockAPI = () => {
    const tools: Map<string, any> = new Map()
    const services: Map<string, any> = new Map()
    
    return {
      logger: {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {}
      },
      config: {
        plugins: {
          entries: {
            'bsv-p2p': {
              enabled: true,
              config: {
                walletPath: ':memory:', // In-memory for tests
                port: null // Don't listen (would conflict with daemon)
              }
            }
          }
        }
      },
      registerTool: (tool: any) => {
        tools.set(tool.name, tool)
      },
      registerService: (service: any) => {
        services.set(service.id, service)
      },
      tools,
      services
    }
  }
  
  let api: any
  
  beforeAll(() => {
    api = createMockAPI()
    registerPlugin(api)
  })
  
  it('should register all 5 agent tools', () => {
    expect(api.tools.size).toBe(5)
    
    const expectedTools = [
      'p2p_discover',
      'p2p_send',
      'p2p_request',
      'p2p_status',
      'p2p_channels'
    ]
    
    for (const toolName of expectedTools) {
      expect(api.tools.has(toolName)).toBe(true)
    }
  })
  
  it('should register background service', () => {
    expect(api.services.has('bsv-p2p-node')).toBe(true)
    
    const service = api.services.get('bsv-p2p-node')
    expect(service).toHaveProperty('start')
    expect(service).toHaveProperty('stop')
    expect(service).toHaveProperty('status')
  })
  
  it('p2p_discover tool should have proper interface', () => {
    const tool = api.tools.get('p2p_discover')
    
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_discover')
    expect(tool.description).toContain('Discover')
    expect(tool.parameters).toBeDefined()
    expect(tool.execute).toBeTypeOf('function')
  })
  
  it('p2p_send tool should have proper interface', () => {
    const tool = api.tools.get('p2p_send')
    
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_send')
    expect(tool.description).toContain('message')
    expect(tool.parameters.required).toContain('peerId')
    expect(tool.parameters.required).toContain('message')
  })
  
  it('p2p_request tool should have proper interface', () => {
    const tool = api.tools.get('p2p_request')
    
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_request')
    expect(tool.description).toContain('service')
    expect(tool.parameters.required).toContain('peerId')
    expect(tool.parameters.required).toContain('service')
    expect(tool.parameters.required).toContain('input')
  })
  
  it('p2p_status tool should have proper interface', () => {
    const tool = api.tools.get('p2p_status')
    
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_status')
    expect(tool.description).toContain('status')
    expect(tool.execute).toBeTypeOf('function')
  })
  
  it('p2p_channels tool should have proper interface', () => {
    const tool = api.tools.get('p2p_channels')
    
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_channels')
    expect(tool.description).toContain('channel')
    expect(tool.parameters.properties.action).toBeDefined()
    expect(tool.parameters.properties.action.enum).toContain('list')
    expect(tool.parameters.properties.action.enum).toContain('open')
    expect(tool.parameters.properties.action.enum).toContain('close')
  })
  
  it('p2p_channels tool should support all three actions', () => {
    const tool = api.tools.get('p2p_channels')
    const actions = tool.parameters.properties.action.enum
    
    expect(actions).toEqual(['list', 'open', 'close'])
  })
  
  it('p2p_discover should return proper response format when P2P node offline', async () => {
    const tool = api.tools.get('p2p_discover')
    const context = { sessionKey: 'test', agentId: 'test-agent' }
    
    const result = await tool.execute(context, {})
    
    expect(result).toHaveProperty('content')
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content[0]).toHaveProperty('type')
    expect(result.content[0]).toHaveProperty('text')
    expect(result.content[0].type).toBe('text')
  })
  
  it('p2p_status should return status even when P2P node offline', async () => {
    const tool = api.tools.get('p2p_status')
    const context = { sessionKey: 'test', agentId: 'test-agent' }
    
    const result = await tool.execute(context, {})
    
    expect(result).toHaveProperty('content')
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('Status')
  })
  
  it('p2p_channels list should return proper response format', async () => {
    const tool = api.tools.get('p2p_channels')
    const context = { sessionKey: 'test', agentId: 'test-agent' }
    
    const result = await tool.execute(context, { action: 'list' })
    
    expect(result).toHaveProperty('content')
    expect(result.content[0].type).toBe('text')
    // Either shows channels or "P2P node not running" message
    expect(typeof result.content[0].text).toBe('string')
  })
})

/**
 * NOTES ON FULL E2E TESTING:
 * 
 * This test validates the plugin tool interfaces without requiring a running
 * P2P node. Full E2E testing with actual payment channels requires:
 * 
 * 1. Two OpenClaw gateway instances running simultaneously
 * 2. Both connected to the same relay server
 * 3. Real BSV wallet funding
 * 4. Network connectivity
 * 5. Manual orchestration of agent interactions
 * 
 * For full E2E test procedure, see: docs/MANUAL-E2E-TEST.md
 * 
 * Test Coverage Summary:
 * ✅ Plugin registration
 * ✅ Tool interface validation
 * ✅ Tool parameter schemas
 * ✅ Response format validation
 * ✅ Error handling (offline node)
 * 
 * ❌ Not covered (requires manual testing):
 * - Real P2P communication
 * - Payment channel lifecycle
 * - Off-chain micropayments
 * - On-chain transaction verification
 * - Multi-agent coordination
 */
