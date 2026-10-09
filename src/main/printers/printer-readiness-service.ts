import type { PrinterReadiness } from '../../shared/contracts'
import type { PrinterConfigurationService } from './printer-configuration-service'

// PF7 deliberately derives only local configuration readiness. It does not
// claim hardware health, spooler health, media state, or print success.
export class PrinterReadinessService {
  constructor(private readonly printerConfiguration: PrinterConfigurationService) {}

  async getReadiness(): Promise<PrinterReadiness> {
    const status = await this.printerConfiguration.getStatus()
    if (!status.configured) {
      return {
        state: 'NOT_CONFIGURED',
        ready: false,
        reason: status.error === 'PRINTER_CONFIGURATION_INVALID'
          ? 'PRINTER_CONFIGURATION_INVALID'
          : 'NO_PRINTER_CONFIGURATION',
        configuration: null,
        discoveredPrinter: null
      }
    }
    if (status.error === 'PRINTER_DISCOVERY_UNAVAILABLE') {
      return unavailable(status, 'PRINTER_DISCOVERY_UNAVAILABLE')
    }
    if (!status.available || !status.discoveredPrinter) {
      return unavailable(status, 'CONFIGURED_PRINTER_UNAVAILABLE')
    }
    return {
      state: 'READY',
      ready: true,
      reason: null,
      configuration: status.configuration,
      discoveredPrinter: status.discoveredPrinter
    }
  }
}

function unavailable(
  status: Awaited<ReturnType<PrinterConfigurationService['getStatus']>>,
  reason: 'PRINTER_DISCOVERY_UNAVAILABLE' | 'CONFIGURED_PRINTER_UNAVAILABLE'
): PrinterReadiness {
  return {
    state: 'UNAVAILABLE',
    ready: false,
    reason,
    configuration: status.configuration,
    discoveredPrinter: null
  }
}
