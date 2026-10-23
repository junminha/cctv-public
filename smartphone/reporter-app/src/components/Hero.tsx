import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, type } from '@/theme';
import { Rings } from './ui';

// Night header with the beacon rings, used by the account and setup screens.
export function Hero({ title, sub, step, height }: { title: string; sub: string; step?: string; height: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { height: height + insets.top, paddingTop: insets.top }]}>
      <View style={styles.rings}>
        <Rings size={360} rings={[40, 80, 125, 175]} stroke={color.beacon} />
      </View>
      <View style={styles.heading}>
        {step && <Text style={[type.number, { color: color.beacon }]}>{step}</Text>}
        <Text style={[type.hero, { color: color.onAccent }]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[type.body, { color: color.onNightSoft }]}>{sub}</Text>
      </View>
    </View>
  );
}

export function Sheet({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.sheet, { paddingBottom: 28 + insets.bottom }]}>{children}</View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.night, overflow: 'hidden', justifyContent: 'flex-end' },
  rings: { position: 'absolute', right: -54, top: -60 },
  heading: { paddingHorizontal: 24, paddingBottom: 36, gap: 10, maxWidth: 340 },
  sheet: {
    flex: 1,
    backgroundColor: color.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -28,
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 18,
  },
});
