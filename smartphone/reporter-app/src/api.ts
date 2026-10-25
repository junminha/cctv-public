import { Platform } from 'react-native';

// B central server reporter API (shared/API.md, v0.3). Only reporter-role endpoints are used.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
// The exhibition webcams are registered as demo locations, so demo reports match them.
export const LOCATION_KIND = process.env.EXPO_PUBLIC_LOCATION_KIND === 'real' ? 'real' : 'demo';

export type AttachmentKind = 'photo' | 'audio' | 'video';
export type Job = { state: 'queued' | 'running' | 'completed' | 'failed'; stage: string; progress: number; error: string | null };
export type ReportView = {
  report_id: string;
  created_at: string;
  description: string;
  details: string;
  latitude: number;
  longitude: number;
  occurred_at: string | null;
  gps_accuracy_m: number | null;
  job: Job;
  attachments: { attachment_id: string; kind: 'image' | 'audio' | 'video'; bytes: number; created_at: string }[];
  // B v0.6: handling stages with times only (no names or notes). Older servers omit it.
  handling?: { state: HandlingState; label: string; timeline: { state: HandlingState; label: string; at: string }[] };
};
export type HandlingState = 'received' | 'analyzing' | 'analyzed' | 'responding' | 'confirmed' | 'closed';
export type NewReport = {
  description: string;
  details: string;
  latitude: number;
  longitude: number;
  location_kind: 'real' | 'demo';
  occurred_at?: string;
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy_m?: number;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MESSAGES: Record<number, string> = {
  401: '로그인이 풀렸어요. 다시 로그인해 주세요.',
  404: '신고를 찾을 수 없어요.',
  409: '이미 사용 중인 아이디예요.',
  413: '파일이 너무 커요. 사진 15MB, 녹음 25MB, 영상 100MB까지 보낼 수 있어요.',
  415: '보낼 수 없는 파일 형식이에요.',
  429: '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.',
};

function failure(status: number, fallback: string) {
  return new ApiError(status, MESSAGES[status] ?? (status >= 500 ? '서버에 문제가 있어요. 잠시 뒤 다시 보내 주세요.' : fallback));
}

export async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  if (!API_URL) throw new ApiError(0, '서버 주소가 설정되지 않았어요. 앱 설정(EXPO_PUBLIC_API_URL)을 확인해 주세요.');
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(rest.body && typeof rest.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  }
  if (!response.ok) throw failure(response.status, '요청을 처리하지 못했어요.');
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const auth = {
  signup: (username: string, password: string) =>
    request<{ username: string; token: string }>('/api/v1/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: async (username: string, password: string) => {
    try {
      return await request<{ username: string; token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw new ApiError(401, '아이디 또는 비밀번호가 맞지 않아요.');
      throw error;
    }
  },
  logout: (token: string) => request<void>('/api/v1/auth/logout', { method: 'POST', token }),
};

export const reports = {
  create: (token: string, body: NewReport) =>
    request<{ report_id: string; created_at: string }>('/api/v1/reports', { method: 'POST', token, body: JSON.stringify(body) }),
  list: (token: string) => request<{ reports: ReportView[] }>('/api/v1/reports?limit=50', { token }),
  get: (token: string, id: string) => request<ReportView>(`/api/v1/reports/${id}`, { token }),
};

type FilePart = { uri: string; name: string; type: string };

async function filePart(form: FormData, file: FilePart) {
  // React Native uploads a {uri, name, type} descriptor; a browser needs the actual Blob.
  // Pass exactly uri/name/type: React Native spreads this object into the native request,
  // and extra screen state (progress, labels…) makes Android fail before anything is sent.
  if (Platform.OS === 'web') form.append('file', await (await fetch(file.uri)).blob(), file.name);
  else form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
}

// Speak instead of typing: B transcribes the recording (OpenAI) and returns the text.
export async function dictate(token: string, file: FilePart): Promise<string> {
  const form = new FormData();
  await filePart(form, file);
  try {
    const result = await request<{ text: string }>('/api/v1/reports/dictation', { method: 'POST', token, body: form });
    return result.text;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 503 || error.status === 429)) {
      throw new ApiError(error.status, error.status === 503 ? '지금은 말로 입력할 수 없어요. 직접 적어 주세요.' : '말로 입력을 너무 많이 했어요. 잠시 뒤 다시 해 주세요.');
    }
    throw error;
  }
}

// XHR (not fetch) so the upload can report progress.
export async function uploadAttachment(
  token: string,
  reportId: string,
  file: FilePart,
  onProgress: (ratio: number) => void,
): Promise<void> {
  const form = new FormData();
  await filePart(form, file);
  form.append('consent', 'true');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/v1/reports/${reportId}/attachments`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => (xhr.status === 201 ? resolve() : reject(failure(xhr.status, '첨부를 보내지 못했어요.')));
    xhr.onerror = () => reject(new ApiError(0, '첨부를 보내지 못했어요. 인터넷 연결을 확인해 주세요.'));
    xhr.send(form);
  });
}

// Citizens only see a coarse stage and when it happened, never analysis details or who handled it.
export type Step = 'received' | 'checking' | 'reviewing' | 'responding' | 'confirmed' | 'closed';
export const STEPS: Step[] = ['received', 'checking', 'reviewing', 'responding', 'confirmed', 'closed'];
const FROM_HANDLING: Record<HandlingState, Step> = {
  received: 'received', analyzing: 'checking', analyzed: 'reviewing', responding: 'responding', confirmed: 'confirmed', closed: 'closed',
};
export const stepOf = ({ job, handling }: Pick<ReportView, 'job' | 'handling'>): Step =>
  handling ? FROM_HANDLING[handling.state]
    : job.state === 'running' ? 'checking' : job.state === 'completed' || job.state === 'failed' ? 'reviewing' : 'received';
// When each step happened, from the server timeline.
export const stepTimes = (report: Pick<ReportView, 'handling'>) =>
  Object.fromEntries((report.handling?.timeline ?? []).map((row) => [FROM_HANDLING[row.state], row.at])) as Partial<Record<Step, string>>;
export const STEP_LABEL: Record<Step, string> = {
  received: '접수됨', checking: '주변 CCTV 확인 중', reviewing: '담당자 검토 중',
  responding: '담당자 대응 중', confirmed: '담당자 확인 완료', closed: '처리 종결',
};

export function attachmentSummary(report: ReportView) {
  const count = (kind: string) => report.attachments.filter((item) => item.kind === kind).length;
  return [['사진', count('image')], ['녹음', count('audio')], ['영상', count('video')]]
    .filter(([, n]) => n)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
}
