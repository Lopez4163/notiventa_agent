import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'
import { describe, expect, it } from 'vitest'
import {
  contentSecurityPolicy,
  VITE_REACT_REFRESH_PREAMBLE_HASH
} from '../src/main/content-security-policy'

describe('Renderer Content Security Policy', () => {
  it('keeps production network connections disabled', () => {
    const policy = contentSecurityPolicy(null)
    const scriptSource = directive(policy, 'script-src')
    expect(scriptSource).toBe("script-src 'self'")
    expect(policy).not.toContain(VITE_REACT_REFRESH_PREAMBLE_HASH)
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
    expect(policy).toContain(
      `script-src 'self' '${VITE_REACT_REFRESH_PREAMBLE_HASH}'`
    )
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'")
  })

  it('allows exactly the inline preamble injected by the installed React plugin', () => {
    const preamble = react.preambleCode.replace('__BASE__', '/')
    const hash = `sha256-${createHash('sha256').update(preamble).digest('base64')}`
    expect(hash).toBe(VITE_REACT_REFRESH_PREAMBLE_HASH)
  })
})

function directive(policy: string, name: string): string | undefined {
  return policy.split('; ').find((value) => value.startsWith(`${name} `))
}
