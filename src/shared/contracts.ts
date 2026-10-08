export type AgentEnvironment = 'development' | 'local-validation' | 'staging' | 'production'
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

export interface ReceivedPrintJob {
  jobId: string
  attemptId: string
  printType: 'SHIPPING_LABEL'
  shipmentId: string
  orderId: string | null
}

export interface DiscoveredPrinter {
  systemName: string
  displayName: string
  description: string | null
  isDefault: boolean
  available: boolean
}

export type PrinterDiscoveryResult = {
  printers: DiscoveredPrinter[]
  error: 'PRINTER_DISCOVERY_UNAVAILABLE' | null
}

export interface PrinterConfiguration {
  systemName: string
  profile: {
    printType: 'SHIPPING_LABEL'
    width: 4
    height: 6
    unit: 'INCH'
  }
}

export interface PrinterConfigurationStatus {
  configured: boolean
  configuration: PrinterConfiguration | null
  available: boolean
  discoveredPrinter: DiscoveredPrinter | null
  error: 'PRINTER_CONFIGURATION_INVALID' | 'PRINTER_DISCOVERY_UNAVAILABLE' | null
}

export interface AgentState {
  lifecycle: AgentLifecycle
  systemName: string
  device: SafeDeviceMetadata | null
  backend: BackendOperationalState | null
  receivedJob: ReceivedPrintJob | null
  error: string | null
}

export interface AgentRendererApi {
  getState(): Promise<AgentState>
  pairDevice(input: PairDeviceInput): Promise<AgentState>
  subscribeToState(listener: (state: AgentState) => void): () => void
  getStartWithWindows(): Promise<boolean>
  setStartWithWindows(enabled: boolean): Promise<boolean>
  listInstalledPrinters(): Promise<PrinterDiscoveryResult>
  getPrinterConfiguration(): Promise<PrinterConfigurationStatus>
  selectPrinter(systemName: string): Promise<PrinterConfigurationStatus>
  clearPrinterConfiguration(): Promise<PrinterConfigurationStatus>
}

export const IPC_CHANNELS = {
  getState: 'agent:get-state',
  pairDevice: 'agent:pair-device',
  stateChanged: 'agent:state-changed',
  getStartWithWindows: 'agent:get-start-with-windows',
  setStartWithWindows: 'agent:set-start-with-windows',
  listInstalledPrinters: 'agent:list-installed-printers',
  getPrinterConfiguration: 'agent:get-printer-configuration',
  selectPrinter: 'agent:select-printer',
  clearPrinterConfiguration: 'agent:clear-printer-configuration'
} as const
