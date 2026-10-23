import { router } from 'expo-router';
import { Camera, Check, Mic, Video } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Hero, Sheet } from '@/components/Hero';
import { Button, Card, Tile, styles } from '@/components/ui';
import { useSession } from '@/session';
import { color, type } from '@/theme';

export default function Setup() {
  const { prefs, updatePrefs } = useSession();
  const [defaults, setDefaults] = useState(prefs.defaults);
  const toggle = (key: keyof typeof defaults) => setDefaults((current) => ({ ...current, [key]: !current[key] }));

  async function finish(consent: boolean) {
    await updatePrefs({ consent, defaults, setupDone: true });
    router.replace('/(tabs)');
  }

  return (
    <ScrollView style={{ backgroundColor: color.night }} contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
      <Hero height={220} step="2 / 2  첨부 설정" title="빠른 신고 준비" sub="위급할 때 버튼 하나로 보낼 수 있게 미리 정해 두세요." />
      <Sheet>
        <Card style={{ gap: 10, padding: 16 }}>
          <Text style={[type.card, { color: color.ink }]}>첨부 자료 사용 동의</Text>
          {[
            '직접 촬영하거나 녹음한 자료만 보내요',
            '신고 확인과 AI 상황 분석에만 써요',
            '분석을 위해 신고 내용과 자료가 OpenAI로 전송돼요',
            '설정에서 언제든 바꿀 수 있어요',
          ].map((line) => (
            <View key={line} style={[styles.row, { gap: 8 }]}>
              <Check size={18} color={color.tide} />
              <Text style={[type.small, { color: color.ink, flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </Card>
        <Text style={[type.field, { color: color.ink }]}>신고 화면에 둘 첨부 버튼</Text>
        <View style={[styles.row, { gap: 11 }]}>
          <Tile icon={Camera} title="사진" sub="눌러서 촬영" on={defaults.photo} onPress={() => toggle('photo')} />
          <Tile icon={Mic} title="녹음" sub="눌러서 녹음" on={defaults.audio} onPress={() => toggle('audio')} />
          <Tile icon={Video} title="짧은 영상" sub="최대 30초" on={defaults.video} onPress={() => toggle('video')} />
        </View>
        <View style={{ flex: 1, minHeight: 24 }} />
        <Button label="동의하고 시작하기" onPress={() => finish(true)} />
        <Button label="첨부 없이 시작하기" variant="secondary" onPress={() => finish(false)} />
      </Sheet>
    </ScrollView>
  );
}
