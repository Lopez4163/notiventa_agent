import type { AgentEnvironment } from '../shared/contracts'

export interface AgentConfig {
  backendUrl: URL
  environment: AgentEnvironment
  version: string
  platform: string
}

export interface PackagedAgentBuildConfig {
  environment: AgentEnvironment | null
  backendUrl: string | null
}

const environments = new Set<AgentEnvironment>(['development', 'staging', 'production'])

function isPrivateOrLinkLocalIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [first, second] = octets
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
}

export function loadAgentConfig(options: {
  env?: NodeJS.ProcessEnv
  version: string
  platform: string
  packaged?: PackagedAgentBuildConfig
}): AgentConfig {
  const env = options.env ?? process.env
  const environment = options.packaged
    ? options.packaged.environment
    : env.NOTIVENTA_AGENT_ENV ?? 'development'
  if (!environments.has(environment as AgentEnvironment)) {
    throw new Error('NOTIVENTA_AGENT_ENV must be development, staging, or production.')
  }
  const rawUrl = options.packaged
    ? options.packaged.backendUrl
    : env.NOTIVENTA_AGENT_BACKEND_URL
  if (!rawUrl) throw new Error('NOTIVENTA_AGENT_BACKEND_URL is required.')
  const backendUrl = new URL(rawUrl)
  const isLoopbackDevelopment =
    environment === 'development' &&
    backendUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(backendUrl.hostname)
  const isOptedInVmDevelopment =
    !options.packaged &&
    environment === 'development' &&
    backendUrl.protocol === 'http:' &&
    env.NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK === 'true' &&
    isPrivateOrLinkLocalIpv4(backendUrl.hostname)
  if (backendUrl.protocol !== 'https:' && !isLoopbackDevelopment && !isOptedInVmDevelopment) {
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
