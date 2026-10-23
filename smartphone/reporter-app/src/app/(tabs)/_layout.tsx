import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { List, Send } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type } from '@/theme';

const ITEMS = { index: { label: '신고하기', Icon: Send }, reports: { label: '내 신고', Icon: List } } as const;

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: 12 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const item = ITEMS[route.name as keyof typeof ITEMS];
        if (!item) return null;
        const active = state.index === index;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => !active && navigateToTab(route.key)}
            style={styles.item}>
            <View style={[styles.indicator, active && { backgroundColor: color.beaconWash }]}>
              <item.Icon size={24} color={active ? color.beacon : color.inkSoft} />
            </View>
            <Text style={[type.nav, { color: active ? color.ink : color.inkSoft }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="reports" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.rule, paddingTop: 12 },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  indicator: { paddingHorizontal: 20, paddingVertical: 4, borderRadius: 16 },
});
