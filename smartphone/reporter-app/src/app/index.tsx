import { Redirect } from 'expo-router';

import { useSession } from '@/session';

// Logged-in phones open straight on the report screen: no login step in an emergency.
export default function Launch() {
  const { token, prefs } = useSession();
  if (!token) return <Redirect href="/login" />;
  if (!prefs.setupDone) return <Redirect href="/setup" />;
  return <Redirect href="/(tabs)" />;
}
