"use client";

import { useEffect, useMemo, useState } from "react";
import { api, bPath, type AnalysisCamera, type Camera, type ReportDetail, type ReportSummary } from "@/lib/api";
import { INCIDENT, OUTCOME, STAGES, kstTime, shortId } from "@/lib/labels";
import { useLive } from "@/lib/live";

// What each step means, in words a passing visitor can follow.
const EXPLAIN: Record<string, string> = {
  RECEIVED: "시민의 신고가 서버에 도착했어요.",
  CLASSIFIED: "신고 글과 목소리를 읽고 어떤 사건인지 정해요.",
  CANDIDATES_FOUND: "신고 위치 반경 안에 있는 카메라만 골라요.",
  SCANNING: "고른 카메라 영상을 1초에 한 장씩 빠르게 훑어봐요.",
  FOCUSED_ANALYSIS: "관련 장면이 보인 카메라만 자세히 들여다봐요.",
  SUMMARIZING: "AI가 본 것을 담당자용 보고서로 정리해요.",
};
const WAITING = "신고 위치를 확인하고 분석 순서를 기다려요.";

type LensState = "live" | "waiting" | "candidate" | "scanning" | "focusing" | "focus" | "skip" | "out" | "down";

function pickFocus(reports: ReportSummary[]) {
  const recent = [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return recent.find((r) => r.job.state === "running") ?? recent.find((r) => r.job.state === "queued" && r.job.params) ?? recent[0] ?? null;
}

function stageIndex(report: ReportSummary | null) {
  if (!report) return -1;
  if (report.job.state === "completed" || report.job.state === "failed") return STAGES.length;
  if (report.job.state === "running") return Math.max(0, STAGES.findIndex((s) => s.key === report.job.stage));
  return 0;
}

function lensState(camera: Camera, report: ReportSummary | null, detail: ReportDetail | null, index: number): { state: LensState; row?: AnalysisCamera } {
  if (!camera.online) return { state: "down" };
  if (!report || !camera.approved) return { state: "live" };
  const analysis = detail?.report_id === report.report_id ? detail.analysis : null;
  if (index >= STAGES.length && analysis) {
    const row = analysis.cameras.find((c) => c.camera_id === camera.id);
    const candidate = analysis.candidates?.some((c) => c.camera_id === camera.id) ?? Boolean(row);
    if (!candidate) return { state: "out" };
    if (row && row.status !== "available") return { state: "down", row };
    return { state: analysis.selected_camera_ids.includes(camera.id) ? "focus" : "skip", row };
  }
  if (index >= STAGES.length) return { state: "live" };
  if (index <= 1) return { state: "waiting" };
  return { state: index === 2 ? "candidate" : index === 3 ? "scanning" : "focusing" };
}

const LENS_LABEL: Record<LensState, string> = {
  live: "실시간",
  waiting: "대기",
  candidate: "반경 안 후보",
  scanning: "빠르게 훑는 중",
  focusing: "분석 중",
  focus: "집중 분석",
  skip: "건너뜀 · 관련 장면 없음",
  out: "반경 밖 · 보지 않음",
  down: "연결 안 됨",
};

export function LiveWall() {
  const { snapshot, connection } = useLive();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [metrics, setMetrics] = useState<{ reports: Record<string, number>; latency_seconds: { mean: number } | null; benchmarks: { frame_reduction: number | null }[] } | null>(null);

  const reports = useMemo(() => snapshot?.reports ?? [], [snapshot]);
  const focus = useMemo(() => pickFocus(reports), [reports]);
  const index = stageIndex(focus);
  const running = focus?.job.state === "running";
  const cameras = (snapshot?.cameras ?? []).filter((c) => c.demo_source).sort((a, b) => a.id.localeCompare(b.id));
  const focusKey = focus ? `${focus.report_id}:${focus.job.state}:${focus.job.stage}` : "";

  useEffect(() => {
    const tick = () => setNow(new Date());
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
    api<ReportDetail>(`/api/v1/admin/reports/${focus.report_id}`).then((value) => alive && setDetail(value)).catch(() => {});
    return () => {
      alive = false;
    };
    // focusKey captures every change that matters for the detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    const load = () => api<typeof metrics>("/api/v1/admin/metrics").then(setMetrics).catch(() => {});
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // Live webcam frames, paused while the GPU is analysing so the booth stays responsive.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (running) return;
    const timer = setInterval(() => setFrame((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, [running]);

  const shown = detail && focus && detail.report_id === focus.report_id ? detail : null;
  const analysis = shown?.analysis ?? null;
  const done = index >= STAGES.length;
  const stageKey = running ? focus?.job.stage ?? "" : "";
  const transcripts = (analysis?.phone ?? []).filter((p) => p.transcript).map((p) => p.transcript as string);
  const attachments = shown?.attachments ?? [];
  const count = (kind: string) => attachments.filter((a) => a.kind === kind).length;
  const today = reports.filter((r) => now && new Date(r.created_at).toDateString() === now.toDateString());
  const reduction = metrics?.benchmarks.find((b) => b.frame_reduction !== null)?.frame_reduction ?? null;
  const outcome = done && focus ? OUTCOME[focus.job.stage] : null;

  return (
    <main className="wall fixed inset-0 flex flex-col gap-[1.2em] overflow-hidden p-[1.6em]">
      <header className="flex items-end justify-between gap-[2em]">
        <div>
          <p className="soft text-[1em]">시민 신고 기반 CCTV 선택 분석 · 부경대 AI·SW 경진대회</p>
          <h1 className="display text-[2.6em] leading-[1.15]">
            신고가 오면, AI는 <span style={{ color: "var(--w-beacon)" }}>근처 카메라만</span> 봅니다
          </h1>
        </div>
        <div className="flex items-center gap-[0.8em] text-[1.1em]">
          <span className="inline-block h-[0.7em] w-[0.7em] rounded-full" style={{ background: connection === "live" ? "var(--w-beacon)" : "var(--w-soft)" }} />
          <span className="display">{connection === "live" ? "LIVE" : "연결 중"}</span>
          <span className="mono soft">{now ? kstTime(now.toISOString()) : ""}</span>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[1.55fr_1fr] gap-[1.2em]">
        <div className="flex min-h-0 flex-col gap-[1.2em]">
          <article className="panel flex flex-col gap-[0.7em] p-[1.4em]">
            {focus ? (
              <>
                <p className="soft text-[1em]">
                  {focus.source === "demo" ? "모의 신고" : "시민 신고"} · <span className="mono">{kstTime(focus.created_at)}</span> · <span className="mono">#{shortId(focus.report_id)}</span>
                  {done && <span> · 방금 끝난 분석</span>}
                </p>
                <p className={`display text-[2.1em] leading-[1.25] ${focus.description ? "" : "soft"}`}>
                  {focus.description ? `“${focus.description}”` : "내용 없이 위치만 보낸 신고"}
                </p>
                <div className="flex flex-wrap gap-[0.5em] text-[1em]">
                  <span className="tag" style={{ borderColor: "var(--w-beacon)", color: "var(--w-beacon)" }}>
                    {analysis?.classification ? `AI 분류 · ${INCIDENT[analysis.classification.incident_type] ?? analysis.classification.incident_type}` : "AI 분류 대기"}
                  </span>
                  <span className="tag">반경 {Math.round(focus.radius_m)}m</span>
                  {count("image") > 0 && <span className="tag">사진 {count("image")}</span>}
                  {count("audio") > 0 && <span className="tag">녹음 {count("audio")}</span>}
                  {count("video") > 0 && <span className="tag">영상 {count("video")}</span>}
                </div>
                {transcripts.length > 0 && (
                  <p className="text-[1.05em]">
                    <span className="soft">목소리 → 글자 </span>“{transcripts[0].slice(0, 80)}”
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="soft">대기 중</p>
                <p className="display text-[2.1em]">휴대폰 신고를 기다리고 있어요</p>
                <p className="soft text-[1.1em]">신고 앱에서 위치만 보내도 AI 분석이 바로 시작돼요.</p>
              </>
            )}
          </article>

          <article className="panel p-[1.4em] pb-[1.2em]">
            <div className="rail">
              <div className="rail-fill" style={{ width: `${(Math.min(Math.max(index, 0), STAGES.length - 1) / (STAGES.length - 1)) * 83.34}%` }} />
              {STAGES.map((stage, i) => {
                const state = index > i || done ? "done" : index === i && (running || focus?.job.state === "queued") ? "now" : "";
                return (
                  <div key={stage.key} className="station">
                    <div className={`node ${state}`}>{state === "done" ? "✓" : ""}</div>
                    <span className={`display text-[1.15em] ${state ? "" : "soft"}`}>{stage.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-[1em] text-center text-[1.25em]">
              {!focus ? "신고가 들어오면 이 순서대로 분석해요." : done ? (outcome ? `결과 · ${outcome.label}` : "분석이 끝났어요.") : running ? EXPLAIN[stageKey] ?? "" : WAITING}
            </p>
          </article>

          <article className="panel flex min-h-0 flex-1 flex-col gap-[0.7em] overflow-hidden p-[1.4em]">
            <h2 className="display text-[1.4em]">AI가 본 것</h2>
            {done && analysis?.summary ? (
              <>
                <ul className="flex flex-col gap-[0.4em] text-[1.15em]">
                  {analysis.summary.cctv_observations.slice(0, 3).map((row, i) => (
                    <li key={i}>
                      <span className="mono" style={{ color: "var(--w-beacon)" }}>{row.camera_id}</span> {row.finding}
                    </li>
                  ))}
                  {analysis.summary.phone_observations.slice(0, 2).map((row) => (
                    <li key={row}>
                      <span style={{ color: "var(--w-tide)" }}>신고자 자료</span> {row}
                    </li>
                  ))}
                  {analysis.summary.cctv_observations.length === 0 && analysis.summary.phone_observations.length === 0 && (
                    <li className="soft">근처 카메라에서 신고와 관련된 장면을 찾지 못했어요.</li>
                  )}
                </ul>
                <p className="mt-auto text-[1em]" style={{ color: "var(--w-amber)" }}>
                  AI 결과는 후보일 뿐이에요. 최종 판단은 담당자가 원본 영상을 보고 해요.
                </p>
              </>
            ) : (
              <p className="soft text-[1.15em]">{running ? "분석이 끝나면 AI가 찾은 장면과 근거가 여기에 나와요." : "아직 분석한 신고가 없어요."}</p>
            )}
          </article>
        </div>

        <div className="flex min-h-0 flex-col gap-[1em]">
          {cameras.map((camera) => {
            const { state, row } = lensState(camera, focus, shown, index);
            const evidence = state === "focus" ? row?.focus?.evidence[0] ?? row?.scan?.evidence[0] : undefined;
            const src = evidence?.path && focus
              ? bPath(`/api/v1/admin/reports/${focus.report_id}/artifacts/${evidence.path}`)
              : `${bPath(`/api/v1/admin/cameras/${camera.id}/snapshot`)}?f=${frame}`;
            const accent = state === "focus" ? "var(--w-beacon)" : state === "skip" ? "var(--w-amber)" : state === "scanning" || state === "focusing" || state === "candidate" ? "var(--w-tide)" : "var(--w-soft)";
            return (
              <div key={camera.id} className="flex min-h-0 flex-1 flex-col gap-[0.4em]">
                <div className={`lens min-h-0 flex-1 ${state}`} style={{ aspectRatio: "auto" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy images */}
                  <img src={src} alt={`${camera.id} ${evidence ? "AI 근거 프레임" : "실시간 화면"}`} onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
                  {(state === "scanning" || state === "focusing") && <div className="scanline" />}
                  <div className="shutter" />
                  {evidence && (
                    <p className="absolute bottom-[0.5em] left-[0.6em] right-[0.6em] rounded-[0.5em] bg-[rgba(7,22,33,.8)] px-[0.6em] py-[0.3em] text-[0.95em]">
                      AI 근거 · {evidence.findings[0] ?? "관련 장면 후보"}
                    </p>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-[0.6em] text-[1em]">
                  <span>
                    <span className="mono">{camera.id}</span> <span className="soft">{camera.zone ?? camera.name}</span>
                  </span>
                  <span className="display" style={{ color: accent }}>
                    {LENS_LABEL[state]}
                    {state === "focus" && row?.event_score !== undefined && <span className="mono"> 관련도 {Math.round(row.event_score * 100)}%</span>}
                  </span>
                </div>
              </div>
            );
          })}
          {cameras.length === 0 && <p className="soft">시연 웹캠 정보를 불러오는 중이에요.</p>}
        </div>
      </section>

      <footer className="flex items-center gap-[1.6em] border-t border-[var(--w-line)] pt-[0.8em] text-[1.05em]">
        <span>
          오늘 신고 <span className="mono display">{today.length}</span>건
        </span>
        <span>
          분석 완료 <span className="mono">{today.filter((r) => r.job.state === "completed").length}</span>건
        </span>
        {metrics?.latency_seconds && (
          <span>
            평균 처리 <span className="mono">{metrics.latency_seconds.mean.toFixed(1)}</span>초
          </span>
        )}
        {reduction !== null && (
          <span>
            전체 분석보다 프레임 <span className="mono" style={{ color: "var(--w-beacon)" }}>{Math.round(reduction * 100)}%</span> 적게 처리
          </span>
        )}
        <span className="soft ml-auto">신고자 개인정보와 신고자 사진은 이 화면에 나오지 않아요.</span>
      </footer>
    </main>
  );
}
