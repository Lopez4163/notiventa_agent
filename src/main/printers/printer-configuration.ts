import type { PrinterConfiguration } from '../../shared/contracts'

export const SHIPPING_LABEL_4X6_PROFILE = {
  printType: 'SHIPPING_LABEL', width: 4, height: 6, unit: 'INCH'
} as const

export type PrinterConfigurationLoadResult =
  | { kind: 'none' }
  | { kind: 'valid'; configuration: PrinterConfiguration }
  | { kind: 'invalid' }

export function parsePrinterConfiguration(value: unknown): PrinterConfigurationLoadResult {
  if (value === undefined || value === null) return { kind: 'none' }
  if (!value || typeof value !== 'object') return { kind: 'invalid' }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.systemName !== 'string' || candidate.systemName.trim().length === 0 || !candidate.profile || typeof candidate.profile !== 'object') {
    return { kind: 'invalid' }
  }
  const profile = candidate.profile as Record<string, unknown>
  if (profile.printType !== 'SHIPPING_LABEL' || profile.width !== 4 || profile.height !== 6 || profile.unit !== 'INCH') {
    return { kind: 'invalid' }
  }
  return { kind: 'valid', configuration: { systemName: candidate.systemName, profile: SHIPPING_LABEL_4X6_PROFILE } }
}
