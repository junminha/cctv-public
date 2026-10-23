import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, Mic, Video } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, uploadAttachment } from '@/api';
import type { Captured } from '@/components/AttachmentPicker';
import { Button, Card, Rings, styles as ui } from '@/components/ui';
import { shortId, when } from '@/geo';
import { useSession } from '@/session';
import { color, radius, type } from '@/theme';

type State = 'waiting' | 'uploading' | 'done' | 'failed';
type Item = Captured & { state: State; progress: number; error?: string };

const ICON = { photo: Camera, audio: Mic, video: Video };

function parse(raw: string | undefined): Captured[] {
  try {
    return raw ? (JSON.parse(raw) as Captured[]) : [];
  } catch {
    return [];
  }
}

// The report is already received; this screen only uploads what was captured before sending.
export default function Sent() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { id, files, more } = useLocalSearchParams<{ id: string; files?: string; more?: string }>();
  const [items, setItems] = useState<Item[]>(() => parse(files).map((file) => ({ ...file, state: 'waiting', progress: 0 })));
  const [sentAt] = useState(() => new Date().toISOString());
  const busy = useRef(false);

  const patch = useCallback((index: number, changes: Partial<Item>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }, []);

  // One upload at a time keeps progress readable on a weak connection.
  useEffect(() => {
    const index = items.findIndex((item) => item.state === 'waiting');
    if (index < 0 || busy.current || !token) return;
    const item = items[index];
    busy.current = true;
    uploadAttachment(token, id, item, (progress) => patch(index, { state: 'uploading', progress, error: undefined }))
      .then(() => patch(index, { state: 'done', progress: 1 }))
      .catch((caught) => patch(index, { state: 'failed', error: caught instanceof ApiError ? caught.message : '보내지 못했어요.' }))
      .finally(() => {
        busy.current = false;
        // Wake the effect for the next waiting item.
        patch(index, {});
      });
  }, [id, items, patch, token]);

  const pending = items.some((item) => item.state === 'waiting' || item.state === 'uploading');

  return (
    <View style={{ flex: 1, backgroundColor: color.night }}>
      <View style={[styles.hero, { paddingTop: insets.top }]}>
        <View style={[styles.rings, { top: insets.top - 20 }]}>
          <Rings size={360} rings={[56, 92, 132, 176]} stroke={color.tide} center={false} />
        </View>
        <View style={[styles.mark, { top: insets.top + 120 }]}>
          <Check size={44} color={color.onAccent} strokeWidth={3} />
        </View>
        <Text style={[type.hero, { color: color.onAccent, textAlign: 'center' }]} accessibilityRole="header">
          {more ? '자료를 보내요' : '신고가 접수됐어요'}
        </Text>
        <View style={ui.row}>
          <Text style={[type.small, { color: color.onNightSoft }]}>신고번호</Text>
          <Text style={[type.number, { color: color.onAccent }]}>
            {shortId(id)} · {when(sentAt).replace('오늘 ', '')}
          </Text>
        </View>
      </View>
      <ScrollView style={styles.sheet} contentContainerStyle={{ gap: 14, padding: 24, paddingBottom: 28 + insets.bottom }}>
        <Text style={[type.body, { color: color.inkSoft }]}>
          {more
            ? '보낸 자료는 이 신고에 더해지고 AI 분석에 함께 쓰여요.'
            : items.length
              ? '위치는 담당자에게 전달됐어요. 찍은 자료를 이어서 보내고 있어요.'
              : '위치가 담당자에게 전달됐어요. 진행 상황은 내 신고에서 볼 수 있어요.'}
        </Text>
        {items.length > 0 && (
          <Card style={{ gap: 14 }}>
            {items.map((item, index) => {
              const Icon = ICON[item.kind];
              const done = item.state === 'done';
              const status = { waiting: '대기', uploading: `보내는 중 ${Math.round(item.progress * 100)}%`, done: '보냄', failed: '실패' }[item.state];
              return (
                <View key={item.kind} style={{ gap: 8 }}>
                  <View style={[ui.row, { gap: 10 }]}>
                    <Icon size={20} color={done ? color.tide : color.inkSoft} />
                    <Text style={[type.body, { color: color.ink, flex: 1 }]}>{item.label}</Text>
                    <Text style={[type.field, { color: done ? color.tide : item.state === 'failed' ? color.alert : color.inkSoft }]}>{status}</Text>
                  </View>
                  {item.state !== 'failed' && (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(4, item.progress * 100)}%` }]} />
                    </View>
                  )}
                  {item.error && <Text style={[type.small, { color: color.alert }]}>{item.error}</Text>}
                  {item.state === 'failed' && <Button label="다시 보내기" variant="tonal" onPress={() => patch(index, { state: 'waiting', progress: 0 })} />}
                </View>
              );
            })}
          </Card>
        )}
        <View style={{ flex: 1 }} />
        <Button label="내 신고 상태 보기" disabled={pending} onPress={() => router.replace({ pathname: '/report/[id]', params: { id } })} />
        <Button label="처음 화면으로" variant="secondary" disabled={pending} onPress={() => router.replace('/(tabs)')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 420, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 56, gap: 8, overflow: 'hidden' },
  rings: { position: 'absolute' },
  mark: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: color.tide, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: color.paper, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, marginTop: -28 },
  track: { height: 6, borderRadius: 3, backgroundColor: color.surfaceSunk, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.tide },
});
