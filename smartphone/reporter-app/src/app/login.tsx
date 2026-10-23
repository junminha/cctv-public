import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { auth, ApiError } from '@/api';
import { Hero, Sheet } from '@/components/Hero';
import { Button, Field } from '@/components/ui';
import { useSession } from '@/session';
import { color, type } from '@/theme';

export default function Login() {
  const { signIn, prefs } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!username || !password) return setError('아이디와 비밀번호를 입력해 주세요.');
    setBusy(true);
    try {
      const id = username.trim().toLowerCase();
      const result = await auth.login(id, password);
      const ready = prefs.username === result.username && prefs.setupDone;
      await signIn(result.username, result.token, false);
      router.replace(ready ? '/(tabs)' : '/setup');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '로그인하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.night }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        <Hero height={300} title="시민 안전 신고" sub="미리 로그인해 두면 위급할 때 앱을 열자마자 위치를 보낼 수 있어요." />
        <Sheet>
          <Field label="아이디" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" />
          <Field label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          {error ? (
            <Text style={[type.small, { color: color.alert }]} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : (
            <Text style={[type.small, { color: color.inkSoft }]}>한 번 로그인하면 로그아웃 전까지 유지돼요</Text>
          )}
          <View style={{ flex: 1, minHeight: 24 }} />
          <Button label="로그인" onPress={submit} busy={busy} />
          <Button label="회원가입" variant="secondary" onPress={() => router.push('/signup')} />
        </Sheet>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
