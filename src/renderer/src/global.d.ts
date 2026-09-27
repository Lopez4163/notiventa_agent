import type { AgentRendererApi } from '../../shared/contracts'

declare global {
  interface Window {
    notiventa: AgentRendererApi
  }
}

export {}
