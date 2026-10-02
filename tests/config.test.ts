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

  it('requires an explicit development-only opt-in for a private VM-reachable backend', () => {
    const baseEnvironment = {
      NOTIVENTA_AGENT_ENV: 'development',
      NOTIVENTA_AGENT_BACKEND_URL: 'http://192.168.64.1:8000'
    }
    expect(() => loadAgentConfig({
      env: baseEnvironment,
      version: '1.0.0',
      platform: 'windows'
    })).toThrow(/HTTPS/)

    const config = loadAgentConfig({
      env: { ...baseEnvironment, NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK: 'true' },
      version: '1.0.0',
      platform: 'windows'
    })
    expect(config.backendUrl.href).toBe('http://192.168.64.1:8000/')
  })

  it('does not permit a public HTTP backend even with the development opt-in', () => {
    expect(() => loadAgentConfig({
      env: {
        NOTIVENTA_AGENT_ENV: 'development',
        NOTIVENTA_AGENT_BACKEND_URL: 'http://example.com:8000',
        NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK: 'true'
      },
      version: '1.0.0',
      platform: 'windows'
    })).toThrow(/HTTPS/)
  })

  it('uses immutable packaged staging configuration instead of runtime environment overrides', () => {
    const config = loadAgentConfig({
      env: {
        NOTIVENTA_AGENT_ENV: 'production',
        NOTIVENTA_AGENT_BACKEND_URL: 'https://production.example.com'
      },
      packaged: {
        environment: 'staging',
        backendUrl: 'https://staging.example.com'
      },
      version: '1.0.0',
      platform: 'windows'
    })
    expect(config.environment).toBe('staging')
    expect(config.backendUrl.href).toBe('https://staging.example.com/')
  })

  it('does not fall back to runtime environment variables when packaged configuration is missing', () => {
    expect(() => loadAgentConfig({
      env: {
        NOTIVENTA_AGENT_ENV: 'production',
        NOTIVENTA_AGENT_BACKEND_URL: 'https://production.example.com'
      },
      packaged: { environment: null, backendUrl: null },
      version: '1.0.0',
      platform: 'windows'
    })).toThrow(/NOTIVENTA_AGENT_ENV/)
  })

  it('reports the real operating-system platform', () => {
    expect(platformIdentifier('win32')).toBe('windows')
    expect(platformIdentifier('darwin')).toBe('macos')
    expect(platformIdentifier('linux')).toBe('linux')
  })
})
