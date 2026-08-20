import {
  DiscardCleanupWorkflow,
  ManageCleanupWorkflow,
  ResumeCleanupWorkflow,
} from '@/application';
import { ExpoEncryptedCleanupWorkflowRepository } from '@/infrastructure/workflows/expo';
import { ExpoCryptoIdGenerator } from '@/infrastructure/system/expo-crypto-id-generator';
import { SystemClock } from '@/infrastructure/system/system-clock';
import { backupStore } from './contact-backup';

const workflowRepository = new ExpoEncryptedCleanupWorkflowRepository();

export const manageCleanupWorkflow = new ManageCleanupWorkflow(
  workflowRepository,
  new SystemClock(),
  new ExpoCryptoIdGenerator(),
);

export const resumeCleanupWorkflow = new ResumeCleanupWorkflow(
  workflowRepository,
  backupStore,
);

export const discardCleanupWorkflow = new DiscardCleanupWorkflow(workflowRepository);
