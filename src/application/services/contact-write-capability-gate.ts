import type { CleanupWorkflow } from '@/domain';

export type ContactWriterPlatform = 'android' | 'google' | 'ios' | 'simulation';

export interface ContactWriterCertification {
  readonly adapterId: string;
  readonly platform: ContactWriterPlatform;
  readonly contractVersion: 1;
  readonly enabled: boolean;
  readonly certifiedAt: string;
  readonly evidence: {
    readonly adapterContract: boolean;
    readonly backupRestore: boolean;
    readonly integrationTests: boolean;
    readonly permissionHandling: boolean;
    readonly postWriteVerification: boolean;
    readonly reconciliation: boolean;
    readonly rollback: boolean;
  };
}

export interface ContactWriteRuntimePrerequisites {
  readonly platform: ContactWriterPlatform;
  readonly fullContactAccess: boolean;
  readonly explicitUserConfirmation: boolean;
  readonly verifiedBackupId: string;
  readonly freshSnapshotId: string;
}

export type ContactWriteDenialReason =
  | 'adapter-disabled'
  | 'backup-mismatch'
  | 'certification-incomplete'
  | 'confirmation-required'
  | 'full-access-required'
  | 'invalid-certification'
  | 'platform-mismatch'
  | 'preflight-required'
  | 'snapshot-mismatch';

export class ContactWriteCapabilityError extends Error {
  constructor(readonly reasons: readonly ContactWriteDenialReason[]) {
    super(`Contact writing is not authorized: ${reasons.join(', ')}.`);
    this.name = 'ContactWriteCapabilityError';
  }
}

const authorizationIssuer = Symbol('ContactWriteAuthorizationIssuer');

export class ContactWriteAuthorization {
  readonly #authorized = true;

  constructor(
    issuer: symbol,
    private readonly adapterId: string,
    private readonly workflowId: string,
    private readonly planChangeSetId: string,
    private readonly expiresAt: number,
  ) {
    if (issuer !== authorizationIssuer) throw new ContactWriteCapabilityError(['preflight-required']);
  }

  assertMatches(workflow: CleanupWorkflow, adapterId: string, now: Date): void {
    if (
      !this.#authorized ||
      this.adapterId !== adapterId ||
      this.workflowId !== workflow.id ||
      this.planChangeSetId !== workflow.writePlan?.changeSetId ||
      now.getTime() > this.expiresAt
    ) {
      throw new ContactWriteCapabilityError(['preflight-required']);
    }
  }
}

export class ContactWriteCapabilityGate {
  constructor(private readonly authorizationLifetimeMs = 5 * 60 * 1000) {}

  authorize(input: {
    readonly workflow: CleanupWorkflow;
    readonly certification: ContactWriterCertification;
    readonly runtime: ContactWriteRuntimePrerequisites;
    readonly now: Date;
  }): ContactWriteAuthorization {
    return this.authorizeInternal(input, input.workflow.phase === 'preflighted');
  }

  authorizeFinalization(input: {
    readonly workflow: CleanupWorkflow;
    readonly certification: ContactWriterCertification;
    readonly runtime: ContactWriteRuntimePrerequisites;
    readonly now: Date;
  }): ContactWriteAuthorization {
    return this.authorizeInternal(
      input,
      input.workflow.phase === 'finalizing' ||
        (input.workflow.phase === 'failed' &&
          input.workflow.failure?.code === 'finalization-outcome-unknown'),
    );
  }

  authorizeVerification(input: {
    readonly workflow: CleanupWorkflow;
    readonly certification: ContactWriterCertification;
    readonly runtime: ContactWriteRuntimePrerequisites;
    readonly now: Date;
  }): ContactWriteAuthorization {
    return this.authorizeInternal(input, input.workflow.phase === 'verifying');
  }

  private authorizeInternal(input: {
    readonly workflow: CleanupWorkflow;
    readonly certification: ContactWriterCertification;
    readonly runtime: ContactWriteRuntimePrerequisites;
    readonly now: Date;
  }, phaseAllowed: boolean): ContactWriteAuthorization {
    const { workflow, certification, runtime, now } = input;
    const reasons: ContactWriteDenialReason[] = [];
    if (!phaseAllowed || !workflow.writePlan) reasons.push('preflight-required');
    if (!certification.enabled) reasons.push('adapter-disabled');
    if (
      certification.adapterId.trim().length === 0 ||
      certification.contractVersion !== 1 ||
      Number.isNaN(Date.parse(certification.certifiedAt))
    ) {
      reasons.push('invalid-certification');
    }
    if (certification.platform !== runtime.platform) reasons.push('platform-mismatch');
    if (Object.values(certification.evidence).some((value) => value !== true)) {
      reasons.push('certification-incomplete');
    }
    if (!runtime.fullContactAccess) reasons.push('full-access-required');
    if (!runtime.explicitUserConfirmation) reasons.push('confirmation-required');
    if (runtime.verifiedBackupId !== workflow.backupId) reasons.push('backup-mismatch');
    if (runtime.freshSnapshotId !== workflow.writePlan?.freshSnapshotId) {
      reasons.push('snapshot-mismatch');
    }
    if (reasons.length > 0) throw new ContactWriteCapabilityError(Object.freeze(reasons));
    const plan = workflow.writePlan;
    if (!plan) throw new ContactWriteCapabilityError(['preflight-required']);
    return new ContactWriteAuthorization(
      authorizationIssuer,
      certification.adapterId,
      workflow.id,
      plan.changeSetId,
      now.getTime() + this.authorizationLifetimeMs,
    );
  }
}
