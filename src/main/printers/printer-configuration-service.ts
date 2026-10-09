import type { PrinterConfigurationStatus } from '../../shared/contracts'
import type { SettingsStore } from '../settings-store'
import type { PrinterDiscovery } from './printer-discovery'
import { SHIPPING_LABEL_4X6_PROFILE } from './printer-configuration'

export class PrinterConfigurationService {
  constructor(private readonly settings: SettingsStore, private readonly discovery: PrinterDiscovery) {}

  async getStatus(): Promise<PrinterConfigurationStatus> {
    const stored = this.settings.getPrinterConfiguration()
    if (stored.kind === 'invalid') return emptyStatus('PRINTER_CONFIGURATION_INVALID')
    if (stored.kind === 'none') return emptyStatus(null)
    const discovery = await this.discovery.listPrinters()
    if (discovery.error) {
      return { configured: true, configuration: stored.configuration, available: false, discoveredPrinter: null, error: discovery.error }
    }
    const discoveredPrinter = discovery.printers.find((printer) => printer.systemName.toLocaleLowerCase('en-US') === stored.configuration.systemName.toLocaleLowerCase('en-US')) ?? null
    return { configured: true, configuration: stored.configuration, available: discoveredPrinter !== null, discoveredPrinter, error: null }
  }

  async select(systemName: string): Promise<PrinterConfigurationStatus> {
    if (typeof systemName !== 'string' || systemName.trim().length === 0 || systemName.length > 255) throw new Error('A printer queue name is required.')
    const printer = await this.discovery.findPrinter(systemName)
    if (!printer) throw new Error('The selected printer queue is not currently available.')
    this.settings.setPrinterConfiguration({ systemName: printer.systemName, profile: SHIPPING_LABEL_4X6_PROFILE })
    return this.getStatus()
  }

  async clear(): Promise<PrinterConfigurationStatus> {
    this.settings.clearPrinterConfiguration()
    return emptyStatus(null)
  }
}

function emptyStatus(error: PrinterConfigurationStatus['error']): PrinterConfigurationStatus {
  return { configured: false, configuration: null, available: false, discoveredPrinter: null, error }
}
