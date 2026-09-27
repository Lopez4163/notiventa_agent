const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
]

// SHA-256 of the inline React Refresh preamble injected by
// @vitejs/plugin-react 5.2.0 for the root Vite base path.
export const VITE_REACT_REFRESH_PREAMBLE_HASH =
  'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='

export function contentSecurityPolicy(rendererUrl: string | null): string {
  const scriptSource = rendererUrl
    ? `'self' '${VITE_REACT_REFRESH_PREAMBLE_HASH}'`
    : "'self'"
  const connectSource = rendererUrl
    ? `'self' ${webSocketOrigin(rendererUrl)}`
    : "'none'"
  return [
    ...BASE_DIRECTIVES,
    `script-src ${scriptSource}`,
    `connect-src ${connectSource}`
  ].join('; ')
}

function webSocketOrigin(rendererUrl: string): string {
  const url = new URL(rendererUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}
