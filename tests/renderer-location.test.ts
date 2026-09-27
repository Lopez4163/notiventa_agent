import { describe, expect, it } from 'vitest'
import { resolveDevelopmentRendererUrl } from '../src/main/renderer-location'

describe('development Renderer URL', () => {
  it.each([
    ['http://localhost:5173', 'http://localhost:5173'],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173'],
    ['http://[::1]:5173', 'http://[::1]:5173']
  ])('accepts loopback origin %s', (input, expected) => {
    expect(resolveDevelopmentRendererUrl(input, false)).toBe(expected)
  })

  it.each([
    'https://example.com',
    'http://192.168.1.20:5173',
    'file:///tmp/index.html',
    'http://user:password@localhost:5173'
  ])('rejects non-loopback development URL %s', (input) => {
    expect(() => resolveDevelopmentRendererUrl(input, false)).toThrow(/loopback/)
  })

  it('ignores the development URL in packaged builds', () => {
    expect(resolveDevelopmentRendererUrl('https://example.com', true)).toBeNull()
  })
})
