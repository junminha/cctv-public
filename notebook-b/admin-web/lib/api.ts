// Browser-side helpers. Every call goes through the same-origin /api/b proxy.

export type Job = {
  id: string;
  report_id: string;
  state: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  error?: string | null;
  params?: AnalyzeParams | null;
};

export type AnalyzeParams = {
  mode: "selective" | "all" | "benchmark";
  source: "live" | "recording";
  duration: number;
  sample_fps: number;
  focus_fps: number;
  top_k: number;
  expand_steps?: number; // Older saved jobs omit this; the server defaults to two expansions.
};

export type Camera = {
  id: string;
  name: string;
  online: boolean;
  recording: boolean;
  fresh: boolean;
  approved: boolean;
  demo_source: boolean;
  latitude: number | null;
  longitude: number | null;
  kind: "real" | "demo" | null;
  zone: string | null;
  synced_at: string;
};

export type ReportSummary = {
  report_id: string;
  source: "reporter" | "demo";
  created_at: string;
  description: string;
  latitude: number;
  longitude: number;
  location_kind: "real" | "demo";
  radius_m: number;
  job: Job;
  review: Review | null;
  outcome: string | null;
  selected_camera_ids: string[];
  incident_type: string | null;
  // Live snapshot only: urgency is known at intake (keyword rules) before any analysis runs.
  priority?: "urgent" | "high" | "normal";
  priority_basis?: "analysis" | "keywords";
  alert_acknowledged?: boolean;
  response_logs?: number;
};

export type Review = {
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirm_note: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_note: string | null;
};

export type Evidence = { file: string; path?: string; timestamp_seconds: number; findings: string[] };
export type VisionResult = {
  observations: { finding: string; kind: string; timestamp_seconds: number | null; verified: boolean }[];
  evidence: Evidence[];
  relevance_score: number;
  processed_frames: number;
  elapsed_seconds: number;
  device: string;
  gpu_memory_peak_mb?: number;
  models?: { yolo?: string; pose?: string };
  warnings: string[];
};

export type AnalysisCamera = {
  camera_id: string;
  distance_m: number;
  zone: string | null;
  status: "available" | "CAMERA_UNAVAILABLE" | "RECORDING_UNAVAILABLE";
  detail?: string;
  window?: { start: string; duration: number; source: string; covers_report_time: boolean };
  scan?: VisionResult;
  focus?: VisionResult;
  all?: VisionResult;
  event_score?: number;
  rank_score?: number;
};

export type Summary = {
  incident_type: string;
  reporter_claim: string;
  cctv_observations: { camera_id: string; timestamp: string | null; finding: string; verified: boolean }[];
  phone_observations: string[];
  unverified_facts: string[];
  recommended_next_step: string;
  requires_human_review: boolean;
  source: string;
  warnings?: string[];
};

export type Benchmark = {
  selective: { frames: number; seconds: number; selected: string[] };
  all: { frames: number; seconds: number; selected: string[] };
  same_selection: boolean;
  frame_reduction: number | null;
  note: string;
};

export type PublicRecommendation = {
  id: string;
  name: string;
  district: string;
  purpose: string;
  latitude: number;
  longitude: number;
  distance_m: number;
  device_count: number;
  place: string | null;
  score: number;
  reasons: string[];
};

export type Nearby = {
  radius_m: number;
  center: { latitude: number; longitude: number };
  location_kind: "real" | "demo";
  webcams: {
    total: number;
    cameras: { id: string; name: string | null; zone: string | null; latitude: number | null; longitude: number | null; distance_m: number }[];
  };
  public: {
    devices: number;
    sites: number;
    purposes: Record<string, number>;
    places: Record<string, number>;
    recommended: PublicRecommendation[];
    source: string;
    note: string;
  };
};

export type BestCamera = {
  video: { camera_id: string; name: string | null; zone: string | null; latitude: number | null; longitude: number | null;
    distance_m: number | null; event_score: number | null; reason: string } | null;
  public: PublicRecommendation | null;
  note: string;
};

export type ResponsePlan = {
  priority: "urgent" | "high" | "normal";
  priority_label: string;
  steps: { action: string; reason: string }[];
  contacts: string[];
  cautions: string[];
  source: string;
};

export type Analysis = {
  report_id: string;
  mode: AnalyzeParams["mode"];
  params: AnalyzeParams;
  started_at: string;
  finished_at?: string;
  outcome: string;
  classification?: { incident_type: string; keywords: string[]; source: string; warnings: string[] };
  candidates?: { camera_id: string; distance_m: number; zone: string | null }[];
  cameras: AnalysisCamera[];
  selected_camera_ids: string[];
  summary?: Summary;
  phone: { attachment_id: string; kind: string; transcript?: string; source?: string; analysis?: VisionResult }[];
  benchmark?: Benchmark;
  warnings: string[];
  processing_seconds?: number;
  latency_seconds?: number;
  nearby?: Nearby;
  search?: {
    base_radius_m: number;
    radius_m: number;
    step_m: number;
    expanded: boolean;
    attempts: { radius_m: number; webcams: number }[];
  };
  best_camera?: BestCamera;
  response_plan?: ResponsePlan;
};

export type Attachment = {
  attachment_id: string;
  kind: "image" | "audio" | "video";
  content_type: string;
  bytes: number;
  sha256: string;
  original_name: string;
  created_at: string;
  download_path: string;
};

export type ReportEvent = { created_at: string; type: string; message: string; data: Record<string, unknown> };

export type ReportDetail = ReportSummary & {
  details: string;
  occurred_at: string | null;
  owner: string;
  attachments: Attachment[];
  events: ReportEvent[];
  analysis: Analysis | null;
};

export type Clip = {
  clip_id: string;
  camera_id: string;
  start: string;
  requested_duration: number;
  measured_duration: number;
  sha256: string;
  bytes: number;
  duration_matches_request: boolean;
  created_at: string;
  download_path: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const bPath = (path: string) => `/api/b${path}`;

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(bPath(path), {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new ApiError(401, "로그인이 필요합니다.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : `요청 실패 (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}
