"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, bPath, type Analysis, type ReportDetail, type ReportSummary, type VisionResult } from "@/lib/api";
import { INCIDENT, OUTCOME, jobLabel, kstTime, shortId, sourceLabelAI } from "@/lib/labels";
import { useLive } from "@/lib/live";
import { byUrgency } from "@/lib/urgent";
import { ReportGuidance } from "./report-guidance";
import { UrgentBanner } from "./urgent-banner";
import { ConsoleTabs } from "./console-tabs";
import { buildLog, currentAnalysis, pct } from "@/lib/live-log";
import { LiveTimeline } from "./live-timeline";
import { LiveEvidence } from "./live-evidence";

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

const CAMERA_STATE: Record<string, { label: string; tone: string }> = {
  focus: { label: "집중 분석", tone: "var(--w-beacon)" },
  skip: { label: "건너뜀", tone: "var(--w-amber)" },
  CAMERA_UNAVAILABLE: { label: "연결 안 됨", tone: "var(--w-soft)" },
  RECORDING_UNAVAILABLE: { label: "녹화 없음", tone: "var(--w-soft)" },
};

// What the analysis looked at and which engine handled each part, for the report on screen.
function AnalysisRecord({ report, detail, fresh }: { report: ReportSummary; detail: ReportDetail | null; fresh: Analysis | null }) {
  const [chosenTab, setChosenTab] = useState<"response" | "cctv" | "materials" | null>(null);
  const tab = chosenTab ?? (report.job.state === "running" ? "materials" : "response");
  const params = fresh?.params ?? report.job.params ?? null;
  const pending = report.job.state === "queued" || report.job.state === "running";
  const vision = fresh?.cameras.flatMap((c) => [c.scan, c.focus, c.all]).concat(fresh.phone.map((p) => p.analysis)).filter((v): v is VisionResult => Boolean(v)) ?? [];
  const models = vision.find((v) => v.models)?.models;
  const gpuPeak = Math.max(0, ...vision.map((v) => v.gpu_memory_peak_mb ?? 0));
  const frames = vision.reduce((sum, v) => sum + v.processed_frames, 0);
  const voice = [...new Set(fresh?.phone.filter((p) => p.kind === "audio").map((p) => engine(p.source)) ?? [])];
  const text = detail?.description ?? report.description;

  return (
    <div className="wall-record" data-wall-tab={tab}>
      <ConsoleTabs label="분석 기록 탭" value={tab} onChange={setChosenTab} items={[
        { id: "response", label: "대응" }, { id: "cctv", label: "CCTV" }, { id: "materials", label: "분석 자료·모델" },
      ]}>
      <div className="sheet">
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

      <div hidden={tab === "materials"}><ReportGuidance key={report.report_id} report={report} analysis={fresh} compact events={detail?.events} readOnly /></div>

      <section hidden={tab !== "materials"}>
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

      <section hidden={tab !== "materials"}>
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
                      <LiveEvidence key={`${fresh.started_at}:${row.camera_id}:${evidence.path}`} src={bPath(`/api/v1/admin/reports/${report.report_id}/artifacts/${evidence.path}?run=${encodeURIComponent(fresh.started_at)}`)} caption={evidence.findings[0] ?? "관련 장면 후보"} />
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
              <span className="soft">{fresh.outcome === "NO_CAMERA_IN_RANGE" || fresh.candidates?.length === 0 ? "반경 안 웹캠 없음" : "웹캠 후보를 확인하지 못했습니다."}</span>
            </Item>
          )}
        </ul>
      </section>
      </div>
      </ConsoleTabs>
    </div>
  );
}

function ReportItem({ report, selected, onSelect }: { report: ReportSummary; selected: boolean; onSelect: () => void }) {
  const running = report.job.state === "running";
  const done = report.job.state === "completed" || report.job.state === "failed";
  const tone = report.priority === "urgent" && !report.alert_acknowledged ? "var(--signal)" : running ? "var(--w-beacon)" : done && report.job.state !== "failed" ? "var(--w-tide)" : "var(--w-soft)";
  return (
    <button type="button" className="report-item min-w-0" style={{ borderLeftColor: tone }} aria-current={selected} onClick={onSelect}>
      <span className="soft flex items-center gap-[0.6em] text-[0.82em]">
        {running && <span className="live-mark" />}
        {report.priority === "urgent" && !report.review?.closed_at && <span className={`urgent-tag ${report.alert_acknowledged ? "seen" : ""}`}>긴급</span>}
        <span className="mono">{kstTime(report.created_at)}</span>
        <span className="mono">#{shortId(report.report_id)}</span>
      </span>
      <strong className="report-incident">{INCIDENT[report.incident_type ?? ""] ?? (report.priority === "urgent" ? "쓰러짐 의심" : "분류 전")}</strong>
      <span title={report.description} className={`truncate ${report.description ? "" : "soft"}`}>{report.description || "위치만 보낸 신고"}</span>
      <span className="truncate text-[0.85em]" style={{ color: tone }}>
        {jobLabel(report.job)}
        {running && ` · ${Math.round(report.job.progress * 100)}%`}
      </span>
    </button>
  );
}

function Situation({ report, detail, analysis, elapsed }: { report: ReportSummary; detail: ReportDetail | null; analysis: Analysis | null; elapsed: number | null }) {
  const running = report.job.state === "running";
  const pending = running || report.job.state === "queued";
  const priority = analysis?.response_plan?.priority ?? report.priority;
  const plan = analysis?.response_plan;
  const finishedAt = analysis?.finished_at;
  const next = plan?.steps.findIndex((_, i) => !(detail?.events ?? []).some(e => e.type === "response_log"
    && e.data.kind === "step" && e.data.step === i && finishedAt && Date.parse(e.created_at) >= Date.parse(finishedAt))) ?? -1;
  const best = analysis?.best_camera?.video;
  const incident = INCIDENT[analysis?.classification?.incident_type ?? report.incident_type ?? ""]
    ?? (priority === "urgent" && report.priority_basis === "keywords" ? "쓰러짐 의심" : "분류 전");
  return <section role="region" aria-label="상황 카드" className="panel wall-situation">
    <div className="wall-state-row">
      <strong className="wall-incident">{incident}</strong>
      {priority && <span className={`guidance-priority guidance-${priority}`}>우선순위 {priority === "urgent" ? "긴급" : priority === "high" ? "높음" : "보통"}</span>}
      <strong className={`wall-outcome ${pending ? "progress" : report.job.state === "failed" ? "failure" : analysis?.outcome === "REVIEW_REQUIRED" ? "complete" : "soft"}`}>
        {pending ? `${jobLabel(report.job)}${running ? " · 진행 중" : ""}` : OUTCOME[report.job.stage]?.label ?? "분석 기록 확인 중"}
      </strong>
    </div>
    <div className="situation-description"><h2 className="display" title={report.description}>{report.description || "위치만 보낸 신고"}</h2>
      <span className="soft"><span className="mono">#{shortId(report.report_id)}</span> · {kstTime(report.created_at)} · {report.source === "demo" ? "모의 신고" : "시민 신고"} · {report.location_kind === "demo" ? "시연 지점" : "실제 위치"} · 반경 {Math.round(report.radius_m)}m{elapsed !== null && ` · 마지막 로그 후 ${elapsed.toFixed(0)}초`}</span>
    </div>
    <p className="situation-camera"><span className="soft">가장 적합한 CCTV</span> <strong>{best ? `${best.camera_id} · ${best.distance_m === null ? "거리 미등록" : `${Math.round(best.distance_m)}m`}` : pending ? "분석 완료 후 선정 결과 표시" : "영상 분석에서 선정된 웹캠이 없습니다."}</strong></p>
    <p className="next-action"><strong>다음 할 일</strong> {plan ? next >= 0 ? `${next + 1}단계 · ${plan.steps[next].action}` : "모든 대응 단계를 기록했습니다." : "긴급 상황은 112·119 절차 우선"}</p>
  </section>;
}

export function LiveWall() {
  const { snapshot, connection } = useLive();
  const [detailResult, setDetailResult] = useState<{ key: string; data: ReportDetail | null }>({ key: "", data: null });
  const [pinned, setPinned] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const reports = useMemo(() => byUrgency([...(snapshot?.reports ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))), [snapshot]);
  const auto = reports.find(r => r.job.state === "running") ?? reports.find(r => r.job.state === "queued" && r.job.params) ?? reports[0] ?? null;
  const focus = (pinned && reports.find(r => r.report_id === pinned)) || auto;
  const focusKey = focus ? `${focus.report_id}:${focus.radius_m}:${focus.job.state}:${focus.job.stage}:${focus.job.progress}:${focus.response_logs ?? 0}:${focus.review?.confirmed_at}:${focus.review?.closed_at}:${focus.job.error}` : "";
  // A rerun can return to the same completed key. Discard the old detail on every transition.
  if (detailResult.key !== focusKey) setDetailResult({ key: focusKey, data: null });
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!focus) return;
    let alive = true;
    api<ReportDetail>(`/api/v1/admin/reports/${focus.report_id}`)
      .then(value => { if (alive) setDetailResult({ key: focusKey, data: value }); }).catch(() => {});
    return () => { alive = false; };
    // focusKey includes all snapshot fields that refresh this report detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  const detail = detailResult.key === focusKey ? detailResult.data : null;
  const analysis = focus ? currentAnalysis(focus, detail) : null;
  const log = useMemo(() => detail ? buildLog(detail) : [], [detail]);
  const lastAt = log.length ? Date.parse(log[log.length - 1].at) : null;
  const elapsed = focus?.job.state === "running" && now && lastAt ? Math.max(0, (now - lastAt) / 1000) : null;
  const clock = now ? kstTime(new Date(now).toISOString()) : "";
  return <main className="wall fixed inset-0">
    <header className="masthead">
      <h1 className="display">AI 분석 로그</h1>
      <div className="wall-connection" aria-live="polite">
        <span className="state-mark" style={{ background: connection === "live" ? "var(--w-tide)" : "var(--w-amber)" }} />
        <span>{connection === "live" ? "LIVE" : connection === "offline" ? "다시 연결하는 중" : "연결 중"}</span>
        <span className="soft mono">{clock}</span>
      </div>
    </header>
    {connection !== "live" && <p role="status" className="wall-connection-note">{connection === "offline" ? "연결이 끊겼습니다. 새 신고·분석 결과가 지연될 수 있습니다. 연결 복구 후 최신 상태를 확인하세요." : "연결 중입니다. 최신 신고·분석 상태를 기다리고 있습니다."}</p>}
    <UrgentBanner reports={reports} onShow={setPinned} />
    <section className="wall-workspace">
      <aside className="panel wall-queue" aria-label="신고 목록">
        <div className="panel-head"><h2>신고</h2><button type="button" onClick={() => setPinned(null)} className="toggle" aria-pressed={!pinned}>자동</button></div>
        <div className="queue-scroll">
          {reports.slice(0, 30).map(report => <ReportItem key={report.report_id} report={report} selected={report.report_id === focus?.report_id} onSelect={() => setPinned(report.report_id)} />)}
          {reports.length === 0 && <p className="wall-empty">{connection === "live" ? "신고 없음" : "표시할 신고 없음 · 연결 상태 확인 필요"}</p>}
          {reports.length > 0 && <p className="queue-note soft">긴급 신고 우선 · 최근 30건<br />{pinned ? "신고 고정 중 · 자동으로 복귀 가능" : "자동 · 분석 중인 신고를 따라갑니다."}</p>}
        </div>
      </aside>
      {focus ? <Situation report={focus} detail={detail} analysis={analysis} elapsed={elapsed} /> : (
        <section role="region" aria-label="상황 카드" className="panel wall-situation wall-empty-situation"><h2 className="display">표시할 신고 없음</h2><p>신고 수신과 분석 상태를 기다리고 있습니다.</p><p className="soft">{connection === "live" ? "신고가 들어오면 최신 분석을 자동으로 따라갑니다." : "연결 복구 후 최신 신고 유무를 확인하세요."}</p></section>
      )}
      {focus ? <LiveTimeline key={focus.report_id} report={focus} analysis={analysis} log={log} elapsed={elapsed} clock={clock} loading={!detail} /> : (
        <article className="panel wall-timeline" aria-label="진행 타임라인"><header className="panel-head"><h2>진행 타임라인</h2></header><div className="wall-empty"><p>신고가 들어오면 분석 로그가 여기에 나와요.</p><p className="soft">접수 → 분류 → 반경 후보 → 저FPS 탐색 → 집중 분석 → 요약</p></div></article>
      )}
      <aside className="panel wall-sidebar" aria-label="분석 기록">
        <h2 className="sr-only">분석 기록</h2>
        {focus ? <AnalysisRecord key={focus.report_id} report={focus} detail={detail} fresh={analysis} /> : <p className="wall-empty soft">신고를 고르면 대응 방안·CCTV 안내·분석 자료와 사용한 모델이 나와요.</p>}
      </aside>
    </section>
    <p className="wall-footer">ⓘ AI 결과는 담당자 확인 전 미확정 · 공공 CCTV는 위치정보만 사용 · 영상 미분석 · 시연 영상 입력: cam-01 / cam-02 / cam-03</p>
  </main>;
}
