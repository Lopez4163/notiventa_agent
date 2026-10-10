import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { InMemoryShippingLabel } from './shipping-label-download-service'

const POINTS_PER_INCH = 72
const EXPECTED_WIDTH_POINTS = 4 * POINTS_PER_INCH
const EXPECTED_HEIGHT_POINTS = 6 * POINTS_PER_INCH
const DIMENSION_TOLERANCE_POINTS = 0.5
const DEFAULT_LEASE_TIMEOUT_MS = 60_000
const PREPARED_LABEL_FILENAME = 'shipping-label.pdf'

export type ShippingLabelPreparationErrorCode =
  | 'INVALID_PDF_DOCUMENT'
  | 'UNSUPPORTED_PAGE_COUNT'
  | 'UNSUPPORTED_PAGE_GEOMETRY'
  | 'LABEL_PREPARATION_FAILED'
  | 'LABEL_PREPARATION_TIMEOUT'
  | 'LABEL_CLEANUP_FAILED'

export class ShippingLabelPreparationError extends Error {
  constructor(
    message: string,
    readonly code: ShippingLabelPreparationErrorCode
  ) {
    super(message)
  }
}

export interface PreparedShippingLabel {
  readonly jobId: string
  readonly attemptId: string
  readonly shipmentId: string
  readonly orderId: string | null
  /** Main-process-only, Agent-owned temporary PDF path. */
  readonly documentPath: string
  readonly pageCount: 1
  readonly geometry: {
    readonly widthInches: 4
    readonly heightInches: 6
    readonly orientation: 'PORTRAIT'
    readonly sourceRotationDegrees: 0 | 90 | 180 | 270
    readonly scale: 1
  }
}

export interface CurrentShippingLabelSource {
  withCurrentLabel<T>(consumer: (label: InMemoryShippingLabel) => T | Promise<T>): Promise<T>
}

export interface ShippingLabelPreparationDependencies {
  leaseTimeoutMs?: number
  temporaryRoot?: string
}

/**
 * Validates one downloaded label and exposes a private print document only for
 * the duration of the supplied Main-process callback. It never submits a print.
 */
export class ShippingLabelPreparationService {
  private readonly leaseTimeoutMs: number
  private readonly temporaryRoot: string

  constructor(
    private readonly labels: CurrentShippingLabelSource,
    dependencies: ShippingLabelPreparationDependencies = {}
  ) {
    this.leaseTimeoutMs = dependencies.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS
    this.temporaryRoot = dependencies.temporaryRoot ?? tmpdir()
  }

  async withPreparedCurrentLabel<T>(
    consumer: (label: PreparedShippingLabel) => T | Promise<T>
  ): Promise<T> {
    return this.labels.withCurrentLabel(async (label) => {
      const geometry = await inspectFourBySixPdf(label.bytes)
      let temporaryDirectory: string | null = null
      let documentPath: string
      try {
        temporaryDirectory = await mkdtemp(join(this.temporaryRoot, 'notiventa-label-'))
        await chmod(temporaryDirectory, 0o700)
        documentPath = join(temporaryDirectory, PREPARED_LABEL_FILENAME)
        await writeFile(documentPath, label.bytes, { flag: 'wx', mode: 0o600 })
        await access(documentPath)
      } catch {
        if (temporaryDirectory) {
          await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
        }
        throw new ShippingLabelPreparationError(
          'The shipping label could not be prepared safely.',
          'LABEL_PREPARATION_FAILED'
        )
      }

      try {
        return await consumeWithTimeout(
          consumer({
            jobId: label.jobId,
            attemptId: label.attemptId,
            shipmentId: label.shipmentId,
            orderId: label.orderId,
            documentPath,
            pageCount: 1,
            geometry
          }),
          this.leaseTimeoutMs
        )
      } finally {
        try {
          await rm(temporaryDirectory, { recursive: true, force: true })
        } catch {
          throw new ShippingLabelPreparationError(
            'The temporary shipping label could not be removed safely.',
            'LABEL_CLEANUP_FAILED'
          )
        }
      }
    })
  }
}

async function inspectFourBySixPdf(
  bytes: Uint8Array
): Promise<PreparedShippingLabel['geometry']> {
  let document: PDFDocument
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
      capNumbers: true
    })
  } catch {
    throw new ShippingLabelPreparationError(
      'The shipping label PDF is malformed or unsupported.',
      'INVALID_PDF_DOCUMENT'
    )
  }

  const pages = document.getPages()
  if (pages.length !== 1) {
    throw new ShippingLabelPreparationError(
      'Only single-page shipping labels are supported.',
      'UNSUPPORTED_PAGE_COUNT'
    )
  }

  const page = pages[0]
  const mediaBox = page.getMediaBox()
  const cropBox = page.getCropBox()
  const rotation = normalizeRotation(page.getRotation().angle)
  if (
    rotation === null ||
    !validBox(mediaBox) ||
    !validBox(cropBox) ||
    !sameBox(mediaBox, cropBox)
  ) {
    throw unsupportedGeometry()
  }

  const swapsDimensions = rotation === 90 || rotation === 270
  const displayedWidth = swapsDimensions ? cropBox.height : cropBox.width
  const displayedHeight = swapsDimensions ? cropBox.width : cropBox.height
  if (
    !approximately(displayedWidth, EXPECTED_WIDTH_POINTS) ||
    !approximately(displayedHeight, EXPECTED_HEIGHT_POINTS)
  ) {
    throw unsupportedGeometry()
  }

  return {
    widthInches: 4,
    heightInches: 6,
    orientation: 'PORTRAIT',
    sourceRotationDegrees: rotation,
    scale: 1
  }
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 | null {
  if (!Number.isFinite(value)) return null
  const normalized = ((value % 360) + 360) % 360
  return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : null
}

interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

function validBox(box: PageBox): boolean {
  return Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
}

function sameBox(left: PageBox, right: PageBox): boolean {
  return approximately(left.x, right.x) &&
    approximately(left.y, right.y) &&
    approximately(left.width, right.width) &&
    approximately(left.height, right.height)
}

function approximately(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= DIMENSION_TOLERANCE_POINTS
}

function unsupportedGeometry(): ShippingLabelPreparationError {
  return new ShippingLabelPreparationError(
    'The shipping label is not a supported 4 × 6 portrait document.',
    'UNSUPPORTED_PAGE_GEOMETRY'
  )
}

function consumeWithTimeout<T>(value: T | Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(() => {
      settle(() => reject(new ShippingLabelPreparationError(
        'Shipping-label preparation expired before it could be used.',
        'LABEL_PREPARATION_TIMEOUT'
      )))
    }, timeoutMs)
    Promise.resolve(value).then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => settle(() => reject(error))
    )
  })
}
