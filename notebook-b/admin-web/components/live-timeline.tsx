"use client";

import { useEffect, useRef, useState } from "react";
import { bPath, type Analysis, type ReportSummary } from "@/lib/api";
import { jobLabel, kstTime, STAGES } from "@/lib/labels";
import { STAGE_TAG, TAG_COLOR, type LogLine } from "@/lib/live-log";
import { LiveEvidence } from "./live-evidence";

function LogRow({ line }: { line: LogLine }) {
  return <div className="log-line">
    <span className="soft mono">{kstTime(line.at)}</span>
    <span className="soft mono">{line.offset !== null && line.offset >= 0 ? `+${line.offset.toFixed(1)}s` : ""}</span>
    <span className="log-tag mono" style={{ color: TAG_COLOR[line.tag] ?? "var(--w-text)" }}>{line.tag}</span>
    <span className="log-msg">{line.text}</span>
  </div>;
}

export function LiveTimeline({ report, analysis, log, elapsed, clock, loading }: {
  report: ReportSummary;
  analysis: Analysis | null;
  log: LogLine[];
  elapsed: number | null;
  clock: string;
  loading: boolean;
}) {
  const [allLog, setAllLog] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLLIElement>(null);
  const running = report.job.state === "running";
  const pending = running || report.job.state === "queued";
  const current = Math.max(0, STAGES.findIndex(stage => stage.key === report.job.stage));
  const latestRun = Math.max(0, ...log.map(line => line.run));
  const latest = log.filter(line => line.run === latestRun || line.tag === "RECEIVED");
  const groups = STAGES.map((_, i) => latest.filter(line => line.stage === i));
  const evidence = (analysis?.cameras ?? []).filter(row => analysis?.selected_camera_ids.includes(row.camera_id))
    .flatMap(row => (row.focus ?? row.all ?? row.scan)?.evidence.filter(item => item.path)
      .map(item => ({ ...item, camera: row.camera_id })) ?? []);

  useEffect(() => {
    if (allLog) end.current?.scrollIntoView({ block: "nearest" });
    else if (pending) active.current?.scrollIntoView({ block: "nearest" });
  }, [allLog, log.length, pending, current]);

  const liveLine = pending && <div className="log-line live-line">
    <span className="soft mono">{clock}</span>
    <span className="soft mono">{elapsed !== null ? `${elapsed.toFixed(0)}s` : ""}</span>
    <span className="log-tag mono">{running ? STAGE_TAG[report.job.stage] ?? report.job.stage : "QUEUE"}</span>
    <span className="log-msg">{jobLabel(report.job)}{running ? " 진행 중" : ""}</span>
  </div>;

  return <article className="panel wall-timeline" aria-label="진행 타임라인">
    <header className="panel-head">
      <h2>진행 타임라인</h2>
      <span className="soft timeline-status">{pending ? jobLabel(report.job) : "분석 기록"}</span>
      <button type="button" className="toggle" aria-pressed={allLog} onClick={() => setAllLog(value => !value)}>{allLog ? "단계 보기" : "전체 로그"}</button>
    </header>
    <div className={`timeline-scroll ${allLog ? "all-log" : ""}`} role="log" aria-label={allLog ? "전체 시간순 로그" : "단계별 분석 로그"} aria-live="polite">
      {loading && <p className="wall-empty">불러오는 중</p>}
      {allLog ? <>{log.map((line, i) => <LogRow key={`${line.at}-${line.tag}-${i}`} line={line} />)}{liveLine}</> : (
        <ol className="stages" aria-label="분석 단계">
          {STAGES.map((stage, i) => {
            const now = pending && i === current;
            const state = now ? "now" : groups[i].length ? report.job.state === "failed" && i === 5 ? "fail" : "done" : "todo";
            return <li key={stage.key} ref={now ? active : undefined} className={`timeline-stage ${state}`}>
              <span className="stage-number mono">{i + 1}</span>
              <div className="stage-content">
                <h3>{stage.label}<span className="mono soft stage-code">{STAGE_TAG[stage.key]}</span></h3>
                {groups[i].map((line, n) => <LogRow key={`${line.at}-${line.tag}-${n}`} line={line} />)}
                {now && liveLine}
                {!groups[i].length && !now && <p className="stage-placeholder soft">{pending ? "이전 단계 완료 후 표시합니다." : "진행 기록 없음 · 해당 없음"}</p>}
                {i === 4 && evidence.length > 0 && <div className="timeline-evidence">
                  {evidence.slice(0, 2).map(item => <LiveEvidence key={`${analysis?.started_at}:${item.camera}:${item.path}`}
                    src={bPath(`/api/v1/admin/reports/${report.report_id}/artifacts/${item.path}?run=${encodeURIComponent(analysis!.started_at)}`)}
                    caption={`${item.camera} · +${item.timestamp_seconds}s · ${item.findings.join(", ") || "관련 장면 후보"}`} />)}
                </div>}
              </div>
            </li>;
          })}
        </ol>
      )}
      <div ref={end} />
    </div>
  </article>;
}
