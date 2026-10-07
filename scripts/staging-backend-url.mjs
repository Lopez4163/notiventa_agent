const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])

export function stagingBackendOrigin(rawBackendUrl) {
  if (!rawBackendUrl?.trim()) {
    throw new Error('NOTIVENTA_AGENT_STAGING_BACKEND_URL is required for a staging package.')
  }

  let backendUrl
  try {
    backendUrl = new URL(rawBackendUrl.trim())
  } catch {
    throw new Error('NOTIVENTA_AGENT_STAGING_BACKEND_URL must be a valid URL.')
  }

  if (
    backendUrl.protocol !== 'https:' ||
    backendUrl.username ||
    backendUrl.password ||
    backendUrl.search ||
    backendUrl.hash ||
    loopbackHosts.has(backendUrl.hostname)
  ) {
    throw new Error('The staging backend URL must be a credential-free, non-local HTTPS origin.')
  }

  return backendUrl.origin
}
