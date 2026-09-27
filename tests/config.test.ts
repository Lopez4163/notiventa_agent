import { describe, expect, it } from 'vitest'
import { loadAgentConfig } from '../src/main/config'
import { platformIdentifier } from '../src/main/platform'

describe('Agent configuration', () => {
  it('loads a local development URL and app version', () => {
    const config = loadAgentConfig({
      env: { NOTIVENTA_AGENT_ENV: 'development', NOTIVENTA_AGENT_BACKEND_URL: 'http://localhost:8000' },
      version: '1.0.3',
      platform: 'windows'
    })
    expect(config.version).toBe('1.0.3')
    expect(config.platform).toBe('windows')
    expect(config.backendUrl.href).toBe('http://localhost:8000/')
  })

  it('requires HTTPS outside local development', () => {
    expect(() => loadAgentConfig({
      env: { NOTIVENTA_AGENT_ENV: 'production', NOTIVENTA_AGENT_BACKEND_URL: 'http://api.example.com' },
      version: '1.0.0',
      platform: 'windows'
    })).toThrow(/HTTPS/)
  })

  it('reports the real operating-system platform', () => {
    expect(platformIdentifier('win32')).toBe('windows')
    expect(platformIdentifier('darwin')).toBe('macos')
    expect(platformIdentifier('linux')).toBe('linux')
  })
})
