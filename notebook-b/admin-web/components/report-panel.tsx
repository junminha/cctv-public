"use client";

import { useEffect, useRef, useState } from "react";
import { api, bPath, type AnalysisCamera, type AnalyzeParams, type Camera, type Clip, type ReportDetail, type ReportSummary } from "@/lib/api";
import { INCIDENT, kst, kstTime, OUTCOME, shortId, sourceLabel, sourceLabelAI, STAGES } from "@/lib/labels";
import { ReportGuidance } from "./report-guidance";
import { ConsoleTabs } from "./console-tabs";

const DEFAULTS: AnalyzeParams = { mode: "selective", source: "live", duration: 10, sample_fps: 1, focus_fps: 3, top_k: 1 };

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {aside && <span className="font-mono text-[11px] text-ink-soft">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function StageTrack({ live }: { live: ReportSummary }) {
  const { job } = live;
  const done = job.state === "completed" || job.state === "failed";
  const index = STAGES.findIndex((stage) => stage.key === job.stage);
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-1 text-[11px]">
      {STAGES.map((stage, position) => {
        const reached = done || (index >= 0 && position <= index);
        const current = !done && position === index;
        return (
          <li key={stage.key} className={`flex items-center gap-1 px-1.5 py-0.5 ${current ? "bg-beacon text-white" : reached ? "bg-tide-wash text-tide" : "bg-chart text-ink-soft"}`}>
            <span className="font-mono">{position + 1}</span>
            {stage.label}
          </li>
        );
      })}
    </ol>
  );
}

function Ranking({ cameras, selected, reportId }: { cameras: AnalysisCamera[]; selected: string[]; reportId: string }) {
  return <ol className="camera-ranking">{[...cameras].sort((a,b) => (b.rank_score ?? -1) - (a.rank_score ?? -1)).map((row, index) => {
    const chosen = selected.includes(row.camera_id);
    const frames = (row.scan?.processed_frames ?? 0) + (row.focus?.processed_frames ?? 0) + (row.all?.processed_frames ?? 0);
    const evidence = (row.focus ?? row.all ?? row.scan)?.evidence.find((item) => item.path);
    const relevance = row.event_score ?? row.all?.relevance_score;
    return <li key={row.camera_id} className={chosen ? "chosen" : ""}>
      {evidence ? <a href={bPath(`/api/v1/admin/reports/${reportId}/artifacts/${evidence.path}`)} target="_blank" rel="noreferrer" aria-label={`${row.camera_id} 근거 프레임 원본 크기로 보기`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact proxy */}
        <img src={bPath(`/api/v1/admin/reports/${reportId}/artifacts/${evidence.path}`)} alt={`${row.camera_id} 근거 프레임`} />
      </a> : <span className="camera-no-evidence">근거 프레임 없음</span>}
      <div><p><strong className="font-mono">{index + 1} {row.camera_id} · {Math.round(row.distance_m)}m</strong> {chosen && <strong className="text-tide">집중 분석</strong>}</p>
        <p className="text-ink-soft">{row.status === "available" ? <>영상 관련성 <span className="font-mono">{relevance?.toFixed(2) ?? "—"}</span></> : <span role="alert" className="text-amber">{row.status === "RECORDING_UNAVAILABLE" ? "녹화 없음" : "연결 불가"}{row.detail ? ` · ${row.detail}` : ""}</span>} · 순위 점수 <span className="font-mono">{row.rank_score?.toFixed(2) ?? "—"}</span> · <span className="font-mono">{frames || "—"}</span>프레임</p>
        {(row.zone || evidence) && <p className="text-ink-soft">{row.zone}{evidence && <> · {evidence.findings.join(", ")}</>}</p>}
      </div>
    </li>;
  })}<li className="ranking-note">순위 점수 = (0.20·근접 + 0.15·시간 일치 + 0.45·영상 관련성) ÷ 0.80. 관련성이 0인 카메라는 집중 분석하지 않습니다.</li></ol>;
}

export function ReportPanel({ detail, live, cameras, onChanged, onRadiusPreview }: {
  detail: ReportDetail;
  live: ReportSummary;
  cameras: Camera[];
  onChanged: () => void;
  onRadiusPreview?: (radius: number) => void;
}) {
  const storedAnalysis = detail.analysis;
  const running = live.job.state === "running" || (live.job.state === "queued" && !!live.job.params);
  const lastRun = detail.events.map((event) => event.type).lastIndexOf("analysis_requested");
  const analysis = storedAnalysis && !running && live.job.state !== "queued" && (lastRun < 0 || Date.parse(storedAnalysis.started_at) >= Date.parse(detail.events[lastRun].created_at)) ? storedAnalysis : null;
  const summary = analysis?.summary;
  const [tab, setTab] = useState<"response" | "cctv" | "report" | "tools">("response");
  const priority = analysis?.response_plan?.priority ?? live.priority;
  const priorityLabel = priority === "urgent" ? "긴급" : priority === "high" ? "높음" : "보통";
  const outcome = live.job.state === "completed" || live.job.state === "failed" ? OUTCOME[live.job.stage] : null;
  const [params, setParams] = useState<AnalyzeParams>(detail.job.params ?? DEFAULTS);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [busy, setBusy] = useState("");
  const [media, setMedia] = useState(true);
  const [radius, setRadius] = useState(detail.radius_m);
  const [radiusNote, setRadiusNote] = useState("");
  const radiusValid = Number.isFinite(radius) && radius >= 1 && radius <= 5000;
  // The parent re-renders on every live snapshot; keep the latest callback without restarting the save timer.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  // Save the radius shortly after the slider or number stops moving; the map previews it immediately.
  useEffect(() => {
    if (!radiusValid || radius === detail.radius_m) return;
    const timer = setTimeout(async () => {
      try {
        await api(`/api/v1/admin/reports/${detail.report_id}/radius`, { method: "PUT", json: { radius_m: radius } });
        setRadiusNote("저장했습니다. 후보 카메라에 반영하려면 다시 분석하세요.");
        changed.current();
      } catch (reason) {
        setRadiusNote(reason instanceof Error ? reason.message : "반경을 바꾸지 못했습니다.");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [radius, radiusValid, detail.radius_m, detail.report_id]);

  function changeRadius(value: number) {
    setRadius(value);
    setRadiusNote("");
    if (Number.isFinite(value) && value >= 1 && value <= 5000) onRadiusPreview?.(value);
  }

  useEffect(() => {
    api<{ clips: Clip[] }>(`/api/v1/admin/reports/${detail.report_id}/clips`).then((value) => setClips(value.clips)).catch(() => {});
  }, [detail.report_id, busy]);

  async function act(name: string, run: () => Promise<unknown>, done: string) {
    setBusy(name);
    setMessage("");
    try {
      await run();
      setMessage(done);
      onChanged();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "요청하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  const evidence = (analysis?.cameras ?? []).flatMap((row) =>
    (row.focus ?? (analysis?.selected_camera_ids.includes(row.camera_id) ? row.all : undefined))?.evidence
      .filter((item) => item.path).map((item) => ({ ...item, camera: row.camera_id, window: row.window })) ?? []);
  const windows = (analysis?.cameras ?? []).filter((row) => analysis?.selected_camera_ids.includes(row.camera_id) && row.window);
  const preservable = windows.filter((row) => {
    const camera = cameras.find((item) => item.id === row.camera_id);
    return camera?.approved;
  });

  return (
    <div className="report-panel">
      <div className="report-head">
        <div className="flex flex-wrap gap-x-2 font-mono text-[11px] text-ink-soft">
          <span>#{shortId(detail.report_id)}</span><span>{kst(detail.created_at)} 접수</span><span>{sourceLabel(detail.source)}</span>
          <span>{detail.location_kind === "demo" ? "시연 지점" : "실제 위치"} · 반경 {detail.radius_m}m</span>
        </div>
        <div className="report-title"><h2 className="font-display text-2xl">{INCIDENT[analysis?.classification?.incident_type ?? live.incident_type ?? ""] ?? (live.priority_basis === "keywords" && priority === "urgent" ? "쓰러짐 의심" : running ? "분석 중" : "분류 전")}</h2>
          {priority && <span className={`guidance-priority guidance-${priority}`}>우선순위 {priorityLabel}</span>}
        </div>
      </div>
      <ConsoleTabs label="신고 상세 탭" value={tab} onChange={setTab} items={[
        { id: "response", label: "대응" }, { id: "cctv", label: "CCTV" }, { id: "report", label: "신고 내용" }, { id: "tools", label: "도구" },
      ]}>
        {live.job.error && <p role="alert" className="panel-alert">{outcome?.label ?? "분석 실패"} · {live.job.error}</p>}
        {analysis?.warnings?.length ? <ul role="alert" className="panel-alert">{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {analysis?.nearby && analysis.nearby.radius_m !== detail.radius_m && <p role="alert" className="panel-alert">분석 당시 반경 {analysis.nearby.radius_m}m · 현재 반경과 다릅니다. 현재 조건으로 다시 분석하세요.</p>}
        {!analysis && !running && live.job.state !== "queued" && <p className="panel-alert">이번 분석에 사용할 수 있는 결과가 없습니다. 다시 분석하거나 원본을 직접 확인하세요.</p>}
        <div hidden={tab !== "response"}>{running && <div className="panel-stages"><StageTrack live={live} /></div>}</div>
        <div hidden={tab !== "cctv"}>
      {analysis && analysis.cameras.length > 0 && (
        <Section title="후보 카메라" aside={`${analysis.mode === "selective" ? "선택 분석" : analysis.mode === "all" ? "전체 분석" : "비교 실험"} · ${analysis.params.source === "live" ? "실시간" : "녹화"} ${analysis.params.duration}초`}>
          <Ranking cameras={analysis.cameras} selected={analysis.selected_camera_ids} reportId={detail.report_id} />
        </Section>
      )}

<details className="all-evidence"><summary>근거 프레임 전체 보기</summary>      {evidence.length > 0 && (
        <Section title="근거 프레임" aside="자동 탐지 후보 · 원본 아님">
          <div className="grid grid-cols-2 gap-2">
            {evidence.slice(0, 4).map((item) => (
              <figure key={`${item.camera}-${item.file}`} className="overflow-hidden border border-rule">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy image, not optimizable */}
                <img src={bPath(`/api/v1/admin/reports/${detail.report_id}/artifacts/${item.path}`)} alt={`${item.camera} 근거 프레임`} className="aspect-video w-full bg-chart object-cover" />
                <figcaption className="px-2 py-1 text-[11px]">
                  <span className="font-mono font-medium">{item.camera}</span>
                  <span className="ml-1 font-mono text-ink-soft">
                    {item.window ? kstTime(new Date(new Date(item.window.start).getTime() + item.timestamp_seconds * 1000).toISOString()) : `+${item.timestamp_seconds}s`}
                  </span>
                  <span className="block text-ink-soft">{item.findings.slice(0, 2).join(", ")}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

</details>
        </div>
        <div hidden={tab !== "response" && tab !== "cctv"}>
          <ReportGuidance report={{ ...live, radius_m: detail.radius_m }} analysis={analysis} events={detail.events} onLogged={onChanged} view={tab === "cctv" ? "cctv" : "response"} />
        </div>
        <div hidden={tab !== "response"}>
      <Section title="담당자 처리" aside={detail.review?.closed_at ? `종결 ${kst(detail.review.closed_at)}` : detail.review?.confirmed_at ? `확인 ${kst(detail.review.confirmed_at)}` : undefined}>
        <textarea rows={2} maxLength={2000} placeholder="확인 내용 메모 (예: 원본 확인, 현장 전달함)" value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full border border-rule bg-surface px-2.5 py-1.5 text-sm" />
        <div className="mt-2 flex gap-2">
          <button disabled={busy !== ""} onClick={() => act("confirm", () => api(`/api/v1/admin/reports/${detail.report_id}/confirm`, { method: "POST", json: { note } }), "확인 완료로 기록했습니다.")}
            className="flex-1 bg-tide px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">확인 완료</button>
          <button disabled={busy !== ""} onClick={() => act("close", () => api(`/api/v1/admin/reports/${detail.report_id}/close`, { method: "POST", json: { note } }), "종결로 기록했습니다.")}
            className="flex-1 border border-ink px-3 py-1.5 text-sm disabled:opacity-40">종결</button>
        </div>
      </Section>


        </div>
        <div hidden={tab !== "report"}>
          <Section title="신고 내용">
            <p className="text-sm">{detail.description || "위치만 보낸 신고"}</p>
            {detail.details && <p className="mt-2 text-xs text-ink-soft">상세 위치: {detail.details}</p>}
            {detail.occurred_at && <p className="mt-1 text-xs text-ink-soft">신고된 발생 시각: {kst(detail.occurred_at)}</p>}
            <p className="mt-1 font-mono text-xs text-ink-soft">위도 {detail.latitude.toFixed(5)} · 경도 {detail.longitude.toFixed(5)}</p>
          </Section>
      {detail.attachments.length > 0 && (
        <Section title="신고자 첨부" aside="본인이 선택해 올린 자료">
          <ul className="space-y-1 text-sm">
            {detail.attachments.map((item) => {
              const phone = analysis?.phone.find((row) => row.attachment_id === item.attachment_id);
              return (
                <li key={item.attachment_id}>
                  <a className="underline" href={bPath(item.download_path)} target="_blank" rel="noreferrer">
                    {item.kind === "image" ? "사진" : item.kind === "audio" ? "녹음" : "영상"} · {item.original_name || item.attachment_id.slice(0, 8)}
                  </a>
                  <span className="ml-1 font-mono text-[11px] text-ink-soft">{(item.bytes / 1024 / 1024).toFixed(1)}MB</span>
                  {phone?.transcript && <p className="text-xs text-ink-soft">전사(자동, 오인식 가능): {phone.transcript}</p>}
                  {phone?.analysis && <p className="text-xs text-ink-soft">{phone.analysis.observations.map((row) => row.finding).join(" · ") || "관찰 후보 없음"}</p>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {summary && (
        <Section title="상황 요약" aside={sourceLabelAI(summary.source)}>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-ink-soft">신고자 설명</dt><dd>{summary.reporter_claim}</dd></div>
            <div>
              <dt className="text-xs text-ink-soft">CCTV 관찰 (자동 탐지, 미확인)</dt>
              {summary.cctv_observations.length ? (
                <dd><ul className="space-y-0.5">{summary.cctv_observations.map((row, index) => (
                  <li key={index}><span className="font-mono text-xs">{row.camera_id}</span> {row.finding} {row.timestamp && <span className="font-mono text-[11px] text-ink-soft">{kstTime(row.timestamp)}</span>}</li>
                ))}</ul></dd>
              ) : <dd className="text-ink-soft">관련 장면 후보 없음</dd>}
            </div>
            {summary.phone_observations.length > 0 && (
              <div><dt className="text-xs text-ink-soft">신고자 자료</dt><dd><ul>{summary.phone_observations.map((row) => <li key={row}>{row}</li>)}</ul></dd></div>
            )}
            <div><dt className="text-xs text-ink-soft">확인되지 않은 사항</dt><dd><ul>{summary.unverified_facts.map((row) => <li key={row}>· {row}</li>)}</ul></dd></div>
          </dl>
        </Section>
      )}


        </div>
        <div hidden={tab !== "tools"}>
<Section title="검색 반경">        <div className="mt-3 border border-rule px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">검색 반경</span>
            <span className="font-mono text-ink-soft">현재 {detail.radius_m}m</span>
          </div>
          <input type="range" min={50} max={5000} step={50} value={Math.min(Math.max(radius, 50), 5000)}
            onChange={(event) => changeRadius(Number(event.target.value))} aria-label="검색 반경" className="mt-1 w-full accent-beacon" />
          <div className="mt-1 flex items-center gap-2">
            <input aria-label="검색 반경 미터" type="number" min={1} max={5000} value={Number.isFinite(radius) ? radius : ""}
              onChange={(event) => changeRadius(event.target.valueAsNumber)}
              className="w-24 border border-rule bg-surface px-2 py-1 font-mono text-sm" />
            <span className="text-xs text-ink-soft">m (1~5000) · 움직이면 바로 저장</span>
          </div>
          {radiusNote && <p role="status" className="mt-1 text-xs">{radiusNote}</p>}
        </div>
</Section>      <Section title="분석 실행">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-0.5"><span className="text-ink-soft">방식</span>
            <select className="w-full border border-rule bg-surface px-2 py-1" value={params.mode} onChange={(e) => setParams({ ...params, mode: e.target.value as AnalyzeParams["mode"] })}>
              <option value="selective">신고 기반 선택 분석</option><option value="all">전체 카메라 집중 분석</option><option value="benchmark">두 방식 비교 실험</option>
            </select>
          </label>
          <label className="space-y-0.5"><span className="text-ink-soft">영상</span>
            <select className="w-full border border-rule bg-surface px-2 py-1" value={params.source} onChange={(e) => setParams({ ...params, source: e.target.value as AnalyzeParams["source"] })}>
              <option value="live">실시간 스트림</option><option value="recording">신고 시각 녹화</option>
            </select>
          </label>
          <label className="space-y-0.5"><span className="text-ink-soft">길이 (초)</span>
            <input type="number" min={2} max={60} className="w-full border border-rule bg-surface px-2 py-1" value={params.duration} onChange={(e) => setParams({ ...params, duration: Number(e.target.value) })} />
          </label>
          <label className="space-y-0.5"><span className="text-ink-soft">탐색 / 집중 FPS</span>
            <span className="flex gap-1">
              <input aria-label="탐색 FPS" type="number" min={0.2} max={5} step={0.1} className="w-full border border-rule bg-surface px-2 py-1" value={params.sample_fps} onChange={(e) => setParams({ ...params, sample_fps: Number(e.target.value) })} />
              <input aria-label="집중 FPS" type="number" min={0.5} max={10} step={0.5} className="w-full border border-rule bg-surface px-2 py-1" value={params.focus_fps} onChange={(e) => setParams({ ...params, focus_fps: Number(e.target.value) })} />
            </span>
          </label>
        </div>
        <button disabled={running || busy !== ""} onClick={() => act("analyze", () => api(`/api/v1/admin/reports/${detail.report_id}/analyze`, { method: "POST", json: params }), "분석을 대기열에 넣었습니다.")}
          className="mt-3 w-full bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {running ? "분석 진행 중…" : analysis ? "다시 분석" : "분석 시작"}
        </button>
      </Section>

      {analysis?.benchmark && (
        <Section title="선택 분석 vs 전체 분석" aside="같은 클립 기준">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-soft"><tr><th className="font-medium">방식</th><th className="font-medium">처리 프레임</th><th className="font-medium">처리 시간</th><th className="font-medium">선정</th></tr></thead>
            <tbody className="font-mono tabular">
              <tr className="border-t border-rule"><td className="py-1 font-sans">신고 기반 선택</td><td>{analysis.benchmark.selective.frames}</td><td>{analysis.benchmark.selective.seconds}s</td><td>{analysis.benchmark.selective.selected.join(", ") || "—"}</td></tr>
              <tr className="border-t border-rule"><td className="py-1 font-sans">전체 집중</td><td>{analysis.benchmark.all.frames}</td><td>{analysis.benchmark.all.seconds}s</td><td>{analysis.benchmark.all.selected.join(", ") || "—"}</td></tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-xs">
            프레임 {analysis.benchmark.frame_reduction !== null ? `${Math.round(analysis.benchmark.frame_reduction * 100)}% 감소` : "비교 불가"} ·
            선정 결과 {analysis.benchmark.same_selection ? "일치" : "불일치"}
          </p>
          <p className="text-[11px] text-ink-soft">{analysis.benchmark.note}</p>
        </Section>
      )}

      <Section title="사건 영상 보존" aside="A 원본 녹화의 remux 사본 · SHA256 기록">
        {preservable.length ? preservable.map((row) => (
          <button key={row.camera_id} disabled={busy !== ""}
            onClick={() => act("preserve", () => api(`/api/v1/admin/reports/${detail.report_id}/preserve`, { method: "POST", json: { camera_id: row.camera_id, start: row.window!.start, duration: row.window!.duration } }), "보존했습니다.")}
            className="mb-2 w-full border border-ink px-3 py-1.5 text-sm disabled:opacity-40">
            {row.camera_id} {kstTime(row.window!.start)}부터 {row.window!.duration}초 보존
          </button>
        )) : <p className="text-xs text-ink-soft">집중 분석된 카메라의 영상 구간이 생기면 보존할 수 있습니다. 실시간 분석 구간은 녹화가 확정되는 약 1분 뒤부터 보존됩니다.</p>}
        {clips.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {clips.map((clip) => (
              <li key={clip.clip_id} className="flex flex-wrap items-center gap-x-2">
                <a className="font-mono underline" href={bPath(clip.download_path)}>{clip.camera_id} {kstTime(clip.start)}</a>
                <span className="font-mono text-ink-soft">{clip.measured_duration.toFixed(1)}s · {clip.sha256.slice(0, 12)}…</span>
                {!clip.duration_matches_request && <span className="text-amber">길이 불일치 · 내용 확인 필요</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="외부 제출" aside="다운로드는 감사 기록에 남습니다">
        <a href={bPath(`/api/v1/admin/reports/${detail.report_id}/package.zip${media ? "" : "?media=false"}`)} download
          className="block w-full bg-ink px-3 py-1.5 text-center text-sm font-medium text-white hover:brightness-110">
          증거 묶음 다운로드 (ZIP)
        </a>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={media} onChange={(event) => setMedia(event.target.checked)} />
          첨부·근거 프레임·보존 영상 포함 (해제하면 기록 문서만)
        </label>
        <p className="mt-1 text-xs text-ink-soft">신고·분석·처리 기록, 감사 기록, 파일별 SHA256 목록(manifest.json)이 함께 들어갑니다.</p>
      </Section>

<details className="all-events"><summary>처리 기록 전체</summary>      <Section title="처리 기록">
        <ol className="space-y-0.5 font-mono text-[11px] text-ink-soft">
          {detail.events.map((event, index) => (
            <li key={index}><span className="tabular">{kstTime(event.created_at)}</span> {event.message}</li>
          ))}
        </ol>
      </Section>
</details>
        </div>
        {message && <p role="status" className="panel-message">{message}</p>}
      </ConsoleTabs>
      <details className="panel-info"><summary>ⓘ AI 결과는 확인 전 미확정 · 공공 CCTV는 위치정보만 사용</summary>
        <p>공공 CCTV 영상은 열람·분석하지 않습니다. 추천은 참고용이며 출동·조치 결정은 담당자가 합니다.</p>
        <p>긴급 상황은 분석을 기다리지 말고 기존 112·119 절차를 따르세요.</p>
        {analysis?.response_plan?.source && <p>대응 방안 출처: {analysis.response_plan.source === "local_rules" ? "사건 유형·분석 결과 기반 규칙 추천" : analysis.response_plan.source}</p>}
        {analysis?.response_plan?.cautions.map((caution, index) => <p key={index}>{caution}</p>)}
      </details>
    </div>
  );
}
