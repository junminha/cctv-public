import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, MapPin, Phone, SlidersHorizontal, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, LOCATION_KIND, reports, type NewReport } from '@/api';
import { AttachmentPicker, KINDS, type CapturedSet } from '@/components/AttachmentPicker';
import ChartMap from '@/components/ChartMap';
import { Button, Chip, Field, Note, styles as ui } from '@/components/ui';
import { useDraft } from '@/draft';
import { RADIUS_M, VENUE, addressOf, coords, locate, rememberLabel } from '@/geo';
import { useSession } from '@/session';
import { color, radius, type } from '@/theme';

const WHEN = [
  ['방금', 0],
  ['10분 전', 10],
  ['30분 전', 30],
  ['1시간 넘게', 60],
] as const;
const HERO = 330;
const minutesBefore = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export default function Report() {
  const insets = useSafeAreaInsets();
  const { token, prefs } = useSession();
  const draft = useDraft();
  const [status, setStatus] = useState<'locating' | 'ok' | 'denied' | 'unavailable'>('locating');
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [minutesAgo, setMinutesAgo] = useState<number | null>(null);
  // Taken on this screen before sending; only what the reporter chose to capture.
  const [files, setFiles] = useState<CapturedSet>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ask the phone for its position once; the user can still move the point afterwards.
  const { point, setGps, setPoint } = draft;
  useEffect(() => {
    if (point) return;
    let alive = true;
    locate().then(async (result) => {
      if (!alive) return;
      if (typeof result === 'string') return setStatus(result);
      setGps(result);
      setPoint(result, await addressOf(result));
      setStatus('ok');
    });
    return () => {
      alive = false;
    };
  }, [point, setGps, setPoint]);

  // Settings choose which capture buttons appear on this screen.
  const buttons = prefs.consent ? KINDS.filter((kind) => prefs.defaults[kind.key]).map((kind) => kind.key) : [];
  const attached = KINDS.filter((kind) => files[kind.key]);
  const place = draft.point ? draft.address ?? coords(draft.point) : null;
  const locationLine =
    status === 'locating' && !draft.point
      ? '현재 위치를 찾는 중…'
      : !draft.point
        ? status === 'denied'
          ? '위치 권한이 꺼져 있어요. 지도에서 직접 지정해 주세요.'
          : 'GPS를 받지 못했어요. 지도에서 직접 지정해 주세요.'
        : draft.gps && draft.point.latitude === draft.gps.latitude && draft.point.longitude === draft.gps.longitude
          ? `GPS 자동 확인${draft.gps.accuracy ? ` · 오차 약 ${Math.round(draft.gps.accuracy)}m` : ''}`
          : '지도에서 고친 위치';

  async function send() {
    if (!token) return router.replace('/login');
    if (!draft.point) return setError('위치를 확인하지 못했어요. 위치 수정에서 신고 지점을 정해 주세요.');
    setError(null);
    setBusy(true);
    const body: NewReport = {
      description: description.trim(),
      details: details.trim(),
      latitude: draft.point.latitude,
      longitude: draft.point.longitude,
      location_kind: LOCATION_KIND,
    };
    if (minutesAgo !== null) body.occurred_at = minutesBefore(minutesAgo);
    if (draft.gps) Object.assign(body, { gps_latitude: draft.gps.latitude, gps_longitude: draft.gps.longitude, gps_accuracy_m: draft.gps.accuracy ?? undefined });
    try {
      const created = await reports.create(token, body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await rememberLabel(created.report_id, place ?? '');
      setDescription('');
      setDetails('');
      setMinutesAgo(null);
      setFiles({});
      setOpen(false);
      router.push({ pathname: '/sent/[id]', params: { id: created.report_id, files: JSON.stringify(Object.values(files)) } });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '신고를 보내지 못했어요. 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: color.night }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={{ height: HERO + insets.top }}>
          <ChartMap center={draft.point ?? VENUE} radiusM={RADIUS_M} shiftY={20} style={StyleSheet.absoluteFill} />
          <View style={[styles.top, { top: insets.top + 12 }]}>
            <Text style={[type.title, { color: color.onAccent }]} accessibilityRole="header">
              신고하기
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="설정" onPress={() => router.push('/settings')} style={styles.round}>
              <SlidersHorizontal size={24} color={color.onNightSoft} />
            </Pressable>
          </View>
          <View style={styles.chip}>
            <MapPin size={22} color={color.beacon} />
            <View style={{ flex: 1 }}>
              <Text style={[type.card, { color: color.ink }]} numberOfLines={1}>
                {place ?? '신고 위치'}
              </Text>
              <Text style={[type.small, { color: draft.point ? color.inkSoft : color.alert }]} numberOfLines={2}>
                {locationLine}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push('/location')} style={styles.edit}>
              <Text style={[type.field, { color: color.tide }]}>위치 수정</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.sheet}>
          <View style={[ui.row, styles.sos]}>
            <TriangleAlert size={20} color={color.alert} />
            <Text style={[type.small, { color: color.alert, flex: 1 }]}>생명이 위험하면 먼저 전화</Text>
            {['112', '119'].map((number) => (
              <Pressable key={number} accessibilityRole="button" accessibilityLabel={`${number}에 전화`} onPress={() => Linking.openURL(`tel:${number}`)} style={styles.call}>
                <Phone size={14} color={color.onAccent} />
                <Text style={[type.number, { color: color.onAccent }]}>{number}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.details}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[ui.row, { gap: 12 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.card, { color: color.ink }]}>상황 자세히 적기</Text>
                <Text style={[type.small, { color: color.inkSoft }]}>무슨 일 · 상세 위치 · 언제 — 모두 선택</Text>
              </View>
              {open ? <ChevronUp size={24} color={color.inkSoft} /> : <ChevronDown size={24} color={color.inkSoft} />}
            </Pressable>
            {open && (
              <View style={{ gap: 18, marginTop: 16 }}>
                <Field label="무슨 일인가요" optional multiline maxLength={4000} placeholder="예: 정문 안쪽 복도에 사람이 쓰러져 있어요" value={description} onChangeText={setDescription} />
                <Field label="상세 위치" optional maxLength={1000} placeholder="예: 공학관 2층 엘리베이터 앞" value={details} onChangeText={setDetails} />
                <View style={{ gap: 8 }}>
                  <View style={ui.row}>
                    <Text style={[type.field, { color: color.ink }]}>언제 일어났나요</Text>
                    <Text style={[type.nav, { color: color.inkSoft }]}>선택</Text>
                  </View>
                  <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
                    {WHEN.map(([label, minutes]) => (
                      <Chip key={label} label={label} on={minutesAgo === minutes} onPress={() => setMinutesAgo(minutesAgo === minutes ? null : minutes)} />
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>

          {buttons.length > 0 ? (
            <View style={{ gap: 10 }}>
              <View style={ui.row}>
                <Text style={[type.field, { color: color.ink }]}>함께 보낼 자료</Text>
                <Text style={[type.nav, { color: color.inkSoft }]}>필요한 것만 눌러서 찍어요</Text>
              </View>
              <AttachmentPicker kinds={buttons} files={files} onChange={setFiles} />
            </View>
          ) : (
            <Note icon={TriangleAlert}>
              {prefs.consent ? '첨부 버튼이 모두 꺼져 있어요. 설정에서 켤 수 있어요.' : '첨부 자료 사용에 동의하지 않아 위치와 적은 내용만 보내요. 설정에서 바꿀 수 있어요.'}
            </Note>
          )}
        </View>
      </ScrollView>

      <View style={styles.dock}>
        <View style={[ui.row, { gap: 6 }]}>
          <Text style={[type.nav, { color: color.inkSoft, flex: 1 }]}>보낼 내용</Text>
          {[{ key: 'location', title: '위치', Icon: MapPin }, ...attached].map(({ key, title, Icon }) => (
            <View key={key} style={styles.manifest}>
              <Icon size={14} color={color.beacon} />
              <Text style={[type.nav, { color: color.beacon }]}>{title}</Text>
            </View>
          ))}
        </View>
        {error && (
          <Text style={[type.small, { color: color.alert }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button label="신고 보내기" big onPress={send} busy={busy} />
        <Text style={[type.small, { color: color.inkSoft, textAlign: 'center' }]}>아무것도 적지 않아도 위치로 바로 신고돼요</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 24, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.night2, alignItems: 'center', justifyContent: 'center' },
  chip: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 8,
  },
  edit: { backgroundColor: color.tideWash, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  sheet: {
    flexGrow: 1,
    backgroundColor: color.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -28,
    padding: 24,
    paddingTop: 22,
    gap: 18,
  },
  sos: { backgroundColor: color.alertWash, borderRadius: 14, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, gap: 8 },
  call: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: color.alert, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  details: { backgroundColor: color.surface, borderColor: color.rule, borderWidth: 1, borderRadius: 16, padding: 16, paddingRight: 12 },
  dock: { backgroundColor: color.surface, borderTopColor: color.rule, borderTopWidth: 1, paddingHorizontal: 24, paddingVertical: 14, gap: 12 },
  manifest: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color.beaconWash, borderRadius: 10, paddingLeft: 8, paddingRight: 10, paddingVertical: 4 },
});
