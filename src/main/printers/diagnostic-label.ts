import { join, resolve } from 'node:path'
import type { WindowsPrintRequest } from './windows-printer-adapter'

export const DIAGNOSTIC_LABEL_FILENAME = 'diagnostic-label.html'

export interface DiagnosticLabelRuntimePaths {
  isPackaged: boolean
  /** Electron app.getAppPath(); the repository/application root in development. */
  appPath: string
  /** Electron process.resourcesPath; used only by packaged applications. */
  resourcesPath: string
}

export function resolveDiagnosticLabelPath(paths: DiagnosticLabelRuntimePaths): string {
  if (paths.isPackaged) {
    return resolve(paths.resourcesPath, 'diagnostic', DIAGNOSTIC_LABEL_FILENAME)
  }
  return resolve(paths.appPath, 'resources', DIAGNOSTIC_LABEL_FILENAME)
}

export function createDiagnosticLabelPrintRequest(
  paths: DiagnosticLabelRuntimePaths
): WindowsPrintRequest {
  return { documentPath: resolveDiagnosticLabelPath(paths) }
}

export const PACKAGED_DIAGNOSTIC_LABEL_RELATIVE_PATH = join(
  'diagnostic',
  DIAGNOSTIC_LABEL_FILENAME
)
