import {
  createContext,
  createElement,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from 'react';

import {
  createContactBackup,
  listContactBackups,
  loadContactBackup,
} from '@/composition/contact-backup';
import { readDeviceContacts } from '@/composition/device-contact-scan';
import {
  analyzeExactDuplicates,
  analyzeContactQuality,
  compareContactSnapshots,
  isSameContactSource,
  type BackupManifest,
  type ContactSnapshot,
  type ContactSnapshotDelta,
  type ContactQualityAnalysis,
  type ExactDuplicateAnalysis,
} from '@/domain';
import { ContactPermissionDeniedError } from '@/infrastructure/contacts/expo';

import {
  createDemoContactSnapshot,
  createDemoPreviousContactSnapshot,
} from './demo-contact-data';

export type DeviceContactScanState =
  | { readonly status: 'idle' }
  | { readonly status: 'scanning' }
  | {
      readonly status: 'backing-up';
      readonly completedContacts: number;
      readonly totalContacts: number;
      readonly phase: 'encrypting' | 'verifying';
    }
  | {
      readonly status: 'success';
      readonly mode: 'device' | 'demo';
      readonly snapshot: ContactSnapshot;
      readonly analysis: ExactDuplicateAnalysis;
      readonly quality: ContactQualityAnalysis;
      readonly delta: ContactSnapshotDelta;
      readonly backup?: BackupManifest;
    }
  | { readonly status: 'permission-denied'; readonly canAskAgain: boolean }
  | { readonly status: 'backup-error' }
  | { readonly status: 'error' };

export function useDeviceContactScan() {
  const [state, setState] = useState<DeviceContactScanState>({ status: 'idle' });

  const scan = useCallback(async () => {
    setState({ status: 'scanning' });
    try {
      const snapshot = await readDeviceContacts.execute({ source: { kind: 'device' } });
      try {
        const latestBackup = (await listContactBackups.execute()).find(({ source }) =>
          isSameContactSource(source, snapshot.source),
        );
        const previousSnapshot = latestBackup
          ? await loadContactBackup.execute(latestBackup)
          : null;
        const delta = compareContactSnapshots(previousSnapshot, snapshot);
        const backup = await createContactBackup.execute({
          snapshot,
          onProgress: ({ phase, completedContacts, totalContacts }) => {
            setState({ status: 'backing-up', phase, completedContacts, totalContacts });
          },
        });
        setState({
          status: 'success',
          mode: 'device',
          snapshot,
          backup,
          delta,
          analysis: analyzeExactDuplicates(snapshot),
          quality: analyzeContactQuality(snapshot),
        });
      } catch {
        setState({ status: 'backup-error' });
        return;
      }
    } catch (error) {
      if (error instanceof ContactPermissionDeniedError) {
        setState({ status: 'permission-denied', canAskAgain: error.canAskAgain });
        return;
      }
      setState({ status: 'error' });
    }
  }, []);

  const loadDemo = useCallback(() => {
    const snapshot = createDemoContactSnapshot();
    const delta = compareContactSnapshots(createDemoPreviousContactSnapshot(), snapshot);
    setState({
      status: 'success',
      mode: 'demo',
      snapshot,
      delta,
      analysis: analyzeExactDuplicates(snapshot),
      quality: analyzeContactQuality(snapshot),
    });
  }, []);

  return { state, scan, loadDemo };
}

type DeviceContactScanSession = ReturnType<typeof useDeviceContactScan>;

const DeviceContactScanContext = createContext<DeviceContactScanSession | null>(null);

export function DeviceContactScanProvider({ children }: PropsWithChildren) {
  const value = useDeviceContactScan();
  return createElement(DeviceContactScanContext.Provider, { value }, children);
}

export function useDeviceContactScanSession(): DeviceContactScanSession {
  const session = useContext(DeviceContactScanContext);
  if (!session) {
    throw new Error('useDeviceContactScanSession must be used inside DeviceContactScanProvider.');
  }
  return session;
}
