import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Mic, Plus, Video, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AttachmentKind } from '@/api';
import { color, radius, type } from '@/theme';
import { Button, styles as ui } from './ui';

export type Captured = { kind: AttachmentKind; uri: string; name: string; type: string; label: string };
export type CapturedSet = Partial<Record<AttachmentKind, Captured>>;

export const KINDS: { key: AttachmentKind; title: string; hint: string; Icon: typeof Camera }[] = [
  { key: 'photo', title: '사진', hint: '눌러서 촬영', Icon: Camera },
  { key: 'audio', title: '녹음', hint: '눌러서 녹음', Icon: Mic },
  { key: 'video', title: '짧은 영상', hint: '최대 30초', Icon: Video },
];
const MAX_AUDIO_MS = 60_000;
const now = () => Date.now();
export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

// Capture only what the reporter chooses, before sending. Nothing captured is fine too.
export function AttachmentPicker({
  kinds,
  files,
  onChange,
  onRecording,
}: {
  kinds: AttachmentKind[];
  files: CapturedSet;
  onChange: (next: CapturedSet) => void;
  // Lets the screen hold its send button while a recording is open.
  onRecording?: (recording: boolean) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const startedAt = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function stopRecording(keep: boolean) {
    if (limit.current) clearTimeout(limit.current);
    const duration = now() - startedAt.current;
    await recorder.stop();
    setRecording(false);
    onRecording?.(false);
    if (keep && recorder.uri) {
      onChange({ ...files, audio: { kind: 'audio', uri: recorder.uri, name: 'voice.m4a', type: 'audio/mp4', label: `녹음 ${clock(duration)}` } });
    }
  }

  async function capture(kind: AttachmentKind) {
    setNotice(null);
    if (kind === 'audio') {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) return setNotice('마이크 권한이 꺼져 있어요. 휴대폰 설정에서 허용해 주세요.');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = now();
      setRecording(true);
      onRecording?.(true);
      // Keep recordings short; the analysis only needs the spoken description.
      limit.current = setTimeout(() => stopRecording(true), MAX_AUDIO_MS);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setNotice('카메라 권한이 꺼져 있어요. 휴대폰 설정에서 허용해 주세요.');
    const video = kind === 'video';
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: [video ? 'videos' : 'images'], quality: 0.8, videoMaxDuration: 30 });
    if (result.canceled) return;
    const asset = result.assets[0];
    onChange({
      ...files,
      [kind]: {
        kind,
        uri: asset.uri,
        name: asset.fileName ?? (video ? 'video.mp4' : 'photo.jpg'),
        type: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        label: video ? `영상 ${clock(asset.duration ?? 0)}` : '사진 1장',
      },
    });
  }

  function clear(kind: AttachmentKind) {
    const next = { ...files };
    delete next[kind];
    onChange(next);
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={[ui.row, { gap: 11 }]}>
        {KINDS.filter(({ key }) => kinds.includes(key)).map(({ key, title, hint, Icon }) => {
          const file = files[key];
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={file ? `${title} 다시 ${key === 'audio' ? '녹음' : '촬영'}` : `${title} ${key === 'audio' ? '녹음' : '촬영'}`}
              disabled={recording}
              onPress={() => capture(key)}
              style={[styles.tile, file && styles.tileOn, recording && { opacity: 0.5 }]}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Icon size={28} color={file ? color.beacon : color.inkSoft} />
                {file ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`${title} 지우기`} hitSlop={10} onPress={() => clear(key)} style={[styles.badge, styles.badgeOn]}>
                    <X size={16} color={color.onAccent} strokeWidth={3} />
                  </Pressable>
                ) : (
                  <View style={styles.badge}>
                    <Plus size={16} color={color.inkSoft} strokeWidth={2.5} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }} />
              <Text style={[type.card, { color: color.ink }]}>{title}</Text>
              <Text style={[type.nav, { color: file ? color.beacon : color.inkSoft }]}>{file ? file.label : hint}</Text>
            </Pressable>
          );
        })}
      </View>
      {recording && (
        <View style={styles.recorder} accessibilityLiveRegion="polite">
          <View style={[ui.row, { gap: 8 }]}>
            <View style={styles.liveDot} />
            <Text style={[type.card, { color: color.ink, flex: 1 }]}>녹음 중 {clock(recorderState.durationMillis)}</Text>
            <Text style={[type.nav, { color: color.inkSoft }]}>최대 1분</Text>
          </View>
          <View style={[ui.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Button label="취소" variant="secondary" onPress={() => stopRecording(false)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button label="녹음 끝내기" variant="tonal" onPress={() => stopRecording(true)} />
            </View>
          </View>
        </View>
      )}
      {notice && <Text style={[type.small, { color: color.alert }]}>{notice}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, height: 108, padding: 12, gap: 6, borderRadius: radius.tile, borderWidth: 1, borderColor: color.rule, backgroundColor: color.surface },
  tileOn: { backgroundColor: color.beaconWash, borderColor: color.beacon, borderWidth: 2 },
  badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.rule, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  badgeOn: { backgroundColor: color.beacon, borderColor: color.beacon },
  recorder: { backgroundColor: color.surface, borderColor: color.beacon, borderWidth: 1, borderRadius: radius.tile, padding: 14, gap: 12 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.alert },
});
