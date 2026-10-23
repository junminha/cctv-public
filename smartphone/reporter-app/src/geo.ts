import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { Gps, Point } from './draft';
import { readJson, writeJson } from './storage';

// Map opens here (PKNU Daeyeon campus, the exhibition venue) until GPS answers. It is only
// a view position: nothing is sent unless the phone or the user supplies the point.
export const VENUE: Point = { latitude: 35.1336, longitude: 129.103 };
export const RADIUS_M = 500;

export async function locate(): Promise<Gps | 'denied' | 'unavailable'> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return 'denied';
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy ?? null };
  } catch {
    return 'unavailable';
  }
}

export async function addressOf(point: Point): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const [place] = await Location.reverseGeocodeAsync(point);
    if (!place) return null;
    const parts = [place.district ?? place.city, place.street, place.streetNumber].filter(Boolean);
    const label = parts.length ? parts.join(' ') : place.name ?? place.formattedAddress;
    return label ? `${label} 근처` : null;
  } catch {
    return null;
  }
}

export const coords = (point: Point) => `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;

// The server stores coordinates only; remember the human label shown when sending.
const LABELS = 'report.labels';
export const rememberLabel = async (reportId: string, label: string) =>
  writeJson(LABELS, { ...(await readJson<Record<string, string>>(LABELS, {})), [reportId]: label });
export const reportLabels = () => readJson<Record<string, string>>(LABELS, {});

const pad = (value: number) => String(value).padStart(2, '0');
export function when(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === now.toDateString() ? `오늘 ${time}` : `${date.getMonth() + 1}.${pad(date.getDate())} ${time}`;
}
export const shortId = (reportId: string) => reportId.slice(0, 6).toUpperCase();
