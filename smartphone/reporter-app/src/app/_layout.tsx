import { BlackHanSans_400Regular } from '@expo-google-fonts/black-han-sans';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSansKR_400Regular,
  IBMPlexSansKR_500Medium,
  IBMPlexSansKR_600SemiBold,
  IBMPlexSansKR_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-kr';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DraftProvider } from '@/draft';
import { SessionProvider, useSession } from '@/session';
import { color } from '@/theme';

function Navigator() {
  const { ready } = useSession();
  if (!ready) return <View style={{ flex: 1, backgroundColor: color.night }} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}>
      <Stack.Screen name="location" options={{ animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    BlackHanSans_400Regular,
    IBMPlexSansKR_400Regular,
    IBMPlexSansKR_500Medium,
    IBMPlexSansKR_600SemiBold,
    IBMPlexSansKR_700Bold,
    IBMPlexMono_500Medium,
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: color.night }} />;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <DraftProvider>
          <StatusBar style="auto" />
          <Navigator />
        </DraftProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
