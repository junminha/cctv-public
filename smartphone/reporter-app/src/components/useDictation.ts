import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useRef, useState } from 'react';

import { ApiError, dictate } from '@/api';

const MAX_MS = 60_000;

export type DictationPhase = 'idle' | 'listening' | 'writing';

// Record what the reporter says, have B turn it into text, and hand the text back.
export function useDictation(token: string | null, onText: (text: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function finish(keep: boolean) {
    if (limit.current) clearTimeout(limit.current);
    await recorder.stop();
    if (!keep || !recorder.uri || !token) return setPhase('idle');
    setPhase('writing');
    try {
      const text = await dictate(token, { uri: recorder.uri, name: 'speech.m4a', type: 'audio/mp4' });
      if (text) onText(text);
      else setError('알아들은 말이 없어요. 다시 말하거나 직접 적어 주세요.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '말을 글자로 바꾸지 못했어요. 직접 적어 주세요.');
    } finally {
      setPhase('idle');
    }
  }

  async function start() {
    setError(null);
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) return setError('마이크 권한이 꺼져 있어요. 휴대폰 설정에서 허용해 주세요.');
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('listening');
    limit.current = setTimeout(() => finish(true), MAX_MS);
  }

  return { phase, millis: state.durationMillis, error, start, stop: () => finish(true), cancel: () => finish(false) };
}
