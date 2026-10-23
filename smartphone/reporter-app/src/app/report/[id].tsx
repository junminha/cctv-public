import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Mic, TriangleAlert, Video } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, STEP_LABEL, attachmentSummary, reports, stepOf, type AttachmentKind, type ReportView, type Step } from '@/api';
import { Button, Card, Note, Tile, styles as ui } from '@/components/ui';
import { coords, reportLabels, shortId, when } from '@/geo';
import { useSession } from '@/session';
import { color, type } from '@/theme';

const STEPS: Step[] = ['received', 'checking', 'reviewing'];

export default function ReportDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, prefs } = useSession();
  const [report, setReport] = useState<ReportView | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [extra, setExtra] = useState<Record<AttachmentKind, boolean>>({ photo: true, audio: false, video: false });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [row, labels] = await Promise.all([reports.get(token, id), reportLabels()]);
      setReport(row);
      setLabel(labels[id] || null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '신고를 불러오지 못했어요.');
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 5_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const step = report ? stepOf(report.job) : 'received';
  const reached = STEPS.indexOf(step);
  const chosen = (Object.keys(extra) as AttachmentKind[]).filter((kind) => extra[kind]);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <View style={[ui.row, { paddingHorizontal: 12, paddingVertical: 4, gap: 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/reports'))} style={styles.back}>
          <ArrowLeft size={24} color={color.ink} />
        </Pressable>
        <Text style={[type.section, { color: color.ink }]} accessibilityRole="header">
          신고 상세
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8, gap: 14, paddingBottom: 28 + insets.bottom }}>
        {error && <Text style={[type.body, { color: color.alert }]}>{error}</Text>}
        {report && (
          <>
            <View style={styles.now}>
              <View style={styles.live}>
                <View style={styles.liveDot} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.nav, { color: color.tide }]}>지금 단계</Text>
                <Text style={[type.section, { color: color.ink }]}>{STEP_LABEL[step]}</Text>
              </View>
            </View>

            <Card style={{ gap: 0 }}>
              <Text style={[type.card, { color: color.ink, marginBottom: 8 }]} accessibilityRole="header">
                처리 상황
              </Text>
              {STEPS.map((name, index) => {
                const state = index < reached ? 'done' : index === reached ? (step === 'reviewing' ? 'done' : 'current') : 'todo';
                const time = index === 0 ? when(report.created_at).replace('오늘 ', '') : state === 'current' ? '진행 중' : state === 'done' ? '완료' : '대기';
                return (
                  <View key={name} style={{ flexDirection: 'row', gap: 14 }}>
                    <View style={{ alignItems: 'center' }}>
                      <View style={[styles.line, { height: 12, backgroundColor: index === 0 ? 'transparent' : state === 'todo' ? color.rule : color.tide }]} />
                      <View style={[styles.dot, state === 'done' ? styles.done : state === 'current' ? styles.current : styles.todo]} />
                      <View style={[styles.line, { height: 22, backgroundColor: index === STEPS.length - 1 ? 'transparent' : state === 'done' ? color.tide : color.rule }]} />
                    </View>
                    <View style={[ui.row, { flex: 1, paddingTop: 8, alignItems: 'flex-start' }]}>
                      <Text style={[state === 'todo' ? type.body : type.card, { color: state === 'todo' ? color.inkSoft : color.ink, flex: 1 }]}>{STEP_LABEL[name]}</Text>
                      <Text style={[type.number, { color: state === 'current' ? color.tide : color.inkSoft }]}>{time}</Text>
                    </View>
                  </View>
                );
              })}
            </Card>

            <Card style={{ gap: 10 }}>
              {[
                ['신고번호', shortId(report.report_id), true],
                ['위치', label || report.details || coords(report), false],
                ['내용', report.description || '적지 않음', false],
                ['첨부', attachmentSummary(report) || '없음', false],
              ].map(([key, value, mono]) => (
                <View key={key as string} style={{ flexDirection: 'row', gap: 12 }}>
                  <Text style={[type.small, { color: color.inkSoft, width: 64 }]}>{key}</Text>
                  <Text style={[mono ? type.number : type.small, { color: color.ink, flex: 1 }]}>{value}</Text>
                </View>
              ))}
            </Card>

            <Note icon={TriangleAlert}>CCTV 영상과 분석 결과는 담당자만 볼 수 있어요. 생명이 위험하면 112·119에 바로 전화하세요.</Note>

            {prefs.consent ? (
              picking ? (
                <View style={{ gap: 12 }}>
                  <View style={[ui.row, { gap: 11 }]}>
                    <Tile icon={Camera} title="사진" sub="촬영" on={extra.photo} onPress={() => setExtra({ ...extra, photo: !extra.photo })} />
                    <Tile icon={Mic} title="녹음" sub="녹음" on={extra.audio} onPress={() => setExtra({ ...extra, audio: !extra.audio })} />
                    <Tile icon={Video} title="짧은 영상" sub="최대 30초" on={extra.video} onPress={() => setExtra({ ...extra, video: !extra.video })} />
                  </View>
                  <Button
                    label="고른 자료 보내기"
                    disabled={!chosen.length}
                    onPress={() => router.push({ pathname: '/sent/[id]', params: { id, capture: chosen.join(','), more: '1' } })}
                  />
                </View>
              ) : (
                <Button label="자료 더 보내기" variant="tonal" onPress={() => setPicking(true)} />
              )
            ) : (
              <Text style={[type.small, { color: color.inkSoft }]}>첨부 자료를 보내려면 설정에서 첨부 사용에 동의해 주세요.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  now: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: color.tideWash, borderRadius: 18, padding: 18 },
  live: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(13,127,129,0.4)', alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.tide },
  line: { width: 2 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  done: { backgroundColor: color.tide },
  current: { backgroundColor: color.surface, borderWidth: 4, borderColor: color.tide },
  todo: { backgroundColor: color.surface, borderWidth: 2, borderColor: color.rule },
});
