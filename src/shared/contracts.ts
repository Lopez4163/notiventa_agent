export type AgentEnvironment = 'development' | 'staging' | 'production'
export type AgentLifecycle =
  | 'needs-pairing'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'credential-storage-retry-required'
export type MercadoLibreStatus = 'CONNECTED' | 'ISSUE' | 'DISCONNECTED'
export type UpdateStatus = 'CURRENT' | 'UPDATE_AVAILABLE' | 'UPDATE_REQUIRED'

export interface PairDeviceInput {
  pairingCode: string
  displayName: string
}

export interface SafeDeviceMetadata {
  id: string
  systemName: string
  displayName: string
  platform: string
  agentVersion: string
}

export interface BackendOperationalState {
  isPaused: boolean
  systemBlocked: boolean
  mercadoLibreStatus: MercadoLibreStatus
  queueCount: number
  updateStatus: UpdateStatus
}

export interface AgentState {
  lifecycle: AgentLifecycle
  systemName: string
  device: SafeDeviceMetadata | null
  backend: BackendOperationalState | null
  error: string | null
}

export interface AgentRendererApi {
  getState(): Promise<AgentState>
  pairDevice(input: PairDeviceInput): Promise<AgentState>
  subscribeToState(listener: (state: AgentState) => void): () => void
  getStartWithWindows(): Promise<boolean>
  setStartWithWindows(enabled: boolean): Promise<boolean>
}

export const IPC_CHANNELS = {
  getState: 'agent:get-state',
  pairDevice: 'agent:pair-device',
  stateChanged: 'agent:state-changed',
  getStartWithWindows: 'agent:get-start-with-windows',
  setStartWithWindows: 'agent:set-start-with-windows'
} as const
