"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, bPath, type Analysis, type AnalysisCamera, type Camera, type ReportDetail, type ReportSummary } from "@/lib/api";
import { INCIDENT, OUTCOME, STAGES, jobLabel, kstTime, shortId, sourceLabelAI } from "@/lib/labels";
import { useLive } from "@/lib/live";

const FRAME_EVERY_MS = 5000;
const STAGE_TAG: Record<string, string> = {
  RECEIVED: "RECEIVED",
  CLASSIFIED: "CLASSIFY",
  CANDIDATES_FOUND: "CANDIDATES",
  SCANNING: "SCAN",
  FOCUSED_ANALYSIS: "FOCUS",
  SUMMARIZING: "SUMMARY",
};
const TAG_COLOR: Record<string, string> = {
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
  WARN: "var(--w-amber)",
  REVIEW: "var(--w-text)",
};

type LensState = "live" | "waiting" | "scanning" | "focus" | "skip" | "out" | "down";
type LogLine = { at: string; offset: number | null; tag: string; text: string };

function stageIndex(report: ReportSummary | null) {
  if (!report) return -1;
  if (report.job.state === "completed" || report.job.state === "failed") return STAGES.length;
  if (report.job.state === "running") return Math.max(0, STAGES.findIndex((s) => s.key === report.job.stage));
  return 0;
}

const pct = (value: number | undefined) => (value === undefined ? "—" : `${Math.round(value * 100)}%`);

// One line per thing the pipeline did, built from the report's event log and its stored analysis.
function buildLog(detail: ReportDetail): LogLine[] {
  const analysis: Analysis | null = detail.analysis;
  const lines: LogLine[] = [];
  let start: number | null = null;
  const add = (at: string, tag: string, text: string) =>
    lines.push({ at, offset: start === null ? null : (new Date(at).getTime() - start) / 1000, tag, text });
  // The stored analysis belongs to the latest run only; earlier runs (e.g. re-runs after an
  // attachment) keep their step names and outcome without borrowing the newest details.
  const lastRun = detail.events.map((e) => e.type).lastIndexOf("analysis_requested");
  // While a re-run is still going, the stored analysis is the previous run's.
  const fresh = analysis && (lastRun < 0 || analysis.started_at >= detail.events[lastRun].created_at) ? analysis : null;
  detail.events.forEach((event, i) => {
    const latest = i >= lastRun;
    if (event.type === "received") {
      add(event.created_at, "RECEIVED", `${detail.source === "demo" ? "모의 신고" : "시민 신고"} · 반경 ${Math.round(detail.radius_m)}m${detail.description ? "" : " · 내용 없음"}`);
    } else if (event.type === "attachment") {
      const kind = String(event.data.kind ?? "");
      add(event.created_at, "ATTACH", `${kind === "image" ? "사진" : kind === "audio" ? "녹음" : kind === "video" ? "영상" : kind} 수신`);
    } else if (event.type === "analysis_requested") {
      start = new Date(event.created_at).getTime();
      const p = event.data as Record<string, unknown>;
      add(event.created_at, "QUEUE", `분석 요청 · ${p.mode ?? "selective"} · ${p.source === "recording" ? "녹화" : "실시간"} ${p.duration ?? 10}초`);
    } else if (event.type === "analysis_rerun") {
      add(event.created_at, "RERUN", "첨부 반영 재분석");
    } else if (event.type === "stage") {
      const tag = STAGE_TAG[event.message] ?? event.message;
      add(event.created_at, tag, stageText(event.message, latest ? fresh : null));
    } else if (event.type === "analysis_finished") {
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
    } else if (event.type === "confirmed" || event.type === "closed") {
      add(event.created_at, "REVIEW", event.type === "confirmed" ? "담당자 확인" : "사건 종결");
    }
  });
  return lines;
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

function lensState(camera: Camera, report: ReportSummary | null, detail: ReportDetail | null, index: number): { state: LensState; row?: AnalysisCamera } {
  if (!camera.online) return { state: "down" };
  if (!report || !camera.approved || report.job.state === "failed") return { state: "live" };
  const analysis = detail?.report_id === report.report_id ? detail.analysis : null;
  if (index >= STAGES.length && analysis) {
    const row = analysis.cameras.find((c) => c.camera_id === camera.id);
    const candidate = analysis.candidates?.some((c) => c.camera_id === camera.id) ?? Boolean(row);
    if (!candidate) return { state: "out" };
    if (row && row.status !== "available") return { state: "down", row };
    return { state: analysis.selected_camera_ids.includes(camera.id) ? "focus" : "skip", row };
  }
  if (index >= STAGES.length) return { state: "live" };
  return { state: index <= 1 ? "waiting" : "scanning" };
}

const LENS_LABEL: Record<LensState, string> = {
  live: "실시간",
  waiting: "대기",
  scanning: "분석 중",
  focus: "집중 분석",
  skip: "건너뜀",
  out: "반경 밖",
  down: "연결 안 됨",
};
const LENS_COLOR: Partial<Record<LensState, string>> = { focus: "var(--w-beacon)", skip: "var(--w-amber)", scanning: "var(--w-tide)" };

function Lens({ camera, state, row, reportId, frame, clock }: { camera: Camera; state: LensState; row?: AnalysisCamera; reportId?: string; frame: number; clock: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const evidence = state === "focus" ? row?.focus?.evidence[0] ?? row?.scan?.evidence[0] : undefined;
  const src =
    state === "down"
      ? null
      : evidence?.path && reportId
        ? bPath(`/api/v1/admin/reports/${reportId}/artifacts/${evidence.path}`)
        : `${bPath(`/api/v1/admin/cameras/${camera.id}/snapshot`)}?f=${frame}`;
  const failed = !src || broken === src;
  const metric = row?.scan ? `${row.scan.processed_frames + (row.focus?.processed_frames ?? 0)}f · 관련 ${pct(row.event_score)}` : `${camera.zone ?? camera.name}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.3em]">
      <div className={`lens min-h-0 flex-1 ${state}`}>
        {!failed ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy images, refreshed in place
          <img src={src!} alt={`${camera.id} ${evidence ? "AI 근거 프레임" : "실시간 화면"}`} onError={() => setBroken(src)} />
        ) : (
          <div className="nosignal" />
        )}
        {state === "scanning" && <div className="scanline" />}
        <div className="shutter" />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="hud mono left-[1.1em] top-[0.9em]">{camera.id.toUpperCase()}</span>
        {!failed && camera.recording && !evidence && (
          <span className="hud right-[1.1em] top-[0.9em]">
            <span className="rec" /> REC
          </span>
        )}
        {evidence ? (
          <span className="hud bottom-[0.9em] left-[1.1em] right-[1.1em]">{evidence.findings[0] ?? "관련 장면 후보"}</span>
        ) : (
          !failed && <span className="hud mono bottom-[0.9em] right-[1.1em]">{clock}</span>
        )}
        {(state === "skip" || state === "out" || failed) && (
          <div className="stamp">
            <span className="display text-[1.6em]" style={{ color: state === "skip" ? "#f3c26b" : state === "down" || failed ? "var(--w-soft)" : "#dbe5e2" }}>
              {state === "skip" ? "건너뜀" : state === "out" ? "반경 밖" : state === "down" ? "연결 안 됨" : "화면 없음"}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-[0.6em] text-[0.95em]">
        <span className="mono soft truncate">{metric}</span>
        <span className="display shrink-0" style={{ color: LENS_COLOR[state] ?? "var(--w-soft)" }}>
          {LENS_LABEL[state]}
        </span>
      </div>
    </div>
  );
}

function ReportItem({ report, selected, onSelect }: { report: ReportSummary; selected: boolean; onSelect: () => void }) {
  const running = report.job.state === "running";
  const done = report.job.state === "completed" || report.job.state === "failed";
  const tone = done ? (OUTCOME[report.job.stage]?.tone === "alert" ? "var(--w-beacon)" : OUTCOME[report.job.stage]?.tone === "warn" ? "var(--w-amber)" : "var(--w-soft)") : running ? "var(--w-beacon)" : "var(--w-soft)";
  return (
    <button type="button" className="report-item min-w-0" aria-current={selected} onClick={onSelect}>
      <span className="flex items-center gap-[0.5em] text-[0.85em]">
        {running && <span className="pulse" />}
        <span className="mono soft">{kstTime(report.created_at)}</span>
        <span className="mono soft">#{shortId(report.report_id)}</span>
      </span>
      <span className={`truncate ${report.description ? "" : "soft"}`}>{report.description || "위치만 보낸 신고"}</span>
      <span className="truncate text-[0.85em]" style={{ color: tone }}>
        {jobLabel(report.job)}
        {running && ` · ${Math.round(report.job.progress * 100)}%`}
      </span>
    </button>
  );
}

export function LiveWall() {
  const { snapshot, connection } = useLive();
  const [details, setDetails] = useState<Record<string, ReportDetail>>({});
  const [pinned, setPinned] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const logEnd = useRef<HTMLDivElement>(null);

  const reports = useMemo(() => [...(snapshot?.reports ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [snapshot]);
  // Follow the report being analysed unless one was clicked.
  const auto = reports.find((r) => r.job.state === "running") ?? reports.find((r) => r.job.state === "queued" && r.job.params) ?? reports[0] ?? null;
  const focus = (pinned && reports.find((r) => r.report_id === pinned)) || auto;
  const index = stageIndex(focus);
  const running = focus?.job.state === "running";
  const cameras = (snapshot?.cameras ?? []).filter((c) => c.demo_source).sort((a, b) => a.id.localeCompare(b.id));
  const focusKey = focus ? `${focus.report_id}:${focus.job.state}:${focus.job.stage}:${focus.job.progress}` : "";
  const anyRunning = reports.some((r) => r.job.state === "running");

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!focus) return;
    let alive = true;
    api<ReportDetail>(`/api/v1/admin/reports/${focus.report_id}`)
      .then((value) => alive && setDetails((current) => ({ ...current, [value.report_id]: value })))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // focusKey captures every change that matters for the detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Live webcam frames, paused while the GPU is analysing.
  useEffect(() => {
    if (anyRunning) return;
    const timer = setInterval(() => setFrame((n) => n + 1), FRAME_EVERY_MS);
    return () => clearInterval(timer);
  }, [anyRunning]);

  const detail = focus ? details[focus.report_id] ?? null : null;
  const log = useMemo(() => (detail ? buildLog(detail) : []), [detail]);
  const lastAt = log.length ? new Date(log[log.length - 1].at).getTime() : null;
  const elapsed = running && now && lastAt ? Math.max(0, (now - lastAt) / 1000) : null;
  const clock = now ? kstTime(new Date(now).toISOString()) : "";

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log.length, focus?.report_id]);

  return (
    <main className="wall fixed inset-0 flex flex-col gap-[1em] overflow-hidden p-[1.4em]">
      <header className="panel flex items-center justify-between gap-[2em] px-[1em] py-[0.6em]">
        <h1 className="display text-[1.7em] leading-none">AI 분석 로그</h1>
        <div className="flex items-center gap-[0.7em] text-[1.05em]" aria-live="polite">
          <span className="inline-block h-[0.7em] w-[0.7em] rounded-full" style={{ background: connection === "live" ? "var(--w-beacon)" : "var(--w-amber)" }} />
          <span className="display">{connection === "live" ? "LIVE" : connection === "offline" ? "다시 연결하는 중" : "연결 중"}</span>
          <span className="mono soft">{clock}</span>
        </div>
      </header>

      {/* minmax(0, …): long report text must truncate, never widen a column. */}
      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.8fr)_minmax(0,1.65fr)_minmax(0,1fr)] gap-[1em]">
        <aside className="panel flex min-h-0 flex-col p-[0.8em]">
          <div className="flex items-center justify-between px-[0.4em] pb-[0.5em]">
            <h2 className="display text-[1.15em]">신고</h2>
            <button
              type="button"
              onClick={() => setPinned(null)}
              className="rounded-[0.5em] px-[0.6em] py-[0.15em] text-[0.85em]"
              style={{ border: "1px solid var(--w-line)", color: pinned ? "var(--w-text)" : "var(--w-beacon)", borderColor: pinned ? "var(--w-line)" : "var(--w-beacon)" }}
              aria-pressed={!pinned}>
              자동
            </button>
          </div>
          <div className="flex min-h-0 flex-col gap-[0.25em] overflow-y-auto pr-[0.2em]">
            {reports.slice(0, 30).map((report) => (
              <ReportItem key={report.report_id} report={report} selected={report.report_id === focus?.report_id} onSelect={() => setPinned(report.report_id)} />
            ))}
            {reports.length === 0 && <p className="soft px-[0.4em]">신고 없음</p>}
          </div>
        </aside>

        <article className="panel flex min-h-0 flex-col gap-[0.6em] p-[1.1em]">
          {focus ? (
            <>
              <div className="flex flex-col gap-[0.3em]">
                <p className="mono soft text-[0.85em]">
                  #{shortId(focus.report_id)} · {kstTime(focus.created_at)} · {focus.source === "demo" ? "모의" : "시민"} · 반경 {Math.round(focus.radius_m)}m
                </p>
                <p className={`display clamp2 text-[1.5em] leading-[1.3] ${focus.description ? "" : "soft"}`}>{focus.description || "위치만 보낸 신고"}</p>
              </div>
              <div className="flex gap-[0.25em]" aria-label="분석 단계">
                {STAGES.map((stage, i) => {
                  const state = index > i || index >= STAGES.length ? "var(--w-tide)" : index === i && running ? "var(--w-beacon)" : "var(--w-line)";
                  return (
                    <div key={stage.key} className="flex flex-1 flex-col gap-[0.2em]">
                      <div className="h-[0.35em] rounded-full" style={{ background: state }} />
                      <span className="text-[0.75em]" style={{ color: state === "var(--w-line)" ? "var(--w-soft)" : "var(--w-text)" }}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="log min-h-0 flex-1 overflow-y-auto rounded-[0.6em] border border-[var(--w-line)] bg-[var(--w-sunk)] p-[0.6em]" role="log" aria-live="polite">
                {log.map((line, i) => (
                  <div key={`${line.at}-${line.tag}-${i}`} className="log-line">
                    <span className="soft">{kstTime(line.at)}</span>
                    <span className="soft">{line.offset !== null && line.offset >= 0 ? `+${line.offset.toFixed(1)}s` : ""}</span>
                    <span className="log-tag" style={{ color: TAG_COLOR[line.tag] ?? "var(--w-text)" }}>
                      {line.tag}
                    </span>
                    <span className="log-msg">{line.text}</span>
                  </div>
                ))}
                {(running || focus.job.state === "queued") && (
                  <div className="log-line">
                    <span className="soft">{clock}</span>
                    <span className="soft">{elapsed !== null ? `${elapsed.toFixed(0)}s` : ""}</span>
                    <span className="log-tag" style={{ color: "var(--w-beacon)" }}>
                      {running ? STAGE_TAG[focus.job.stage] ?? focus.job.stage : "QUEUE"}
                    </span>
                    <span className="log-msg">
                      {running ? `${jobLabel(focus.job)} 진행 중` : "분석 대기"} <span className="cursor" />
                    </span>
                  </div>
                )}
                {!detail && <p className="soft">불러오는 중</p>}
                <div ref={logEnd} />
              </div>
            </>
          ) : (
            <p className="soft m-auto text-[1.2em]">신고가 들어오면 분석 로그가 여기에 나와요.</p>
          )}
        </article>

        <div className="flex min-h-0 flex-col gap-[0.8em]">
          {cameras.map((camera) => {
            const { state, row } = lensState(camera, focus, detail, index);
            return <Lens key={camera.id} camera={camera} state={state} row={row} reportId={focus?.report_id} frame={frame} clock={clock} />;
          })}
          {cameras.length === 0 && <p className="soft">웹캠 정보 없음</p>}
        </div>
      </section>
    </main>
  );
}
