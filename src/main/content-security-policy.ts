const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
]

export function contentSecurityPolicy(rendererUrl: string | null): string {
  const connectSource = rendererUrl
    ? `'self' ${webSocketOrigin(rendererUrl)}`
    : "'none'"
  return [...BASE_DIRECTIVES, `connect-src ${connectSource}`].join('; ')
}

function webSocketOrigin(rendererUrl: string): string {
  const url = new URL(rendererUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}
