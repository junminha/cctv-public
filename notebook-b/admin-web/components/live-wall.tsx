"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, bPath, type Analysis, type ReportDetail, type ReportSummary, type VisionResult } from "@/lib/api";
import { INCIDENT, OUTCOME, STAGES, jobLabel, kstTime, shortId, sourceLabelAI } from "@/lib/labels";
import { useLive } from "@/lib/live";
import { byUrgency } from "@/lib/urgent";
import { ReportGuidance } from "./report-guidance";
import { UrgentBanner } from "./urgent-banner";

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
  EXPAND: "var(--w-amber)",
  WARN: "var(--w-amber)",
  REVIEW: "var(--w-text)",
  LOG: "var(--w-tide)",
};

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
    } else if (event.type === "radius_expanded") {
      add(event.created_at, "EXPAND", event.message);
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
    } else if (event.type === "response_log") {
      add(event.created_at, "LOG", `${event.message}${event.data.text ? ` · ${String(event.data.text)}` : ""}`);
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

const MODE_LABEL: Record<string, string> = { selective: "선택 분석", all: "전체 분석", benchmark: "선택·전체 비교" };
const KIND: Record<string, { code: string; label: string }> = {
  image: { code: "PHOTO", label: "사진" },
  audio: { code: "VOICE", label: "녹음" },
  video: { code: "VIDEO", label: "영상" },
};
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);
const engine = (source: string | undefined) => (source === "unavailable" ? "사용 안 함" : sourceLabelAI(source));
const findings = (result: VisionResult | undefined) => result?.observations.map((o) => o.finding).join(", ") || "관찰 없음";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-row">
      <span className="soft">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function Item({ code, tone, children }: { code: string; tone?: string; children: ReactNode }) {
  return (
    <li className="item">
      <span className="code" style={{ color: tone ?? "var(--w-soft)" }}>
        {code}
      </span>
      <div className="flex min-w-0 flex-col gap-[0.15em]">{children}</div>
    </li>
  );
}

function Evidence({ src, caption }: { src: string; caption: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <figure className="evidence">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy image */}
      <img src={src} alt={`AI 근거 프레임: ${caption}`} onError={() => setBroken(true)} />
      <figcaption className="truncate">{caption}</figcaption>
    </figure>
  );
}

const CAMERA_STATE: Record<string, { label: string; tone: string }> = {
  focus: { label: "집중 분석", tone: "var(--w-beacon)" },
  skip: { label: "건너뜀", tone: "var(--w-amber)" },
  CAMERA_UNAVAILABLE: { label: "연결 안 됨", tone: "var(--w-soft)" },
  RECORDING_UNAVAILABLE: { label: "녹화 없음", tone: "var(--w-soft)" },
};

// What the analysis looked at and which engine handled each part, for the report on screen.
function AnalysisRecord({ report, detail }: { report: ReportSummary; detail: ReportDetail | null }) {
  const analysis = detail?.analysis ?? null;
  const lastRun = detail ? detail.events.map((e) => e.type).lastIndexOf("analysis_requested") : -1;
  const fresh = detail && analysis && (lastRun < 0 || analysis.started_at >= detail.events[lastRun].created_at) ? analysis : null;
  const params = fresh?.params ?? report.job.params ?? null;
  const pending = report.job.state === "queued" || report.job.state === "running";
  const vision = fresh?.cameras.flatMap((c) => [c.scan, c.focus, c.all]).concat(fresh.phone.map((p) => p.analysis)).filter((v): v is VisionResult => Boolean(v)) ?? [];
  const models = vision.find((v) => v.models)?.models;
  const gpuPeak = Math.max(0, ...vision.map((v) => v.gpu_memory_peak_mb ?? 0));
  const frames = vision.reduce((sum, v) => sum + v.processed_frames, 0);
  const voice = [...new Set(fresh?.phone.filter((p) => p.kind === "audio").map((p) => engine(p.source)) ?? [])];
  const text = detail?.description ?? report.description;

  return (
    <div className="sheet min-h-0 flex-1 overflow-y-auto">
      <section>
        <h3 className="sheet-title">방식</h3>
        {params ? (
          <>
            <Row label="분석">{MODE_LABEL[params.mode] ?? params.mode}</Row>
            <Row label="영상">
              {params.source === "recording" ? "녹화 구간" : "실시간"} {params.duration}초
            </Row>
            <Row label="프레임">
              <span className="num">
                탐색 {params.sample_fps}fps → 집중 {params.focus_fps}fps · 상위 {params.top_k}대
              </span>
            </Row>
          </>
        ) : (
          <Row label="분석">요청 전</Row>
        )}
        {fresh?.processing_seconds !== undefined && (
          <Row label="처리">
            <span className="num">
              {fresh.processing_seconds.toFixed(1)}초{frames ? ` · ${frames}프레임` : ""}
            </span>
          </Row>
        )}
        {fresh?.latency_seconds !== undefined && (
          <Row label="신고부터">
            <span className="num">{fresh.latency_seconds.toFixed(1)}초</span>
          </Row>
        )}
        {fresh?.benchmark?.frame_reduction != null && (
          <Row label="전체 대비">
            <span className="num">프레임 {Math.round(fresh.benchmark.frame_reduction * 100)}% 절감</span>
          </Row>
        )}
      </section>

      <ReportGuidance key={report.report_id} report={report} analysis={pending ? null : fresh} compact />

      <section>
        <h3 className="sheet-title">사용한 모델</h3>
        {fresh ? (
          <>
            <Row label="신고 분류">{engine(fresh.classification?.source)}</Row>
            {voice.length > 0 && <Row label="음성 전사">{voice.join(", ")}</Row>}
            {models?.yolo && (
              <Row label="객체 탐지">
                <span className="mono">{models.yolo}</span>
              </Row>
            )}
            {models?.pose && (
              <Row label="자세 추정">
                <span className="mono">{models.pose}</span>
              </Row>
            )}
            {vision.length > 0 && (
              <Row label="연산 장치">
                <span className="num">
                  <span className="mono">{vision[0].device}</span>
                  {gpuPeak > 0 ? ` · 최대 ${Math.round(gpuPeak)}MB` : ""}
                </span>
              </Row>
            )}
            <Row label="보고서">{engine(fresh.summary?.source)}</Row>
          </>
        ) : (
          <p className="sheet-note soft">{pending ? "분석이 끝나면 표시돼요." : "분석 기록 없음"}</p>
        )}
      </section>

      <section>
        <h3 className="sheet-title">분석 자료</h3>
        <ul>
          <Item code="TEXT" tone="var(--w-text)">
            <span className={text ? "clamp2" : "soft"}>{text || "내용 없이 위치만 보냄"}</span>
            {detail?.details && <span className="soft truncate text-[0.9em]">장소: {detail.details}</span>}
          </Item>
          {detail?.attachments.map((file) => {
            const result = fresh?.phone.find((p) => p.attachment_id === file.attachment_id);
            const kind = KIND[file.kind] ?? { code: file.kind.toUpperCase(), label: file.kind };
            return (
              <Item key={file.attachment_id} code={kind.code} tone="var(--w-tide)">
                <span className="num soft text-[0.9em]">
                  {kind.label} · {size(file.bytes)} · {kstTime(file.created_at)}
                </span>
                {result?.transcript ? (
                  <span className="clamp2">“{result.transcript}”</span>
                ) : result?.analysis ? (
                  <span className="clamp2">{findings(result.analysis)}</span>
                ) : (
                  <span className="soft">{pending ? "분석 대기" : result ? "결과 없음" : "이번 분석에 포함 안 됨"}</span>
                )}
              </Item>
            );
          })}
          {fresh
            ? fresh.cameras.map((row) => {
                const state = row.status !== "available" ? row.status : fresh.selected_camera_ids.includes(row.camera_id) ? "focus" : "skip";
                const badge = CAMERA_STATE[state] ?? { label: state, tone: "var(--w-soft)" };
                const evidence = row.focus?.evidence[0] ?? (state === "focus" ? row.scan?.evidence[0] : undefined);
                return (
                  <Item key={row.camera_id} code={row.camera_id.toUpperCase()} tone={badge.tone}>
                    <span className="flex items-baseline justify-between gap-[0.6em]">
                      <span className="num soft truncate text-[0.9em]">
                        {Math.round(row.distance_m)}m{row.window ? ` · ${row.window.source === "recording" ? "녹화" : "실시간"} ${row.window.duration}초` : ""}
                      </span>
                      <span className="shrink-0 font-semibold" style={{ color: badge.tone }}>
                        {badge.label}
                      </span>
                    </span>
                    {row.scan ? (
                      <span className="num text-[0.9em]">
                        탐색 {row.scan.processed_frames}f{row.focus ? ` + 집중 ${row.focus.processed_frames}f` : ""} · 관련 {pct(row.event_score)}
                      </span>
                    ) : (
                      <span className="soft text-[0.9em]">영상을 받지 못함</span>
                    )}
                    {row.focus && <span className="clamp2">{findings(row.focus)}</span>}
                    {evidence?.path && (
                      <Evidence src={bPath(`/api/v1/admin/reports/${report.report_id}/artifacts/${evidence.path}`)} caption={evidence.findings[0] ?? "관련 장면 후보"} />
                    )}
                  </Item>
                );
              })
            : pending && (
                <Item code="CAM">
                  <span className="soft">반경 안 웹캠 영상 분석 중</span>
                </Item>
              )}
          {fresh && fresh.cameras.length === 0 && (
            <Item code="CAM">
              <span className="soft">반경 안 웹캠 없음</span>
            </Item>
          )}
        </ul>
      </section>
    </div>
  );
}

function ReportItem({ report, selected, onSelect }: { report: ReportSummary; selected: boolean; onSelect: () => void }) {
  const running = report.job.state === "running";
  const done = report.job.state === "completed" || report.job.state === "failed";
  const tone = done ? (OUTCOME[report.job.stage]?.tone === "alert" ? "var(--w-beacon)" : OUTCOME[report.job.stage]?.tone === "warn" ? "var(--w-amber)" : "var(--w-soft)") : running ? "var(--w-beacon)" : "var(--w-soft)";
  return (
    <button type="button" className="report-item min-w-0" aria-current={selected} onClick={onSelect}>
      <span className="mono soft flex items-center gap-[0.6em] text-[0.82em]">
        {running && <span className="live-mark" />}
        {report.priority === "urgent" && !report.review?.closed_at && <span className={`urgent-tag ${report.alert_acknowledged ? "seen" : ""}`}>긴급</span>}
        <span>{kstTime(report.created_at)}</span>
        <span>#{shortId(report.report_id)}</span>
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
  const logEnd = useRef<HTMLDivElement>(null);

  const reports = useMemo(() => byUrgency([...(snapshot?.reports ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))), [snapshot]);
  // Follow the report being analysed unless one was clicked.
  const auto = reports.find((r) => r.job.state === "running") ?? reports.find((r) => r.job.state === "queued" && r.job.params) ?? reports[0] ?? null;
  const focus = (pinned && reports.find((r) => r.report_id === pinned)) || auto;
  const index = stageIndex(focus);
  const running = focus?.job.state === "running";
  const failed = focus?.job.state === "failed";
  const focusKey = focus ? `${focus.report_id}:${focus.radius_m}:${focus.job.state}:${focus.job.stage}:${focus.job.progress}:${focus.response_logs ?? 0}:${focus.review?.confirmed_at}` : "";

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

  const detail = focus ? details[focus.report_id] ?? null : null;
  const log = useMemo(() => (detail ? buildLog(detail) : []), [detail]);
  const lastAt = log.length ? new Date(log[log.length - 1].at).getTime() : null;
  const elapsed = running && now && lastAt ? Math.max(0, (now - lastAt) / 1000) : null;
  const clock = now ? kstTime(new Date(now).toISOString()) : "";

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log.length, focus?.report_id]);

  return (
    <main className="wall fixed inset-0 flex flex-col gap-[0.9em] overflow-hidden p-[1.2em]">
      <header className="masthead flex items-end justify-between gap-[2em] pb-[0.5em]">
        <h1 className="display text-[1.7em] leading-none">AI 분석 로그</h1>
        <div className="num flex items-center gap-[0.7em]" aria-live="polite">
          <span className="state-mark" style={{ background: connection === "live" ? "var(--w-tide)" : "var(--w-amber)" }} />
          <span>{connection === "live" ? "LIVE" : connection === "offline" ? "다시 연결하는 중" : "연결 중"}</span>
          <span className="soft">{clock}</span>
        </div>
      </header>
      <UrgentBanner reports={reports} onShow={setPinned} />

      {/* minmax(0, …): long report text must truncate, never widen a column. */}
      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.8fr)_minmax(0,1.55fr)_minmax(0,1.1fr)] gap-[0.9em]">
        <aside className="panel flex min-h-0 flex-col">
          <div className="panel-head">
            <h2>신고</h2>
            <button type="button" onClick={() => setPinned(null)} className="toggle" aria-pressed={!pinned}>
              자동
            </button>
          </div>
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {reports.slice(0, 30).map((report) => (
              <ReportItem key={report.report_id} report={report} selected={report.report_id === focus?.report_id} onSelect={() => setPinned(report.report_id)} />
            ))}
            {reports.length === 0 && <p className="soft px-[0.8em] py-[0.6em]">신고 없음</p>}
          </div>
        </aside>

        <article className="panel flex min-h-0 flex-col">
          {focus ? (
            <>
              <div className="flex flex-col gap-[0.35em] px-[1em] pb-[0.8em] pt-[0.9em]">
                <p className="num soft text-[0.85em]">
                  #{shortId(focus.report_id)} · {kstTime(focus.created_at)} · {focus.source === "demo" ? "모의" : "시민"} · 반경 {Math.round(focus.radius_m)}m
                </p>
                <p className={`display clamp2 text-[1.5em] leading-[1.3] ${focus.description ? "" : "soft"}`}>{focus.description || "위치만 보낸 신고"}</p>
              </div>
              <ol className="stages" aria-label="분석 단계">
                {STAGES.map((stage, i) => {
                  const state = failed ? "fail" : index > i || index >= STAGES.length ? "done" : index === i && running ? "now" : "todo";
                  return (
                    <li key={stage.key} className={`stage ${state}`}>
                      {stage.label}
                    </li>
                  );
                })}
              </ol>
              <div className="log min-h-0 flex-1 overflow-y-auto px-[0.6em] py-[0.5em]" role="log" aria-live="polite">
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

        <aside className="panel flex min-h-0 flex-col" aria-label="분석 기록">
          <div className="panel-head">
            <h2>분석 기록</h2>
            {focus && <span className="mono soft text-[0.85em]">#{shortId(focus.report_id)}</span>}
          </div>
          {focus ? <AnalysisRecord report={focus} detail={detail} /> : <p className="soft px-[0.8em] py-[0.6em]">신고를 고르면 분석 자료와 사용한 모델이 나와요.</p>}
        </aside>
      </section>
    </main>
  );
}
