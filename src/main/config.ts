import type { AgentEnvironment } from '../shared/contracts'

export interface AgentConfig {
  backendUrl: URL
  environment: AgentEnvironment
  version: string
  platform: string
}

const environments = new Set<AgentEnvironment>(['development', 'staging', 'production'])

export function loadAgentConfig(options: {
  env?: NodeJS.ProcessEnv
  version: string
  platform: string
}): AgentConfig {
  const env = options.env ?? process.env
  const environment = env.NOTIVENTA_AGENT_ENV ?? 'development'
  if (!environments.has(environment as AgentEnvironment)) {
    throw new Error('NOTIVENTA_AGENT_ENV must be development, staging, or production.')
  }
  const rawUrl = env.NOTIVENTA_AGENT_BACKEND_URL
  if (!rawUrl) throw new Error('NOTIVENTA_AGENT_BACKEND_URL is required.')
  const backendUrl = new URL(rawUrl)
  const isLocalDevelopment =
    environment === 'development' &&
    backendUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(backendUrl.hostname)
  if (backendUrl.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('The configured backend URL must use HTTPS outside local development.')
  }
  if (backendUrl.username || backendUrl.password || backendUrl.search || backendUrl.hash) {
    throw new Error('The backend URL must not contain credentials, query parameters, or fragments.')
  }
  return {
    backendUrl,
    environment: environment as AgentEnvironment,
    version: options.version,
    platform: options.platform
  }
}
