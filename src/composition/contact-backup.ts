import {
  CreateContactBackup,
  ListContactBackups,
  LoadContactBackup,
  PreviewContactRestore,
} from '@/application';
import { readDeviceContacts } from './device-contact-scan';
import { ExpoEncryptedBackupStore } from '@/infrastructure/backups/expo';

const backupStore = new ExpoEncryptedBackupStore();

export const createContactBackup = new CreateContactBackup(backupStore, 100);
export const loadContactBackup = new LoadContactBackup(backupStore);
export const listContactBackups = new ListContactBackups(backupStore);
export const previewContactRestore = new PreviewContactRestore(
  loadContactBackup,
  readDeviceContacts,
);
