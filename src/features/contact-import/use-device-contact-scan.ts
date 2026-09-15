import {
  createContext,
  createElement,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
import { loadSmartContactProbabilityModel } from '@/composition/smart-matching';
import {
  analyzeExactDuplicates,
  analyzeContactMatches,
  analyzeContactQuality,
  compareContactSnapshots,
  isSameContactSource,
  type BackupManifest,
  type ContactSnapshot,
  type ContactSnapshotDelta,
  type ContactQualityAnalysis,
  type ExactDuplicateAnalysis,
  type ContactMatchAnalysis,
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
      readonly matchAnalysis?: ContactMatchAnalysis;
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
  const checkedBaselineOnLaunch = useRef(false);

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

  const scan = useCallback(async ({ fullRescan = false }: { readonly fullRescan?: boolean } = {}) => {
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
        const focusContactIds = fullRescan
          ? new Set(snapshot.contacts.map(({ id }) => id))
          : new Set(delta.beautificationContactIds);
        const focusedSnapshot = {
          ...snapshot,
          contacts: snapshot.contacts.filter(({ id }) => focusContactIds.has(id)),
        };
        const model = await loadSmartContactProbabilityModel();
        const [analysis, matchAnalysis] = await Promise.all([
          Promise.resolve(analyzeExactDuplicates(snapshot, undefined, focusContactIds)),
          analyzeContactMatches(snapshot, { focusContactIds, model }),
        ]);
        setState({
          status: 'success',
          mode: 'device',
          snapshot,
          backup,
          delta,
          analysis,
          matchAnalysis,
          quality: analyzeContactQuality(focusedSnapshot),
        });
      } catch (error) {
        if (__DEV__) {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
          console.warn(`[contactifier-scan:backup] ${detail}`);
        }
        setState({ status: 'backup-error' });
        return;
      }
    } catch (error) {
      if (error instanceof ContactPermissionDeniedError) {
        setState({ status: 'permission-denied', canAskAgain: error.canAskAgain });
        return;
      }
      if (__DEV__) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
        console.warn(`[contactifier-scan:read] ${detail}`);
      }
      setState({ status: 'error' });
    }
  }, []);

  const refreshReturningSession = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const latestBackup = (await listContactBackups.execute()).find(
        ({ source }) => source.kind === 'device',
      );
      if (!latestBackup) return;

      setState({ status: 'scanning' });
      const snapshot = await readDeviceContacts.execute({ source: { kind: 'device' } });
      const previousSnapshot = await loadContactBackup.execute(latestBackup);
      const delta = compareContactSnapshots(previousSnapshot, snapshot);
      const focusContactIds = new Set(delta.beautificationContactIds);
      const focusedSnapshot = {
        ...snapshot,
        contacts: snapshot.contacts.filter(({ id }) => focusContactIds.has(id)),
      };
      const shouldAdvanceBaseline =
        focusContactIds.size > 0 || delta.deletedContactIds.length > 0;
      const backup = shouldAdvanceBaseline
        ? await createContactBackup.execute({
            snapshot,
            onProgress: ({ phase, completedContacts, totalContacts }) => {
              setState({ status: 'backing-up', phase, completedContacts, totalContacts });
            },
          })
        : latestBackup;
      const model = await loadSmartContactProbabilityModel();
      const [analysis, matchAnalysis] = await Promise.all([
        Promise.resolve(analyzeExactDuplicates(snapshot, undefined, focusContactIds)),
        analyzeContactMatches(snapshot, { focusContactIds, model }),
      ]);
      setState({
        status: 'success',
        mode: 'device',
        snapshot,
        backup,
        delta,
        analysis,
        matchAnalysis,
        quality: analyzeContactQuality(focusedSnapshot),
      });
    } catch (error) {
      if (error instanceof ContactPermissionDeniedError) {
        setState({ status: 'permission-denied', canAskAgain: error.canAskAgain });
        return;
      }
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    if (checkedBaselineOnLaunch.current) return;
    checkedBaselineOnLaunch.current = true;
    void refreshReturningSession();
  }, [refreshReturningSession]);

  const invalidateScan = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const rescoreWithSmartModel = useCallback(async () => {
    if (state.status !== 'success') return;
    const model = await loadSmartContactProbabilityModel();
    if (!model || state.matchAnalysis?.scoringMode === 'model') return;
    const focusContactIds = new Set(state.delta.beautificationContactIds);
    const matchAnalysis = await analyzeContactMatches(state.snapshot, { focusContactIds, model });
    setState((current) => current.status === 'success' && current.snapshot.id === state.snapshot.id
      ? { ...current, matchAnalysis }
      : current);
  }, [state]);

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
      setResumeError(false);
      setState({ status: 'idle' });
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
    rescoreWithSmartModel,
    refreshReturningSession,
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
