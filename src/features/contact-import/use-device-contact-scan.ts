import {
  createContext,
  createElement,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Platform } from 'react-native';

import {
  createContactBackup,
  listContactBackups,
  loadContactBackup,
} from '@/composition/contact-backup';
import {
  discardCleanupWorkflow,
  manageCleanupWorkflow,
  resumeCleanupWorkflow,
} from '@/composition/cleanup-workflow';
import { ContactPermissionDeniedError, type CleanupWorkflowSummary } from '@/application';
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

import {
  createDemoContactSnapshot,
  createDemoBackupManifest,
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
      readonly backup: BackupManifest;
    }
  | { readonly status: 'permission-denied'; readonly canAskAgain: boolean }
  | { readonly status: 'backup-error' }
  | { readonly status: 'error' };

export function useDeviceContactScan() {
  const [state, setState] = useState<DeviceContactScanState>({ status: 'idle' });
  const [resumableWorkflow, setResumableWorkflow] = useState<CleanupWorkflowSummary | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState(false);
  const [isDiscardingWorkflow, setIsDiscardingWorkflow] = useState(false);
  const [discardWorkflowError, setDiscardWorkflowError] = useState(false);

  const refreshResumableWorkflow = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const [latest] = await manageCleanupWorkflow.listResumable();
      setResumableWorkflow(latest ?? null);
    } catch {
      setResumableWorkflow(null);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void manageCleanupWorkflow
      .listResumable()
      .then(([latest]) => {
        if (active) setResumableWorkflow(latest ?? null);
      })
      .catch(() => {
        if (active) setResumableWorkflow(null);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const invalidateScan = useCallback(() => {
    setState({ status: 'idle' });
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
      backup: createDemoBackupManifest(),
    });
  }, []);

  const resume = useCallback(async (): Promise<boolean> => {
    if (!resumableWorkflow) return false;
    setIsResuming(true);
    setResumeError(false);
    try {
      const { backup, snapshot } = await resumeCleanupWorkflow.execute(resumableWorkflow.id);
      setState({
        status: 'success',
        mode: 'device',
        snapshot,
        backup,
        delta: compareContactSnapshots(null, snapshot),
        analysis: analyzeExactDuplicates(snapshot),
        quality: analyzeContactQuality(snapshot),
      });
      return true;
    } catch {
      setResumeError(true);
      return false;
    } finally {
      setIsResuming(false);
    }
  }, [resumableWorkflow]);

  const discardResumableWorkflow = useCallback(async (): Promise<void> => {
    if (!resumableWorkflow) return;
    setIsDiscardingWorkflow(true);
    setDiscardWorkflowError(false);
    try {
      await discardCleanupWorkflow.execute(resumableWorkflow.id);
      setResumableWorkflow(null);
    } catch {
      setDiscardWorkflowError(true);
    } finally {
      setIsDiscardingWorkflow(false);
    }
  }, [resumableWorkflow]);

  return {
    state,
    scan,
    invalidateScan,
    loadDemo,
    resumableWorkflow,
    isResuming,
    resumeError,
    resume,
    isDiscardingWorkflow,
    discardWorkflowError,
    discardResumableWorkflow,
    refreshResumableWorkflow,
  };
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
