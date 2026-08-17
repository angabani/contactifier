import { useCallback, useEffect, useState } from 'react';

import { listContactBackups, previewContactRestore } from '@/composition/contact-backup';
import type { BackupManifest, ContactRestorePlan } from '@/domain';

export type BackupHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly backups: readonly BackupManifest[] }
  | { readonly status: 'previewing'; readonly backups: readonly BackupManifest[] }
  | {
      readonly status: 'preview';
      readonly backups: readonly BackupManifest[];
      readonly manifest: BackupManifest;
      readonly plan: ContactRestorePlan;
    }
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
      const plan = await previewContactRestore.execute(manifest);
      setState({ status: 'preview', backups, manifest, plan });
    } catch {
      setState({ status: 'error' });
    }
  }, [state]);

  return { state, preview };
}
