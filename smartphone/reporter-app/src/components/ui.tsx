import { Check } from 'lucide-react-native';
import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { color, font, radius, type } from '@/theme';

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  big = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tonal';
  busy?: boolean;
  disabled?: boolean;
  big?: boolean;
}) {
  const palette = {
    primary: { bg: color.beacon, fg: color.onAccent, border: color.beacon },
    secondary: { bg: color.surface, fg: color.ink, border: color.rule },
    tonal: { bg: color.tideWash, fg: color.tide, border: color.tideWash },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, height: variant === 'primary' ? 60 : 52 },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
      ]}>
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[big ? styles.bigLabel : type.button, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, optional, ...input }: { label: string; optional?: boolean } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <Text style={[type.field, { color: color.ink }]}>{label}</Text>
        {optional && <Text style={[type.nav, { color: color.inkSoft }]}>선택</Text>}
      </View>
      <TextInput
        placeholderTextColor={color.inkSoft}
        accessibilityLabel={label}
        style={[styles.input, input.multiline ? styles.inputMulti : styles.inputSingle]}
        {...input}
      />
    </View>
  );
}

export function Tile({ icon: Icon, title, sub, on, onPress }: { icon: IconType; title: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${title}, ${sub}`}
      onPress={onPress}
      style={[styles.tile, on ? { backgroundColor: color.beaconWash, borderColor: color.beacon, borderWidth: 2 } : null]}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Icon size={28} color={on ? color.beacon : color.inkSoft} strokeWidth={2} />
        <View style={[styles.badge, on ? { backgroundColor: color.beacon, borderColor: color.beacon } : null]}>
          {on && <Check size={18} color={color.onAccent} strokeWidth={3} />}
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <Text style={[type.card, { color: color.ink }]}>{title}</Text>
      <Text style={[type.nav, { color: on ? color.beacon : color.inkSoft }]}>{sub}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on ? { backgroundColor: color.ink, borderColor: color.ink } : null]}>
      <Text style={[type.field, { color: on ? color.onAccent : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

const TONES = {
  received: { bg: color.surfaceSunk, fg: color.inkSoft },
  checking: { bg: color.tideWash, fg: color.tide },
  reviewing: { bg: color.amberWash, fg: color.amber },
  responding: { bg: color.beaconWash, fg: color.beacon },
  confirmed: { bg: color.tideWash, fg: color.tide },
  closed: { bg: color.surfaceSunk, fg: color.ink },
} as const;

export function StatusPill({ tone, label }: { tone: keyof typeof TONES; label: string }) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[type.nav, { color: fg }]}>{label}</Text>
    </View>
  );
}
export const toneColor = (tone: keyof typeof TONES) => (tone === 'received' ? color.inkSoft : TONES[tone].fg);

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Note({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return (
    <View style={[styles.row, styles.note]}>
      <Icon size={18} color={color.inkSoft} />
      <Text style={[type.small, { color: color.inkSoft, flex: 1 }]}>{children}</Text>
    </View>
  );
}

export function Toggle({ on, onChange, label, sub, icon: Icon }: { on: boolean; onChange: (next: boolean) => void; label: string; sub?: string; icon?: IconType }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} style={[styles.row, { paddingVertical: 8, gap: 14 }]}>
      {Icon && <Icon size={24} color={color.inkSoft} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.card, { color: color.ink }]}>{label}</Text>
        {sub && <Text style={[type.small, { color: color.inkSoft }]}>{sub}</Text>}
      </View>
      <View style={[styles.track, on ? { backgroundColor: color.beacon, borderColor: color.beacon } : null]}>
        <View style={[styles.thumb, on ? styles.thumbOn : null]} />
      </View>
    </Pressable>
  );
}

// Concentric signal rings: the report's beacon on the night chart.
export function Rings({ size, rings, stroke, center = true }: { size: number; rings: number[]; stroke: string; center?: boolean }) {
  const c = size / 2;
  return (
    <Svg width={size} height={size} pointerEvents="none">
      {rings.map((r, i) => (
        <Circle key={r} cx={c} cy={c} r={r} stroke={stroke} strokeWidth={1.5} fill="none" opacity={0.7 - (i * 0.5) / rings.length} />
      ))}
      {center && <Circle cx={c} cy={c} r={7} fill={color.beacon} stroke={color.onAccent} strokeWidth={2} />}
    </Svg>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { borderRadius: radius.button, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  bigLabel: { fontFamily: font.display, fontSize: 22, lineHeight: 28, letterSpacing: 0.4 },
  // No lineHeight on inputs: on Android it pushes the text up and makes a one-line field scroll.
  input: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    color: color.ink,
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderWidth: 1,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    includeFontPadding: false,
  },
  inputSingle: { height: 50, paddingVertical: 0, textAlignVertical: 'center' },
  inputMulti: { minHeight: 88, paddingVertical: 12, textAlignVertical: 'top' },
  tile: { flex: 1, height: 108, padding: 12, gap: 6, borderRadius: radius.tile, borderWidth: 1, borderColor: color.rule, backgroundColor: color.surface },
  badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.rule, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: radius.chip, borderWidth: 1, borderColor: color.rule, backgroundColor: color.surface, justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  card: { backgroundColor: color.surface, borderColor: color.rule, borderWidth: 1, borderRadius: radius.card, padding: 18, gap: 12 },
  note: { alignItems: 'flex-start', gap: 10, backgroundColor: color.surfaceSunk, borderRadius: 12, padding: 14 },
  track: { width: 52, height: 32, borderRadius: 16, borderWidth: 2, borderColor: color.inkSoft, backgroundColor: color.surfaceSunk, justifyContent: 'center' },
  thumb: { width: 16, height: 16, borderRadius: 8, marginLeft: 6, backgroundColor: color.inkSoft },
  thumbOn: { width: 24, height: 24, borderRadius: 12, marginLeft: 22, backgroundColor: color.onAccent },
});
