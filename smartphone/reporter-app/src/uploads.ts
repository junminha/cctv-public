import type { Captured } from './components/AttachmentPicker';

// Captured files travel to the sent screen in memory, never in route params: Expo Go file
// URIs contain percent-encoded segments (%2540…) that route params decode, which breaks the
// path and makes every upload fail on the phone before it is sent.
const queued = new Map<string, Captured[]>();

export const queueUploads = (reportId: string, files: Captured[]) => queued.set(reportId, files);
export const queuedUploads = (reportId: string) => queued.get(reportId) ?? [];
export const forgetUploads = (reportId: string) => {
  queued.delete(reportId);
};
