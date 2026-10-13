import type { ReceivedPrintJob } from '../../shared/contracts'
import type { NotiVentaApiClient } from '../api-client'
import type { CredentialStore } from '../credential-store'
import type { SettingsStore } from '../settings-store'

export type ShippingLabelDownloadServiceErrorCode =
  | 'NO_RECEIVED_ASSIGNMENT'
  | 'DEVICE_CREDENTIAL_UNAVAILABLE'
  | 'ASSIGNMENT_CHANGED'

export class ShippingLabelDownloadServiceError extends Error {
  constructor(
    message: string,
    readonly code: ShippingLabelDownloadServiceErrorCode
  ) {
    super(message)
  }
}

export interface InMemoryShippingLabel {
  readonly jobId: string
  readonly attemptId: string
  readonly shipmentId: string
  readonly orderId: string | null
  /** Borrowed bytes. They are cleared immediately after the consumer settles. */
  readonly bytes: Uint8Array
}

export interface AttemptLabelDownloader {
  downloadAttemptLabel(credential: string, attemptId: string): Promise<Uint8Array>
}

/**
 * Downloads one label only for the durable active assignment. Active assignments
 * are persisted only after the backend acknowledges the attempt as RECEIVED.
 */
export class ShippingLabelDownloadService {
  constructor(
    private readonly api: Pick<NotiVentaApiClient, 'downloadAttemptLabel'> | AttemptLabelDownloader,
    private readonly credentials: CredentialStore,
    private readonly settings: SettingsStore
  ) {}

  async withCurrentLabel<T>(consumer: (label: InMemoryShippingLabel) => T | Promise<T>): Promise<T> {
    const assignment = this.requireCurrentAssignment()
    const credential = await this.getCredential()
    this.assertAssignmentUnchanged(assignment)

    const bytes = await this.api.downloadAttemptLabel(credential, assignment.attemptId)
    try {
      this.assertAssignmentUnchanged(assignment)
      return await consumer({
        jobId: assignment.jobId,
        attemptId: assignment.attemptId,
        shipmentId: assignment.shipmentId,
        orderId: assignment.orderId,
        bytes
      })
    } finally {
      bytes.fill(0)
    }
  }

  private requireCurrentAssignment(): ReceivedPrintJob {
    const active = this.settings.getActiveAssignment()
    if (active.kind !== 'valid') {
      throw new ShippingLabelDownloadServiceError(
        'No received print assignment is available for label download.',
        'NO_RECEIVED_ASSIGNMENT'
      )
    }
    return structuredClone(active.assignment.job)
  }

  private async getCredential(): Promise<string> {
    try {
      const credential = await this.credentials.get()
      if (credential) return credential
    } catch {
      // Native credential-store details must remain inside Main.
    }
    throw new ShippingLabelDownloadServiceError(
      'The Device credential is unavailable. Pair this computer again.',
      'DEVICE_CREDENTIAL_UNAVAILABLE'
    )
  }

  private assertAssignmentUnchanged(expected: ReceivedPrintJob): void {
    const current = this.settings.getActiveAssignment()
    if (current.kind !== 'valid' || !sameAssignment(current.assignment.job, expected)) {
      throw new ShippingLabelDownloadServiceError(
        'The active print assignment changed before the label was ready.',
        'ASSIGNMENT_CHANGED'
      )
    }
  }
}

function sameAssignment(left: ReceivedPrintJob, right: ReceivedPrintJob): boolean {
  return left.jobId === right.jobId &&
    left.attemptId === right.attemptId &&
    left.printType === right.printType &&
    left.shipmentId === right.shipmentId &&
    left.orderId === right.orderId
}
