import Store from 'electron-store'
import type { SafeDeviceMetadata } from '../shared/contracts'
import {
  parseActiveAssignment,
  type ActiveAssignment,
  type ActiveAssignmentLoadResult
} from './active-assignment'
import {
  parsePendingReceipt,
  type PendingReceipt,
  type PendingReceiptLoadResult
} from './pending-receipt'
import { parsePrinterConfiguration, type PrinterConfigurationLoadResult } from './printers/printer-configuration'
import type { PrinterConfiguration } from '../shared/contracts'

export type { PendingReceipt, PendingReceiptLoadResult } from './pending-receipt'
export type { ActiveAssignment, ActiveAssignmentLoadResult } from './active-assignment'
export type { PrinterConfigurationLoadResult } from './printers/printer-configuration'

export interface LocalSettings {
  startWithWindows: boolean
  deviceMetadata?: SafeDeviceMetadata
  pendingReceipt?: PendingReceipt
  activeAssignment?: ActiveAssignment
  printerConfiguration?: PrinterConfiguration
}

export interface SettingsStore {
  getStartWithWindows(): boolean
  setStartWithWindows(enabled: boolean): void
  getDeviceMetadata(): SafeDeviceMetadata | null
  setDeviceMetadata(metadata: SafeDeviceMetadata): void
  clearDeviceMetadata(): void
  getPendingReceipt(): PendingReceiptLoadResult
  setPendingReceipt(receipt: PendingReceipt): void
  clearPendingReceipt(): void
  getActiveAssignment(): ActiveAssignmentLoadResult
  setActiveAssignment(assignment: ActiveAssignment): void
  clearActiveAssignment(): void
  getPrinterConfiguration(): PrinterConfigurationLoadResult
  setPrinterConfiguration(configuration: PrinterConfiguration): void
  clearPrinterConfiguration(): void
}

export class ElectronSettingsStore implements SettingsStore {
  private readonly store = new Store<LocalSettings>({
    name: 'settings',
    defaults: { startWithWindows: true }
  })

  getStartWithWindows(): boolean {
    return this.store.get('startWithWindows')
  }

  setStartWithWindows(enabled: boolean): void {
    this.store.set('startWithWindows', enabled)
  }

  getDeviceMetadata(): SafeDeviceMetadata | null {
    return this.store.get('deviceMetadata') ?? null
  }

  setDeviceMetadata(metadata: SafeDeviceMetadata): void {
    this.store.set('deviceMetadata', metadata)
  }

  clearDeviceMetadata(): void {
    this.store.delete('deviceMetadata')
  }

  getPendingReceipt(): PendingReceiptLoadResult {
    try {
      return parsePendingReceipt(this.store.get('pendingReceipt'))
    } catch {
      return { kind: 'invalid' }
    }
  }

  setPendingReceipt(receipt: PendingReceipt): void {
    if (parsePendingReceipt(receipt).kind !== 'valid') {
      throw new Error('Pending receipt metadata is invalid.')
    }
    this.store.set('pendingReceipt', receipt)
  }

  clearPendingReceipt(): void {
    this.store.delete('pendingReceipt')
  }

  getActiveAssignment(): ActiveAssignmentLoadResult {
    try {
      return parseActiveAssignment(this.store.get('activeAssignment'))
    } catch {
      return { kind: 'invalid' }
    }
  }

  setActiveAssignment(assignment: ActiveAssignment): void {
    if (parseActiveAssignment(assignment).kind !== 'valid') {
      throw new Error('Active assignment metadata is invalid.')
    }
    this.store.set('activeAssignment', assignment)
  }

  clearActiveAssignment(): void {
    this.store.delete('activeAssignment')
  }

  getPrinterConfiguration(): PrinterConfigurationLoadResult {
    try { return parsePrinterConfiguration(this.store.get('printerConfiguration')) } catch { return { kind: 'invalid' } }
  }

  setPrinterConfiguration(configuration: PrinterConfiguration): void {
    if (parsePrinterConfiguration(configuration).kind !== 'valid') throw new Error('Printer configuration is invalid.')
    this.store.set('printerConfiguration', configuration)
  }

  clearPrinterConfiguration(): void { this.store.delete('printerConfiguration') }
}
