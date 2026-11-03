import type { Analysis, ReportDetail, ReportSummary } from "./api";
import { INCIDENT, OUTCOME, STAGES, jobLabel, sourceLabelAI } from "./labels";

export const STAGE_TAG: Record<string, string> = {
  RECEIVED: "RECEIVED",
  CLASSIFIED: "CLASSIFY",
  CANDIDATES_FOUND: "CANDIDATES",
  SCANNING: "SCAN",
  FOCUSED_ANALYSIS: "FOCUS",
  SUMMARIZING: "SUMMARY",
};
const MODE_WORDS: Record<string, string> = { selective: "관련 카메라만", all: "모든 카메라", benchmark: "비교 실험" };
export const TAG_LABEL: Record<string, string> = {
  RECEIVED: "접수", QUEUE: "대기", ATTACH: "첨부", CLASSIFY: "분류", CANDIDATES: "후보", SCAN: "탐색", FOCUS: "집중",
  SUMMARY: "요약", VOICE: "음성", PHONE: "사진", DONE: "완료", RERUN: "재분석", WARN: "주의", REVIEW: "처리",
  EXPAND: "반경 확대", LOG: "대응 기록", LINK: "기관 연결",
};
export const TAG_COLOR: Record<string, string> = {
  RECEIVED: "var(--w-text)",
  QUEUE: "var(--w-soft)",
  ATTACH: "var(--w-tide)",
  CLASSIFY: "var(--w-tide)",
  CANDIDATES: "var(--w-tide)",
  SCAN: "var(--w-tide)",
  FOCUS: "var(--w-beacon)",
  SUMMARY: "var(--w-beacon)",
  VOICE: "var(--w-tide)",
  PHONE: "var(--w-tide)",
  DONE: "var(--w-beacon)",
  RERUN: "var(--w-amber)",
  EXPAND: "var(--w-amber)",
  WARN: "var(--w-amber)",
  REVIEW: "var(--w-text)",
  LOG: "var(--w-tide)",
  LINK: "var(--w-amber)",
};

export type LogLine = { at: string; offset: number | null; tag: string; text: string; stage: number; run: number };

export const pct = (value: number | undefined) => (value === undefined ? "—" : `${Math.round(value * 100)}%`);

// One line per thing the pipeline did, built from the report's event log and its stored analysis.
export function buildLog(detail: ReportDetail): LogLine[] {
  const lines: LogLine[] = [];
  let start: number | null = null;
  let stage = 0, run = 0;
  const add = (at: string, tag: string, text: string) =>
    lines.push({ at, offset: start === null ? null : (new Date(at).getTime() - start) / 1000, tag, text, stage, run });
  // The stored analysis belongs to the latest run only; earlier runs (e.g. re-runs after an
  // attachment) keep their step names and outcome without borrowing the newest details.
  const lastRun = detail.events.map((e) => e.type).lastIndexOf("analysis_requested");
  // While a re-run is still going, the stored analysis is the previous run's.
  const fresh = currentAnalysis(detail, detail);
  detail.events.forEach((event, i) => {
    const latest = i >= lastRun;
    if (event.type === "received") {
      add(event.created_at, "RECEIVED", `${detail.source === "demo" ? "모의 신고" : "시민 신고"} · 반경 ${Math.round(detail.radius_m)}m${detail.description ? "" : " · 내용 없음"}`);
    } else if (event.type === "attachment") {
      const kind = String(event.data.kind ?? "");
      add(event.created_at, "ATTACH", `${kind === "image" ? "사진" : kind === "audio" ? "녹음" : kind === "video" ? "영상" : kind} 수신`);
    } else if (event.type === "analysis_requested") {
      stage = 0;
      run += 1;
      start = new Date(event.created_at).getTime();
      const p = event.data as Record<string, unknown>;
      add(event.created_at, "QUEUE", `분석 요청 · ${MODE_WORDS[String(p.mode ?? "selective")] ?? p.mode} · ${p.source === "recording" ? "녹화" : "실시간"} ${p.duration ?? 10}초`);
    } else if (event.type === "analysis_rerun") {
      add(event.created_at, "RERUN", "첨부 반영 재분석");
    } else if (event.type === "radius_expanded") {
      stage = 2;
      add(event.created_at, "EXPAND", event.message);
    } else if (event.type === "stage") {
      const position = STAGES.findIndex(s => s.key === event.message);
      if (position >= 0) stage = position;
      const tag = STAGE_TAG[event.message] ?? event.message;
      add(event.created_at, tag, stageText(event.message, latest ? fresh : null));
    } else if (event.type === "analysis_finished") {
      stage = 5;
      const outcome = OUTCOME[event.message]?.label ?? event.message;
      if (!latest) {
        add(event.created_at, "DONE", outcome);
        return;
      }
      const latency = fresh?.latency_seconds !== undefined ? ` · ${fresh.latency_seconds.toFixed(1)}초` : "";
      for (const phone of fresh?.phone ?? []) {
        if (phone.transcript) add(event.created_at, "VOICE", `“${phone.transcript}”`);
        else if (phone.analysis) add(event.created_at, "PHONE", `${phone.kind === "video" ? "영상" : "사진"} · ${phone.analysis.observations.map((o) => o.finding).join(", ") || "관찰 없음"}`);
      }
      for (const warning of fresh?.warnings ?? []) add(event.created_at, "WARN", warning);
      add(event.created_at, "DONE", `${outcome}${latency}`);
    } else if (event.type === "dispatch_simulated") {
      add(event.created_at, "LINK", `${event.message} (시연용 · 실제 전송 없음)`);
    } else if (event.type === "response_log") {
      add(event.created_at, "LOG", `${event.message}${event.data.text ? ` · ${String(event.data.text)}` : ""}`);
    } else if (event.type === "confirmed" || event.type === "closed") {
      add(event.created_at, "REVIEW", event.type === "confirmed" ? "담당자 확인" : "사건 종결");
    }
  });
  return lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function stageText(stage: string, analysis: Analysis | null) {
  if (!analysis) return jobLabel({ state: "running", stage });
  const cams = analysis.cameras;
  switch (stage) {
    case "CLASSIFIED": {
      const c = analysis.classification;
      return c ? `${INCIDENT[c.incident_type] ?? c.incident_type} · ${sourceLabelAI(c.source)}${c.keywords.length ? ` · ${c.keywords.slice(0, 4).join(", ")}` : ""}` : "분류";
    }
    case "CANDIDATES_FOUND":
      return analysis.candidates?.length ? analysis.candidates.map((c) => `${c.camera_id} ${Math.round(c.distance_m)}m`).join(" · ") : "반경 안 카메라 없음";
    case "SCANNING":
      return cams.filter((c) => c.scan).map((c) => `${c.camera_id} ${c.scan!.processed_frames}f 관련 ${pct(c.event_score)}`).join(" · ") || "탐색할 영상 없음";
    case "FOCUSED_ANALYSIS": {
      const focus = cams.filter((c) => c.focus);
      return focus.length
        ? focus.map((c) => `${c.camera_id} ${c.focus!.processed_frames}f → ${c.focus!.observations.map((o) => o.finding).join(", ") || "관찰 없음"}`).join(" · ")
        : "관련 장면이 보인 카메라 없음";
    }
    case "SUMMARIZING":
      return `보고서 · ${sourceLabelAI(analysis.summary?.source)}`;
    default:
      return stage;
  }
}

export function currentAnalysis(report: ReportSummary, detail: ReportDetail | null): Analysis | null {
  if (!detail || report.job.state === "queued" || report.job.state === "running") return null;
  const analysis = detail.analysis;
  const lastRun = detail.events.map(e => e.type).lastIndexOf("analysis_requested");
  return analysis && (lastRun < 0 || Date.parse(analysis.started_at) >= Date.parse(detail.events[lastRun].created_at)) ? analysis : null;
}
