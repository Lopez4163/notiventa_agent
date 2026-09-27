const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveDevelopmentRendererUrl(
  rawUrl: string | undefined,
  isPackaged: boolean
): string | null {
  if (isPackaged || !rawUrl) return null

  const url = new URL(rawUrl)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('ELECTRON_RENDERER_URL must use a loopback development origin.')
  }
  return url.origin
}
