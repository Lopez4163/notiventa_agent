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

export type PrinterReadinessState = 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'READY'

export interface PrinterReadiness {
  state: PrinterReadinessState
  ready: boolean
  reason:
    | 'NO_PRINTER_CONFIGURATION'
    | 'PRINTER_CONFIGURATION_INVALID'
    | 'PRINTER_DISCOVERY_UNAVAILABLE'
    | 'CONFIGURED_PRINTER_UNAVAILABLE'
    | null
  configuration: PrinterConfiguration | null
  discoveredPrinter: DiscoveredPrinter | null
}

export type DiagnosticPrintResult =
  | {
      status: 'SUBMITTED'
      code: 'SUBMITTED_TO_WINDOWS'
      message: 'Submitted to Windows. Verify that the label printed correctly.'
    }
  | {
      status: 'FAILED'
      code:
        | 'PRINT_ALREADY_IN_PROGRESS'
        | 'PRINT_DOCUMENT_INVALID'
        | 'WINDOWS_PRINTING_UNAVAILABLE'
        | 'PRINTER_NOT_READY'
        | 'PRINT_RENDER_FAILED'
        | 'WINDOWS_PRINT_REJECTED'
      message: string
    }
  | {
      status: 'INDETERMINATE'
      code: 'WINDOWS_PRINT_SUBMISSION_TIMEOUT'
      message: 'Windows did not confirm whether the print request was submitted. Do not retry automatically.'
    }

export type ShippingLabelPrintResult =
  | {
      status: 'AWAITING_CONFIRMATION'
      message: 'Submitted to Windows. Confirm the physical shipping label before continuing.'
    }
  | {
      status: 'RECORDED_SUCCESS'
      message: 'Physical success was saved and will be delivered to NotiVenta.'
    }
  | {
      status: 'RECORDED_FAILURE' | 'RECORDED_UNKNOWN'
      message: string
    }
  | {
      status: 'BLOCKED'
      code: string
      message: string
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
  getPrinterReadiness(): Promise<PrinterReadiness>
  selectPrinter(systemName: string): Promise<PrinterConfigurationStatus>
  clearPrinterConfiguration(): Promise<PrinterConfigurationStatus>
  printTestLabel(): Promise<DiagnosticPrintResult>
  submitShippingLabel(): Promise<ShippingLabelPrintResult>
  confirmShippingLabelPrinted(): Promise<ShippingLabelPrintResult>
  reportShippingLabelPrintFailure(): Promise<ShippingLabelPrintResult>
}

export const IPC_CHANNELS = {
  getState: 'agent:get-state',
  pairDevice: 'agent:pair-device',
  stateChanged: 'agent:state-changed',
  getStartWithWindows: 'agent:get-start-with-windows',
  setStartWithWindows: 'agent:set-start-with-windows',
  listInstalledPrinters: 'agent:list-installed-printers',
  getPrinterConfiguration: 'agent:get-printer-configuration',
  getPrinterReadiness: 'agent:get-printer-readiness',
  selectPrinter: 'agent:select-printer',
  clearPrinterConfiguration: 'agent:clear-printer-configuration',
  printTestLabel: 'agent:print-test-label',
  submitShippingLabel: 'agent:submit-shipping-label',
  confirmShippingLabelPrinted: 'agent:confirm-shipping-label-printed',
  reportShippingLabelPrintFailure: 'agent:report-shipping-label-print-failure'
} as const
