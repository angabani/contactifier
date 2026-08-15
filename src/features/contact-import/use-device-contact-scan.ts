import { useCallback, useState } from 'react';

import { readDeviceContacts } from '@/composition/device-contact-scan';
import type { ContactSnapshot } from '@/domain';
import { ContactPermissionDeniedError } from '@/infrastructure/contacts/expo';

export type DeviceContactScanState =
  | { readonly status: 'idle' }
  | { readonly status: 'scanning' }
  | { readonly status: 'success'; readonly snapshot: ContactSnapshot }
  | { readonly status: 'permission-denied'; readonly canAskAgain: boolean }
  | { readonly status: 'error' };

export function useDeviceContactScan() {
  const [state, setState] = useState<DeviceContactScanState>({ status: 'idle' });

  const scan = useCallback(async () => {
    setState({ status: 'scanning' });
    try {
      const snapshot = await readDeviceContacts.execute({ source: { kind: 'device' } });
      setState({ status: 'success', snapshot });
    } catch (error) {
      if (error instanceof ContactPermissionDeniedError) {
        setState({ status: 'permission-denied', canAskAgain: error.canAskAgain });
        return;
      }
      setState({ status: 'error' });
    }
  }, []);

  return { state, scan };
}
