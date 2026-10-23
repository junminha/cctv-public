import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Point = { latitude: number; longitude: number };
export type Gps = Point & { accuracy: number | null };

// Report location shared between the report screen and the full-screen location editor.
type Draft = {
  gps: Gps | null;
  point: Point | null;
  address: string | null;
  setGps: (gps: Gps | null) => void;
  setPoint: (point: Point, address?: string | null) => void;
  // Forget the location so the next report asks the phone again.
  reset: () => void;
};

const DraftContext = createContext<Draft | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [point, setPointState] = useState<Point | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const setPoint = useCallback((next: Point, label: string | null = null) => {
    setPointState(next);
    setAddress(label);
  }, []);
  const reset = useCallback(() => {
    setGps(null);
    setPointState(null);
    setAddress(null);
  }, []);
  const value = useMemo(() => ({ gps, point, address, setGps, setPoint, reset }), [gps, point, address, setPoint, reset]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error('useDraft must be used inside DraftProvider');
  return draft;
}
