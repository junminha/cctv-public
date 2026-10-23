import { router } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { auth, ApiError } from '@/api';
import { Hero, Sheet } from '@/components/Hero';
import { Button, Field, Note } from '@/components/ui';
import { useSession } from '@/session';
import { color, type } from '@/theme';

export default function Signup() {
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const id = username.trim().toLowerCase();
    if (!/^[a-z0-9]{4,20}$/.test(id)) return setError('아이디는 영문 소문자와 숫자로 4~20자예요.');
    if (password.length < 8) return setError('비밀번호는 8자 이상이어야 해요.');
    if (password !== confirm) return setError('비밀번호 확인이 일치하지 않아요.');
    setError(null);
    setBusy(true);
    try {
      const result = await auth.signup(id, password);
      await signIn(result.username, result.token, true);
      router.replace('/setup');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '가입하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.night }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        <Hero height={220} step="1 / 2  계정" title="회원가입" sub="아이디와 비밀번호만 만들어요." />
        <Sheet>
          <Field label="아이디" placeholder="영문 소문자·숫자 4~20자" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
          <Field label="비밀번호" placeholder="8자 이상" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" />
          <Field label="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력" value={confirm} onChangeText={setConfirm} secureTextEntry />
          {error && (
            <Text style={[type.small, { color: color.alert }]} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Note icon={TriangleAlert}>이메일이나 전화번호는 받지 않아요. 비밀번호를 잊으면 새로 가입하거나 담당자에게 초기화를 요청해야 해요.</Note>
          <View style={{ flex: 1, minHeight: 24 }} />
          <Button label="다음" onPress={submit} busy={busy} />
        </Sheet>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
