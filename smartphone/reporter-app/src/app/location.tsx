import { router } from 'expo-router';
import { ArrowLeft, LocateFixed } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChartMap from '@/components/ChartMap';
import { Button } from '@/components/ui';
import { useDraft, type Point } from '@/draft';
import { RADIUS_M, VENUE, addressOf, coords, locate } from '@/geo';
import { color, radius, type } from '@/theme';

export default function LocationEditor() {
  const insets = useSafeAreaInsets();
  const draft = useDraft();
  const start = draft.point ?? draft.gps ?? VENUE;
  // `target` moves the map (my-location button); `picked` follows the user's panning.
  const [target, setTarget] = useState<Point>(start);
  const [picked, setPicked] = useState<Point>(start);
  const [address, setAddress] = useState<string | null>(draft.point ? draft.address : null);
  const lookup = useRef(0);

  const onMoved = useCallback(async (point: Point) => {
    setPicked(point);
    const ticket = ++lookup.current;
    const label = await addressOf(point);
    if (ticket === lookup.current) setAddress(label);
  }, []);

  async function backToGps() {
    const gps = draft.gps ?? (await locate());
    if (typeof gps === 'string') return;
    draft.setGps(gps);
    setTarget({ latitude: gps.latitude, longitude: gps.longitude });
  }

  function confirm() {
    draft.setPoint(picked, address);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.night }}>
      <View style={{ flex: 1 }}>
        <ChartMap center={target} radiusM={RADIUS_M} editable onMoved={onMoved} style={StyleSheet.absoluteFill} />
        <View style={[styles.top, { top: insets.top + 12 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => router.back()} style={styles.round}>
            <ArrowLeft size={24} color={color.onAccent} />
          </Pressable>
          <Text style={[type.section, { color: color.onAccent }]}>위치 수정</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="내 GPS 위치로" onPress={backToGps} style={styles.fab}>
          <LocateFixed size={24} color={color.ink} />
        </Pressable>
      </View>
      <View style={[styles.sheet, { paddingBottom: 28 + insets.bottom }]}>
        <Text style={[type.card, { color: color.ink }]}>지도를 움직여 핀을 사건 위치에 맞춰 주세요</Text>
        <Text style={[type.body, { color: color.inkSoft }]}>{address ?? coords(picked)}</Text>
        <Text style={[type.small, { color: color.inkSoft }]}>GPS 위치와 고친 위치를 함께 보내요</Text>
        <Button label="이 위치로 정하기" onPress={confirm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.night2, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 40,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -28,
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 10,
  },
});
