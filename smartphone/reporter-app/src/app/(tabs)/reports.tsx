import { router, useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, STEP_LABEL, attachmentSummary, reports, stepOf, type ReportView } from '@/api';
import { StatusPill, toneColor } from '@/components/ui';
import { coords, reportLabels, when } from '@/geo';
import { useSession } from '@/session';
import { color, type } from '@/theme';

export default function MyReports() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const [rows, setRows] = useState<ReportView[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [result, saved] = await Promise.all([reports.list(token), reportLabels()]);
      setRows(result.reports);
      setLabels(saved);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '신고 목록을 불러오지 못했어요.');
    }
  }, [token]);

  // Refresh while visible so the stage moves without pulling.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 10_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={[type.title, { color: color.ink }]} accessibilityRole="header">
          내 신고
        </Text>
        <Text style={[type.small, { color: color.inkSoft }]}>내 계정으로 보낸 신고만 보여요</Text>
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row.report_id}
        contentContainerStyle={{ padding: 24, paddingTop: 4, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <Text style={[type.body, { color: error ? color.alert : color.inkSoft }]}>
            {error ?? (rows ? '아직 보낸 신고가 없어요. 신고하기 탭에서 위치만으로도 바로 신고할 수 있어요.' : '불러오는 중…')}
          </Text>
        }
        renderItem={({ item }) => {
          const step = stepOf(item.job);
          const meta = [labels[item.report_id] || item.details || coords(item), attachmentSummary(item)].filter(Boolean).join(' · ');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${when(item.created_at)} 신고, ${STEP_LABEL[step]}`}
              onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.report_id } })}
              style={styles.card}>
              <View style={[styles.rail, { backgroundColor: toneColor(step) }]} />
              <View style={styles.inner}>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[type.number, { color: color.inkSoft, flex: 1 }]}>{when(item.created_at)}</Text>
                    <StatusPill tone={step} label={STEP_LABEL[step]} />
                  </View>
                  <Text style={[type.card, { color: item.description ? color.ink : color.inkSoft }]} numberOfLines={2}>
                    {item.description || '적지 않음 · 위치로만 신고'}
                  </Text>
                  <Text style={[type.small, { color: color.inkSoft }]} numberOfLines={1}>
                    {meta}
                  </Text>
                </View>
                <ChevronRight size={20} color={color.inkSoft} />
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, gap: 4 },
  card: { flexDirection: 'row', backgroundColor: color.surface, borderColor: color.rule, borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  rail: { width: 5 },
  inner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingLeft: 16, paddingRight: 12 },
});
