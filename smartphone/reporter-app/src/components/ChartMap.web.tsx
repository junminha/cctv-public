import { createElement, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { color } from '@/theme';
import type { ChartMapProps } from './ChartMap';
import { mapHtml } from './map-html';

// Browser preview: the same Leaflet page in an iframe (react-native-webview has no web build).
export default function ChartMap({ center, radiusM, editable = false, shiftY = 0, onMoved, style }: ChartMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html] = useState(() => mapHtml({ ...center, radiusM, editable, shiftY }));
  const { latitude, longitude } = center;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'center', latitude, longitude }), '*');
  }, [latitude, longitude]);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = JSON.parse(event.data);
      if (message.type === 'moved') onMoved?.({ latitude: message.latitude, longitude: message.longitude });
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [onMoved]);
  return (
    <View style={[{ flex: 1, backgroundColor: color.night }, style]} pointerEvents={editable ? 'auto' : 'none'}>
      {createElement('iframe', { ref: frame, srcDoc: html, title: '지도', style: { border: 0, width: '100%', height: '100%' } })}
    </View>
  );
}
