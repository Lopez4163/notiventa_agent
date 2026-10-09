import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronPrinterDiscovery } from '../src/main/printers/printer-discovery'

afterEach(() => vi.restoreAllMocks())

function createDiscovery(printers: unknown[] | Error) {
  const getPrintersAsync = vi.fn().mockImplementation(async () => {
    if (printers instanceof Error) throw printers
    return printers
  })
  return { discovery: new ElectronPrinterDiscovery({ getPrintersAsync }), getPrintersAsync }
}

describe('ElectronPrinterDiscovery', () => {
  it('returns an empty successful result when Windows reports zero queues', async () => {
    const { discovery } = createDiscovery([])
    await expect(discovery.listPrinters()).resolves.toEqual({ printers: [], error: null })
  })

  it('normalizes one queue without exposing raw platform options', async () => {
    const { discovery } = createDiscovery([{
      name: 'WHTP203e', displayName: 'Westinghouse Label Printer', description: 'Thermal',
      options: { isDefault: true, driverSecret: 'must-not-leak' }
    }])
    await expect(discovery.listPrinters()).resolves.toEqual({
      error: null,
      printers: [{
        systemName: 'WHTP203e', displayName: 'Westinghouse Label Printer', description: 'Thermal', isDefault: true, available: true
      }]
    })
  })

  it('preserves multiple distinct queues and supports case-insensitive exact Windows identity', async () => {
    const { discovery } = createDiscovery([
      { name: 'Packing-4x6', displayName: 'Packing', description: '', options: {} },
      { name: 'Office Laser', displayName: 'Office Laser', description: 'A4', options: { isDefault: false } }
    ])
    const result = await discovery.listPrinters()
    expect(result.printers.map((printer) => printer.systemName)).toEqual(['Packing-4x6', 'Office Laser'])
    await expect(discovery.findPrinter('packing-4X6')).resolves.toMatchObject({ systemName: 'Packing-4x6', available: true })
    await expect(discovery.isPrinterAvailable('PACKING-4X6')).resolves.toBe(true)
    await expect(discovery.isPrinterAvailable('Packing')).resolves.toBe(false)
  })

  it('drops malformed queues and deterministically de-duplicates the same Windows queue identity', async () => {
    const { discovery } = createDiscovery([
      null,
      { name: '   ', options: {} },
      { name: 'Packing', displayName: 'First queue', options: {} },
      { name: 'packing', displayName: 'Duplicate queue', options: {} }
    ])
    await expect(discovery.listPrinters()).resolves.toEqual({
      error: null,
      printers: [{ systemName: 'Packing', displayName: 'First queue', description: null, isDefault: false, available: true }]
    })
  })

  it('fails safely when Electron enumeration is unavailable', async () => {
    const { discovery } = createDiscovery(new Error('platform API unavailable'))
    await expect(discovery.listPrinters()).resolves.toEqual({ printers: [], error: 'PRINTER_DISCOVERY_UNAVAILABLE' })
    await expect(discovery.isPrinterAvailable('Packing')).resolves.toBe(false)
  })

  it('does not submit print work', async () => {
    const print = vi.fn()
    const source = {
      getPrintersAsync: vi.fn().mockResolvedValue([{ name: 'Packing', options: {} }]),
      print
    }
    const discovery = new ElectronPrinterDiscovery(source)
    await discovery.listPrinters()
    expect(print).not.toHaveBeenCalled()
  })
})
