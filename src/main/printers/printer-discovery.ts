import type { DiscoveredPrinter, PrinterDiscoveryResult } from '../../shared/contracts'

export interface PrinterDiscovery {
  listPrinters(): Promise<PrinterDiscoveryResult>
  findPrinter(systemName: string): Promise<DiscoveredPrinter | null>
  isPrinterAvailable(systemName: string): Promise<boolean>
}

export interface PrinterEnumerationSource {
  getPrintersAsync(): Promise<ReadonlyArray<unknown>>
}

export class ElectronPrinterDiscovery implements PrinterDiscovery {
  constructor(private readonly source: PrinterEnumerationSource) {}

  async listPrinters(): Promise<PrinterDiscoveryResult> {
    try {
      const seen = new Set<string>()
      const printers: DiscoveredPrinter[] = []
      for (const rawPrinter of await this.source.getPrintersAsync()) {
        const printer = normalizePrinter(rawPrinter)
        if (!printer) continue
        const identity = normalizePrinterIdentity(printer.systemName)
        if (seen.has(identity)) continue
        seen.add(identity)
        printers.push(printer)
      }
      console.info(`[printer-discovery] Found ${printers.length} installed printer queue(s).`)
      return { printers, error: null }
    } catch {
      console.warn('[printer-discovery] Installed-printer enumeration is unavailable.')
      return { printers: [], error: 'PRINTER_DISCOVERY_UNAVAILABLE' }
    }
  }

  async findPrinter(systemName: string): Promise<DiscoveredPrinter | null> {
    const identity = normalizePrinterIdentity(systemName)
    if (!identity) return null
    const result = await this.listPrinters()
    return result.printers.find((printer) => normalizePrinterIdentity(printer.systemName) === identity) ?? null
  }

  async isPrinterAvailable(systemName: string): Promise<boolean> {
    return (await this.findPrinter(systemName))?.available === true
  }
}

export function normalizePrinterIdentity(systemName: string): string {
  return systemName.toLocaleLowerCase('en-US')
}

function normalizePrinter(value: unknown): DiscoveredPrinter | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return null
  const options = raw.options && typeof raw.options === 'object' ? raw.options as Record<string, unknown> : {}
  return {
    systemName: raw.name,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim().length > 0 ? raw.displayName : raw.name,
    description: typeof raw.description === 'string' && raw.description.trim().length > 0 ? raw.description : null,
    isDefault: options.isDefault === true || options.isDefault === 'true',
    // PF5 availability is intentionally narrow: the OS queue appeared in this enumeration.
    available: true
  }
}
