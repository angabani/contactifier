import { useCallback, useEffect, useState } from 'react';

import { listContactBackups } from '@/composition/contact-backup';
import {
  previewSimulatorFixtureBackupRestore,
  restoreSimulatorFixtureBackup,
} from '@/composition/simulator-contact-write';
import { createContactRestorePlan, type BackupManifest, type ContactRestorePlan } from '@/domain';

export type BackupHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly backups: readonly BackupManifest[] }
  | { readonly status: 'previewing'; readonly backups: readonly BackupManifest[] }
  | {
      readonly status: 'preview';
      readonly backups: readonly BackupManifest[];
      readonly manifest: BackupManifest;
      readonly plan: ContactRestorePlan;
      readonly derivedDeleteCount: number;
    }
  | { readonly status: 'restoring'; readonly backups: readonly BackupManifest[]; readonly manifest: BackupManifest; readonly plan: ContactRestorePlan; readonly derivedDeleteCount: number }
  | { readonly status: 'restored'; readonly backups: readonly BackupManifest[]; readonly completedCount: number; readonly attentionCount: number }
  | { readonly status: 'error' };

export function useBackupHistory() {
  const [state, setState] = useState<BackupHistoryState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void listContactBackups
      .execute()
      .then((backups) => active && setState({ status: 'ready', backups }))
      .catch(() => active && setState({ status: 'error' }));
    return () => {
      active = false;
    };
  }, []);

  const preview = useCallback(async (manifest: BackupManifest) => {
    const backups = 'backups' in state ? state.backups : [];
    setState({ status: 'previewing', backups });
    try {
      const verified = await previewSimulatorFixtureBackupRestore(manifest);
      const plan = createContactRestorePlan(
        verified.backupSnapshot,
        verified.currentSnapshot,
        verified.sourceAliases,
      );
      setState({
        status: 'preview', backups, manifest, plan,
        derivedDeleteCount: verified.derivedContactsToDelete.length,
      });
    } catch {
      setState({ status: 'error' });
    }
  }, [state]);

  const restore = useCallback(async () => {
    if (state.status !== 'preview') return;
    const { backups, manifest, plan, derivedDeleteCount } = state;
    setState({ status: 'restoring', backups, manifest, plan, derivedDeleteCount });
    try {
      const result = await restoreSimulatorFixtureBackup(manifest);
      setState({
        status: 'restored', backups,
        completedCount: result.completedCount,
        attentionCount: result.attentionCount + result.rolledBackCount,
      });
    } catch {
      setState({ status: 'error' });
    }
  }, [state]);

  return { state, preview, restore };
}
