import {
  CreatePerChangeCleanupWorkflows,
  DiscardCleanupWorkflow,
  ManageCleanupWorkflow,
  ResumeCleanupWorkflow,
} from '@/application';
import { ExpoEncryptedCleanupWorkflowRepository } from '@/infrastructure/workflows/expo';
import { ExpoCryptoIdGenerator } from '@/infrastructure/system/expo-crypto-id-generator';
import { SystemClock } from '@/infrastructure/system/system-clock';
import { backupStore } from './contact-backup';

export const workflowRepository = new ExpoEncryptedCleanupWorkflowRepository();
const workflowClock = new SystemClock();
const workflowIdGenerator = new ExpoCryptoIdGenerator();

export const manageCleanupWorkflow = new ManageCleanupWorkflow(
  workflowRepository,
  workflowClock,
  workflowIdGenerator,
);

export const resumeCleanupWorkflow = new ResumeCleanupWorkflow(
  workflowRepository,
  backupStore,
);

export const discardCleanupWorkflow = new DiscardCleanupWorkflow(workflowRepository);

export const createPerChangeCleanupWorkflows = new CreatePerChangeCleanupWorkflows(
  workflowRepository,
  workflowClock,
  workflowIdGenerator,
);
