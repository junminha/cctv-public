import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, Mic, Video } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, uploadAttachment, type AttachmentKind } from '@/api';
import { Button, Card, Rings, styles as ui } from '@/components/ui';
import { shortId, when } from '@/geo';
import { useSession } from '@/session';
import { color, radius, type } from '@/theme';

type State = 'waiting' | 'capturing' | 'recording' | 'uploading' | 'done' | 'skipped' | 'failed';
type File = { uri: string; name: string; type: string };
type Item = { kind: AttachmentKind; state: State; progress: number; label: string; file?: File; error?: string };

const NAME: Record<AttachmentKind, string> = { photo: '사진', audio: '녹음', video: '짧은 영상' };
const ICON = { photo: Camera, audio: Mic, video: Video };
const MAX_AUDIO_MS = 60_000;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export default function Sent() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { id, capture = '', more } = useLocalSearchParams<{ id: string; capture?: string; more?: string }>();
  const [items, setItems] = useState<Item[]>(() =>
    capture
      .split(',')
      .filter((kind): kind is AttachmentKind => kind in NAME)
      .map((kind) => ({ kind, state: 'waiting', progress: 0, label: NAME[kind] })),
  );
  const [sentAt] = useState(() => new Date().toISOString());
  const busy = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);

  const patch = useCallback((index: number, changes: Partial<Item>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }, []);

  const upload = useCallback(
    async (index: number, file: File) => {
      if (!token) return;
      patch(index, { state: 'uploading', progress: 0, file, error: undefined });
      try {
        await uploadAttachment(token, id, file, (progress) => patch(index, { progress }));
        patch(index, { state: 'done', progress: 1 });
      } catch (caught) {
        patch(index, { state: 'failed', error: caught instanceof ApiError ? caught.message : '보내지 못했어요.' });
      }
    },
    [id, patch, token],
  );

  // Capture the checked items one at a time; the report itself is already received.
  useEffect(() => {
    const index = items.findIndex((item) => item.state === 'waiting');
    if (index < 0 || busy.current || items.some((item) => item.state === 'capturing' || item.state === 'recording')) return;
    const item = items[index];
    busy.current = true;
    (async () => {
      if (item.kind === 'audio') {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) return patch(index, { state: 'skipped', error: '마이크 권한이 없어 녹음을 건너뛰었어요.' });
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        return patch(index, { state: 'recording' });
      }
      patch(index, { state: 'capturing' });
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return patch(index, { state: 'skipped', error: '카메라 권한이 없어 건너뛰었어요.' });
      const video = item.kind === 'video';
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: [video ? 'videos' : 'images'], quality: 0.8, videoMaxDuration: 30 });
      if (result.canceled) return patch(index, { state: 'skipped' });
      const asset = result.assets[0];
      const label = video ? `영상 ${clock(asset.duration ?? 0)}` : '사진 1장';
      patch(index, { label });
      await upload(index, {
        uri: asset.uri,
        name: asset.fileName ?? (video ? 'video.mp4' : 'photo.jpg'),
        type: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
      });
    })().finally(() => {
      busy.current = false;
    });
  }, [items, patch, upload]);

  const recordingIndex = items.findIndex((item) => item.state === 'recording');

  const startedAt = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishRecording = useCallback(async () => {
    if (recordingIndex < 0) return;
    if (limit.current) clearTimeout(limit.current);
    const duration = Date.now() - startedAt.current;
    await recorder.stop();
    if (!recorder.uri) return patch(recordingIndex, { state: 'failed', error: '녹음 파일을 찾지 못했어요.' });
    patch(recordingIndex, { label: `녹음 ${clock(duration)}` });
    await upload(recordingIndex, { uri: recorder.uri, name: 'voice.m4a', type: 'audio/mp4' });
  }, [patch, recorder, recordingIndex, upload]);

  async function startRecording() {
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    // Keep phone recordings short; the analysis only needs the spoken description.
    limit.current = setTimeout(finishRecording, MAX_AUDIO_MS);
  }

  const pending = items.some((item) => !['done', 'skipped', 'failed'].includes(item.state));

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
          {more ? '보낸 자료는 이 신고에 더해지고 AI 분석에 함께 쓰여요.' : '위치는 담당자에게 전달됐어요. 체크한 자료를 이어서 보내면 AI 분석에 함께 쓰여요.'}
        </Text>
        {items.length > 0 && (
          <Card style={{ gap: 14 }}>
            {items.map((item, index) => {
              const Icon = ICON[item.kind];
              const done = item.state === 'done';
              const status = {
                waiting: '대기',
                capturing: '촬영 중',
                recording: recording.isRecording ? `녹음 중 ${clock(recording.durationMillis)}` : '녹음 준비',
                uploading: `보내는 중 ${Math.round(item.progress * 100)}%`,
                done: '보냄',
                skipped: '건너뜀',
                failed: '실패',
              }[item.state];
              return (
                <View key={item.kind} style={{ gap: 8 }}>
                  <View style={[ui.row, { gap: 10 }]}>
                    <Icon size={20} color={done ? color.tide : color.inkSoft} />
                    <Text style={[type.body, { color: color.ink, flex: 1 }]}>{item.label}</Text>
                    <Text style={[type.field, { color: done ? color.tide : item.state === 'failed' ? color.alert : color.inkSoft }]}>{status}</Text>
                  </View>
                  {(item.state === 'uploading' || done) && (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(4, item.progress * 100)}%` }]} />
                    </View>
                  )}
                  {item.error && <Text style={[type.small, { color: item.state === 'failed' ? color.alert : color.inkSoft }]}>{item.error}</Text>}
                  {item.state === 'failed' && item.file && <Button label="다시 보내기" variant="tonal" onPress={() => upload(index, item.file!)} />}
                  {item.state === 'recording' && (
                    <View style={{ gap: 8 }}>
                      {recording.isRecording ? (
                        <Button label="녹음 끝내고 보내기" onPress={finishRecording} />
                      ) : (
                        <Button label="녹음 시작" onPress={startRecording} />
                      )}
                      <Button
                        label="녹음 건너뛰기"
                        variant="secondary"
                        onPress={async () => {
                          if (limit.current) clearTimeout(limit.current);
                          if (recording.isRecording) await recorder.stop();
                          patch(index, { state: 'skipped' });
                        }}
                      />
                    </View>
                  )}
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
