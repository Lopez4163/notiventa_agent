import type { PackagedAgentBuildConfig } from './config'

declare const __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__: string | null
declare const __NOTIVENTA_AGENT_PACKAGED_BACKEND_URL__: string | null

export const PACKAGED_AGENT_BUILD_CONFIG: PackagedAgentBuildConfig = Object.freeze({
  environment:
    __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__ === 'local-validation' ||
    __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__ === 'staging' ||
    __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__ === 'production'
      ? __NOTIVENTA_AGENT_PACKAGED_ENVIRONMENT__
      : null,
  backendUrl: __NOTIVENTA_AGENT_PACKAGED_BACKEND_URL__
})
