// Korean operator vocabulary for B states. Keep names identical across the whole UI.

// Reported situations are suspicions or inconveniences to check, never established emergencies or crimes.
export const INCIDENT: Record<string, string> = {
  FALL_SUSPECTED: "쓰러짐 의심",
  VEHICLE_OBSTRUCTION: "차량 통행 불편",
  ABANDONED_OBJECT: "방치물",
  ILLEGAL_DUMPING: "쓰레기 무단투기 의심",
  SMOKING: "흡연 의심",
  POTHOLE: "도로 파손",
  VANDALISM: "공공시설물 파손 의심",
  FIRE_SMOKE: "화재·연기 의심",
  SAFETY_THREAT: "다툼·위협 의심",
  OTHER: "기타 불편 사항",
};

export const STAGES = [
  { key: "RECEIVED", label: "접수" },
  { key: "CLASSIFIED", label: "분류" },
  { key: "CANDIDATES_FOUND", label: "반경 후보" },
  { key: "SCANNING", label: "저FPS 탐색" },
  { key: "FOCUSED_ANALYSIS", label: "집중 분석" },
  { key: "SUMMARIZING", label: "요약" },
] as const;

export const OUTCOME: Record<string, { label: string; tone: "alert" | "quiet" | "warn" }> = {
  REVIEW_REQUIRED: { label: "관련 장면 후보 · 확인 필요", tone: "alert" },
  VIDEO_NOT_VISIBLE: { label: "영상에서 관련 장면 미발견", tone: "quiet" },
  NO_CAMERA_IN_RANGE: { label: "반경 안 승인 카메라 없음", tone: "quiet" },
  CAMERA_UNAVAILABLE: { label: "카메라 연결 불가", tone: "warn" },
  RECORDING_UNAVAILABLE: { label: "녹화 구간 없음", tone: "warn" },
  MANUAL_REVIEW_REQUIRED: { label: "분석 실패 · 수동 검토", tone: "warn" },
};

export function jobLabel(job: { state: string; stage: string }) {
  if (job.state === "queued") return job.stage === "awaiting_worker" ? "분석 대기" : "대기";
  if (job.state === "running") return STAGES.find((s) => s.key === job.stage)?.label ?? job.stage;
  return OUTCOME[job.stage]?.label ?? job.stage;
}

const KST = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const KST_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export const kst = (value: string | null | undefined) => (value ? KST.format(new Date(value)) : "—");
export const kstTime = (value: string | null | undefined) => (value ? KST_TIME.format(new Date(value)) : "—");
export const shortId = (id: string) => id.slice(0, 6).toUpperCase();
export const sourceLabel = (source: string) => (source === "demo" ? "모의 신고" : "시민 신고");
export const sourceLabelAI = (source: string | undefined) =>
  !source ? "—" : source.startsWith("openai:") ? `OpenAI ${source.slice(7)}` : source === "local_keywords" ? "키워드 규칙" : source === "local_rules" ? "로컬 규칙" : source;
