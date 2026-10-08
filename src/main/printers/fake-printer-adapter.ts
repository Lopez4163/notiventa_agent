import type { PrinterAdapter, PrinterRequest, PrinterResult } from './printer-adapter'

const fakeExecutionEnvironments = new Set(['test', 'testing', 'dev', 'development', 'local-validation'])

export function isFakeExecutionAllowed(environment: string): boolean {
  return fakeExecutionEnvironments.has(environment)
}

export class FakePrinterAdapter implements PrinterAdapter {
  private constructor(private readonly result: PrinterResult) {}

  static create(environment: string, result: PrinterResult): FakePrinterAdapter {
    if (!isFakeExecutionAllowed(environment)) {
      throw new Error('Fake printer execution is not allowed in this environment.')
    }
    return new FakePrinterAdapter(structuredClone(result))
  }

  async print(_request: PrinterRequest): Promise<PrinterResult> {
    return structuredClone(this.result)
  }
}
