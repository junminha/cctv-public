import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, auth, type AttachmentKind } from './api';
import { readJson, secret, writeJson } from './storage';

const TOKEN_KEY = 'reporter.token';
const PREFS_KEY = 'reporter.prefs';

export type Prefs = {
  username: string | null;
  setupDone: boolean;
  consent: boolean;
  // Which capture buttons the report screen shows.
  defaults: Record<AttachmentKind, boolean>;
};

const DEFAULT_PREFS: Prefs = { username: null, setupDone: false, consent: false, defaults: { photo: true, audio: true, video: false } };

type Session = {
  ready: boolean;
  token: string | null;
  prefs: Prefs;
  signIn: (username: string, token: string, isNew: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  updatePrefs: (changes: Partial<Prefs>) => Promise<void>;
  // True when the error was an expired login (the app has moved to the login screen).
  expired: (error: unknown) => boolean;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    Promise.all([secret.get(TOKEN_KEY), readJson(PREFS_KEY, DEFAULT_PREFS)]).then(([stored, saved]) => {
      setToken(stored);
      setPrefs(saved);
      setReady(true);
    });
  }, []);

  // Persist after every change once the saved copy has been loaded.
  useEffect(() => {
    if (ready) writeJson(PREFS_KEY, prefs).catch(() => undefined);
  }, [prefs, ready]);
  const updatePrefs = useCallback(async (changes: Partial<Prefs>) => setPrefs((current) => ({ ...current, ...changes })), []);

  const signIn = useCallback(
    async (username: string, issued: string, isNew: boolean) => {
      await secret.set(TOKEN_KEY, issued);
      // A new account (or a different person on this phone) goes through the attachment setup.
      const sameUser = prefs.username === username;
      await updatePrefs(isNew || !sameUser ? { ...DEFAULT_PREFS, username } : { username });
      setToken(issued);
    },
    [prefs.username, updatePrefs],
  );

  const signOut = useCallback(async () => {
    if (token) await auth.logout(token).catch(() => undefined);
    await secret.remove(TOKEN_KEY);
    setToken(null);
  }, [token]);

  const expired = useCallback((error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 401) return false;
    secret.remove(TOKEN_KEY).catch(() => undefined);
    setToken(null);
    router.replace('/login');
    return true;
  }, []);

  const value = useMemo(
    () => ({ ready, token, prefs, signIn, signOut, updatePrefs, expired }),
    [ready, token, prefs, signIn, signOut, updatePrefs, expired],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
