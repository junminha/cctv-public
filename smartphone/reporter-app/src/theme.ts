// Harbour night chart + beacon: tokens mirror the Figma "Reporter tokens" collection.
export const color = {
  night: '#0E2433',
  night2: '#16364A',
  nightLine: '#2B4B60',
  onNightSoft: '#A9BEC9',
  paper: '#EAF1EF',
  surface: '#FFFFFF',
  surfaceSunk: '#E8EFEC',
  ink: '#0F2A3D',
  inkSoft: '#4B6271',
  rule: '#D3DDD9',
  beacon: '#C4470A',
  beaconWash: '#FCEADF',
  tide: '#0D7F81',
  tideWash: '#DBEFEE',
  amber: '#8A560C',
  amberWash: '#F8ECD6',
  alert: '#B42318',
  alertWash: '#FDE8E6',
  onAccent: '#FFFFFF',
} as const;

export const font = {
  display: 'BlackHanSans_400Regular',
  regular: 'IBMPlexSansKR_400Regular',
  medium: 'IBMPlexSansKR_500Medium',
  semibold: 'IBMPlexSansKR_600SemiBold',
  bold: 'IBMPlexSansKR_700Bold',
  mono: 'IBMPlexMono_500Medium',
} as const;

export const type = {
  hero: { fontFamily: font.display, fontSize: 34, lineHeight: 42 },
  title: { fontFamily: font.display, fontSize: 28, lineHeight: 36 },
  section: { fontFamily: font.bold, fontSize: 18, lineHeight: 26 },
  card: { fontFamily: font.semibold, fontSize: 16, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  button: { fontFamily: font.bold, fontSize: 16, lineHeight: 22 },
  field: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  nav: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  number: { fontFamily: font.mono, fontSize: 14, lineHeight: 20 },
} as const;

export const radius = { chip: 18, field: 12, tile: 16, card: 18, sheet: 28, button: 16 } as const;
