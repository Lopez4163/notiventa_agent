import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../src/main/content-security-policy'

describe('Renderer Content Security Policy', () => {
  it('keeps production network connections disabled', () => {
    const policy = contentSecurityPolicy(null)
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).not.toContain('ws:')
  })

  it.each([
    ['http://localhost:5173', 'ws://localhost:5173'],
    ['http://127.0.0.1:5173', 'ws://127.0.0.1:5173'],
    ['http://[::1]:5173', 'ws://[::1]:5173'],
    ['https://localhost:5173', 'wss://localhost:5173']
  ])('allows only the matching development WebSocket for %s', (rendererUrl, socketUrl) => {
    const policy = contentSecurityPolicy(rendererUrl)
    expect(policy).toContain(`connect-src 'self' ${socketUrl}`)
    expect(policy).not.toContain("script-src 'unsafe-inline'")
  })
})
