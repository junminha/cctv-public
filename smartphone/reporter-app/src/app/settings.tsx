import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ArrowLeft, Camera, Mic, Video } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Toggle, styles as ui } from '@/components/ui';
import { useSession } from '@/session';
import { color, type } from '@/theme';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { prefs, updatePrefs, signOut } = useSession();
  const setDefault = (key: keyof typeof prefs.defaults, on: boolean) => updatePrefs({ defaults: { ...prefs.defaults, [key]: on } });

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <View style={[ui.row, { paddingHorizontal: 12, paddingVertical: 4, gap: 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={24} color={color.ink} />
        </Pressable>
        <Text style={[type.section, { color: color.ink }]} accessibilityRole="header">
          설정
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8, gap: 14 }}>
        <Card style={{ gap: 2 }}>
          <Toggle label="첨부 자료 사용 동의" sub="분석을 위해 OpenAI로 전송돼요. 끄면 첨부 버튼이 보이지 않아요" on={prefs.consent} onChange={(on) => updatePrefs({ consent: on })} />
          <View style={styles.divider} />
          <Text style={[type.field, { color: color.inkSoft, paddingTop: 12, paddingBottom: 4 }]}>신고 화면에 보일 첨부 버튼</Text>
          <Toggle icon={Camera} label="사진" on={prefs.defaults.photo} onChange={(on) => setDefault('photo', on)} />
          <Toggle icon={Mic} label="녹음" on={prefs.defaults.audio} onChange={(on) => setDefault('audio', on)} />
          <Toggle icon={Video} label="짧은 영상" sub="최대 30초" on={prefs.defaults.video} onChange={(on) => setDefault('video', on)} />
        </Card>
        <Card style={{ gap: 10 }}>
          <Text style={[type.card, { color: color.ink }]}>계정</Text>
          {[
            ['아이디', prefs.username ?? '-'],
            ['앱 버전', Constants.expoConfig?.version ?? '-'],
          ].map(([key, value]) => (
            <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[type.small, { color: color.inkSoft, width: 64 }]}>{key}</Text>
              <Text style={[type.number, { color: color.ink }]}>{value}</Text>
            </View>
          ))}
          <Button
            label="로그아웃"
            variant="secondary"
            onPress={async () => {
              await signOut();
              router.replace('/login');
            }}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: color.rule, marginTop: 6 },
});
