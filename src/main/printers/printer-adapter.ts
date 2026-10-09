export interface PrinterRequest {
  jobId: string
  attemptId: string
  document: { kind: 'SYNTHETIC_TEST' }
}

export type PrinterResult =
  | { status: 'SUCCESS' }
  | { status: 'FAILURE'; code: string; message?: string }
  | { status: 'UNKNOWN'; code: string; message?: string }

export interface PrinterAdapter {
  print(request: PrinterRequest): Promise<PrinterResult>
}
