import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerP2PTools } from '../../../src/skill/index.js'

describe('OpenClaw Skill Integration', () => {
  let mockApi: any
  let registeredTools: Map<string, any>

  beforeEach(() => {
    registeredTools = new Map()
    
    mockApi = {
      registerTool: vi.fn((tool) => {
        registeredTools.set(tool.name, tool)
      })
    }
  })

  it('should register all required tools', () => {
    registerP2PTools(mockApi)
    
    expect(registeredTools.has('p2p_discover')).toBe(true)
    expect(registeredTools.has('p2p_send')).toBe(true)
    expect(registeredTools.has('p2p_status')).toBe(true)
    expect(registeredTools.size).toBe(3) // Only 3 tools in stripped-down P2P layer
  })

  it('should register p2p_discover tool with correct structure', () => {
    registerP2PTools(mockApi)
    
    const tool = registeredTools.get('p2p_discover')
    expect(tool).toBeDefined()
    expect(tool.name).toBe('p2p_discover')
    expect(tool.description).toBeTruthy()
    expect(tool.parameters).toBeDefined()
    expect(tool.parameters.type).toBe('object')
    expect(tool.execute).toBeTypeOf('function')
  })

  it('should register p2p_send tool with required parameters', () => {
    registerP2PTools(mockApi)
    
    const tool = registeredTools.get('p2p_send')
    expect(tool).toBeDefined()
    expect(tool.parameters.properties).toHaveProperty('peerId')
    expect(tool.parameters.properties).toHaveProperty('message')
    expect(tool.parameters.required).toContain('peerId')
    expect(tool.parameters.required).toContain('message')
  })

  it('should register p2p_status tool', () => {
    registerP2PTools(mockApi)
    
    const tool = registeredTools.get('p2p_status')
    expect(tool).toBeDefined()
    expect(tool.description).toBeTruthy()
  })

  describe('Tool Execution (mocked)', () => {
    it('p2p_discover should handle daemon not running', async () => {
      registerP2PTools(mockApi)
      const tool = registeredTools.get('p2p_discover')
      
      // Execute will try to connect to daemon, which won't be running in tests
      const result = await tool.execute({}, {})
      
      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')
    })

    it('p2p_send should have execute function', async () => {
      registerP2PTools(mockApi)
      const tool = registeredTools.get('p2p_send')
      
      expect(tool.execute).toBeTypeOf('function')
      
      // Execute will fail without daemon, but should return error structure
      const result = await tool.execute({}, {
        peerId: '12D3KooWTest',
        message: 'Hello'
      })
      
      expect(result.content).toBeDefined()
    })

    it('p2p_status should have execute function', async () => {
      registerP2PTools(mockApi)
      const tool = registeredTools.get('p2p_status')
      
      expect(tool.execute).toBeTypeOf('function')
      
      const result = await tool.execute({}, {})
      expect(result.content).toBeDefined()
    })
  })

  describe('Tool Descriptions', () => {
    it('all tools should have helpful descriptions', () => {
      registerP2PTools(mockApi)
      
      for (const [name, tool] of registeredTools.entries()) {
        expect(tool.description).toBeTruthy()
        expect(tool.description.length).toBeGreaterThan(20)
      }
    })

    it('all tools should have parameter schemas', () => {
      registerP2PTools(mockApi)
      
      for (const [name, tool] of registeredTools.entries()) {
        expect(tool.parameters).toBeDefined()
        expect(tool.parameters.type).toBe('object')
        expect(tool.parameters.properties).toBeDefined()
      }
    })
  })
})
