import { describe, expect, it, vi } from 'vitest'
import { PrinterConfigurationService } from '../src/main/printers/printer-configuration-service'
import type { PrinterDiscovery } from '../src/main/printers/printer-discovery'
import { MemorySettingsStore } from './test-doubles'

const packing = { systemName: 'Packing-4x6', displayName: 'Packing', description: null, isDefault: false, available: true }
const defaultPrinter = { systemName: 'Office Laser', displayName: 'Office', description: null, isDefault: true, available: true }

function create(printers = [packing, defaultPrinter], error: 'PRINTER_DISCOVERY_UNAVAILABLE' | null = null) {
  const discovery: PrinterDiscovery = {
    listPrinters: vi.fn().mockResolvedValue({ printers, error }),
    findPrinter: vi.fn(async (name: string) => printers.find((printer) => printer.systemName.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US')) ?? null),
    isPrinterAvailable: vi.fn()
  }
  const settings = new MemorySettingsStore()
  return { service: new PrinterConfigurationService(settings, discovery), settings, discovery }
}

describe('PrinterConfigurationService', () => {
  it('persists a discovered exact queue with the fixed 4x6 profile', async () => {
    const { service, settings } = create()
    const status = await service.select('packing-4X6')
    expect(status).toMatchObject({ configured: true, available: true, configuration: {
      systemName: 'Packing-4x6', profile: { printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH' }
    } })
    expect(settings.getPrinterConfiguration()).toMatchObject({ kind: 'valid' })
  })

  it('rejects a missing or similar queue without writing a configuration', async () => {
    const { service, settings } = create()
    await expect(service.select('Packing-4x6 Copy')).rejects.toThrow('not currently available')
    expect(settings.getPrinterConfiguration()).toEqual({ kind: 'none' })
  })

  it('restores persisted configuration after restart and preserves an unavailable selection', async () => {
    const first = create()
    await first.service.select('Packing-4x6')
    const restarted = create([defaultPrinter])
    restarted.settings.printerConfiguration = first.settings.printerConfiguration
    await expect(restarted.service.getStatus()).resolves.toMatchObject({
      configured: true, available: false, discoveredPrinter: null, configuration: { systemName: 'Packing-4x6' }
    })
  })

  it('changes and clears configuration without default-printer fallback', async () => {
    const { service } = create()
    await service.select('Packing-4x6')
    await expect(service.select('Office Laser')).resolves.toMatchObject({ configuration: { systemName: 'Office Laser' } })
    await expect(service.clear()).resolves.toEqual({ configured: false, configuration: null, available: false, discoveredPrinter: null, error: null })
  })

  it('fails closed on corrupt configuration or unavailable discovery', async () => {
    const corrupt = create()
    corrupt.settings.printerConfiguration = { systemName: 'Packing-4x6', profile: { width: 4 } }
    await expect(corrupt.service.getStatus()).resolves.toMatchObject({ configured: false, error: 'PRINTER_CONFIGURATION_INVALID' })
    const unavailable = create([packing], 'PRINTER_DISCOVERY_UNAVAILABLE')
    await unavailable.service.select('Packing-4x6')
    await expect(unavailable.service.getStatus()).resolves.toMatchObject({ configured: true, available: false, error: 'PRINTER_DISCOVERY_UNAVAILABLE' })
  })

  it('never invokes a print boundary while selecting or restoring configuration', async () => {
    const print = vi.fn()
    const { service } = create()
    await service.select('Packing-4x6')
    await service.getStatus()
    expect(print).not.toHaveBeenCalled()
  })
})
