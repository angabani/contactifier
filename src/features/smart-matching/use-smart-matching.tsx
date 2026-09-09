import { createContext, createElement, type PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';

import type { SmartMatchingState } from '@/application';
import { smartMatching } from '@/composition/smart-matching';

interface SmartMatchingSession {
  readonly state: SmartMatchingState | null;
  readonly enable: () => Promise<void>;
  readonly disable: () => Promise<void>;
}

const SmartMatchingContext = createContext<SmartMatchingSession | null>(null);

export function SmartMatchingProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<SmartMatchingState | null>(null);

  useEffect(() => {
    let active = true;
    void smartMatching.load().then((value) => { if (active) setState(value); });
    return () => { active = false; };
  }, []);

  const enable = useCallback(async () => {
    setState(await smartMatching.enable(setState));
  }, []);
  const disable = useCallback(async () => {
    setState(await smartMatching.disable());
  }, []);

  return createElement(
    SmartMatchingContext.Provider,
    { value: { state, enable, disable } },
    children,
  );
}

export function useSmartMatching(): SmartMatchingSession {
  const value = useContext(SmartMatchingContext);
  if (!value) throw new Error('useSmartMatching must be used inside SmartMatchingProvider.');
  return value;
}
