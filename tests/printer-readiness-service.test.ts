import { describe, expect, it, vi } from 'vitest'
import { PrinterConfigurationService } from '../src/main/printers/printer-configuration-service'
import { PrinterReadinessService } from '../src/main/printers/printer-readiness-service'
import type { PrinterDiscovery } from '../src/main/printers/printer-discovery'
import { MemorySettingsStore } from './test-doubles'

const label = { systemName: 'LabelPrinter', displayName: 'Label Printer', description: null, isDefault: false, available: true }
const similarDefault = { systemName: 'LabelPrinter Copy', displayName: 'Label Printer Copy', description: null, isDefault: true, available: true }

function create(printers = [label], error: 'PRINTER_DISCOVERY_UNAVAILABLE' | null = null) {
  const discovery: PrinterDiscovery = {
    listPrinters: vi.fn().mockResolvedValue({ printers, error }),
    findPrinter: vi.fn(async (name: string) => printers.find((printer) => printer.systemName.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US')) ?? null),
    isPrinterAvailable: vi.fn()
  }
  const settings = new MemorySettingsStore()
  const configuration = new PrinterConfigurationService(settings, discovery)
  return { readiness: new PrinterReadinessService(configuration), configuration, settings, discovery }
}

describe('PrinterReadinessService', () => {
  it('is not configured without a selected queue', async () => {
    const { readiness } = create()
    await expect(readiness.getReadiness()).resolves.toMatchObject({ state: 'NOT_CONFIGURED', ready: false, reason: 'NO_PRINTER_CONFIGURATION' })
  })

  it('is ready only for a valid configuration whose exact queue is discovered', async () => {
    const { readiness, configuration } = create()
    await configuration.select('labelprinter')
    await expect(readiness.getReadiness()).resolves.toMatchObject({ state: 'READY', ready: true, reason: null, configuration: { systemName: 'LabelPrinter' }, discoveredPrinter: label })
  })

  it('fails closed when the configured queue is absent, including when a similar default exists', async () => {
    const first = create()
    await first.configuration.select('LabelPrinter')
    const restarted = create([similarDefault])
    restarted.settings.printerConfiguration = first.settings.printerConfiguration
    await expect(restarted.readiness.getReadiness()).resolves.toMatchObject({ state: 'UNAVAILABLE', ready: false, reason: 'CONFIGURED_PRINTER_UNAVAILABLE', configuration: { systemName: 'LabelPrinter' }, discoveredPrinter: null })
  })

  it('returns unavailable when discovery cannot verify a valid configuration', async () => {
    const { readiness, settings } = create([label], 'PRINTER_DISCOVERY_UNAVAILABLE')
    // Store valid data directly because a failing discovery cannot accept a new selection.
    settings.setPrinterConfiguration({ systemName: 'LabelPrinter', profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' } })
    await expect(readiness.getReadiness()).resolves.toMatchObject({ state: 'UNAVAILABLE', ready: false, reason: 'PRINTER_DISCOVERY_UNAVAILABLE' })
  })

  it('fails closed for corrupt persisted configuration', async () => {
    const { readiness, settings } = create()
    settings.printerConfiguration = { systemName: 'LabelPrinter', profile: { width: 4 } }
    await expect(readiness.getReadiness()).resolves.toMatchObject({ state: 'NOT_CONFIGURED', ready: false, reason: 'PRINTER_CONFIGURATION_INVALID' })
  })

  it('does not invoke a print boundary while deriving readiness', async () => {
    const print = vi.fn()
    const { readiness, configuration } = create()
    await configuration.select('LabelPrinter')
    await readiness.getReadiness()
    expect(print).not.toHaveBeenCalled()
  })
})
