import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { color } from '@/theme';
import type { Point } from '@/draft';
import { mapHtml } from './map-html';

// The package types WebView as WebView<P = undefined>, which intersects its props with
// `undefined` (= never) under strict mode; re-type it with the props it really takes.
type Handle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<Handle> }>;

export type ChartMapProps = {
  center: Point;
  radiusM: number;
  editable?: boolean;
  // Pixels to push the report point up, e.g. above an overlaid card.
  shiftY?: number;
  onMoved?: (point: Point) => void;
  style?: StyleProp<ViewStyle>;
};

export default function ChartMap({ center, radiusM, editable = false, shiftY = 0, onMoved, style }: ChartMapProps) {
  const view = useRef<Handle>(null);
  // Build the page once; later centre changes are pushed in without reloading tiles.
  const [html] = useState(() => mapHtml({ ...center, radiusM, editable, shiftY }));
  useEffect(() => {
    view.current?.injectJavaScript(`window.setCenter && window.setCenter(${center.latitude},${center.longitude});true;`);
  }, [center.latitude, center.longitude]);
  return (
    <View style={[styles.frame, style]} pointerEvents={editable ? 'auto' : 'none'}>
      <WebView
        ref={view}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.frame}
        scrollEnabled={false}
        onMessage={(event: WebViewMessageEvent) => {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.type === 'moved') onMoved?.({ latitude: message.latitude, longitude: message.longitude });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ frame: { flex: 1, backgroundColor: color.night } });
