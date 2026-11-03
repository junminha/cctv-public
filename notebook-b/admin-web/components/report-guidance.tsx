"use client";

import { useEffect, useState } from "react";
import { api, type Analysis, type Nearby, type PublicRecommendation, type ReportEvent, type ReportSummary } from "@/lib/api";
import { kstTime, OUTCOME } from "@/lib/labels";

const distance = (value: number | null) => value === null ? "거리 미등록" : `${Math.round(value)}m`;
// What a ranked CCTV is: public ones are location-only, demo webcams also have video analysis.
const describe = (camera: PublicRecommendation) =>
  camera.kind === "webcam" ? "시연 웹캠 · 영상 분석 가능" : `${camera.district ?? "구역 미상"} · ${camera.purpose} · ${camera.device_count}대 · 영상 미분석`;
const kindLabel = (camera: PublicRecommendation) => (camera.kind === "webcam" ? "시연 웹캠" : "공공 CCTV");
const coordinates = (latitude: number | null, longitude: number | null) =>
  latitude === null || longitude === null ? "좌표 미등록" : `위도 ${latitude.toFixed(5)} · 경도 ${longitude.toFixed(5)}`;

// Current nearby metadata is fetched separately from the stored analysis snapshot.
export function ReportGuidance({ report, analysis, compact = false, events, onLogged, view = "all", readOnly = false }: {
  report: ReportSummary;
  analysis: Analysis | null;
  compact?: boolean;
  // Given in the report detail: response logs can be written and are listed. /live stays read-only.
  events?: ReportEvent[];
  onLogged?: () => void;
  view?: "all" | "response" | "cctv";
  readOnly?: boolean;
}) {
  const { report_id: reportId, radius_m: radius, incident_type: incident, job: { state } } = report;
  const [attempt, setAttempt] = useState(0);
  const key = `${reportId}:${radius}:${incident}:${state}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: Nearby; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<Nearby>(`/api/v1/admin/reports/${reportId}/nearby`)
      .then((data) => { if (alive) setResult({ key, data }); })
      .catch((reason) => { if (alive) setResult({ key, error: reason instanceof Error ? reason.message : "CCTV 안내를 불러오지 못했습니다." }); });
    return () => { alive = false; };
  }, [reportId, key]);

  const current = result?.key === key ? result : null;
  const nearby = current?.data;
  const best = analysis?.best_camera;
  const plan = analysis?.response_plan;
  const pending = state === "running" || state === "queued";
  const search = !pending ? analysis?.search : undefined;
  const analysisBaseRadius = search?.base_radius_m ?? analysis?.nearby?.radius_m;
  const logs = (events ?? []).filter((event) => event.type === "response_log");
  // Step numbers belong to this analysis's plan; logs from before it ran refer to an older plan.
  const stepLog = (index: number) => [...logs].reverse().find((event) => event.data.kind === "step" && event.data.step === index
    && (view === "all" && !analysis?.finished_at || analysis?.finished_at && Date.parse(event.created_at) >= Date.parse(analysis.finished_at)));
  const nextStep = plan?.steps.findIndex((_, index) => !stepLog(index)) ?? -1;
  const [busy, setBusy] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [logError, setLogError] = useState("");

  async function log(name: string, body: { kind: "step" | "note"; step?: number; text?: string }) {
    setBusy(name);
    setLogError("");
    try {
      await api(`/api/v1/admin/reports/${reportId}/log`, { method: "POST", json: body });
      if (body.kind === "note") setMemo("");
      onLogged?.();
    } catch (reason) {
      setLogError(reason instanceof Error ? reason.message : "기록하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="region" aria-label="CCTV 안내 및 대응" className={`guidance ${compact ? "guidance-compact" : ""}`}>
      {search?.expanded && <p className="border-b border-rule px-5 py-2 text-xs text-amber">반경 {Math.round(search.base_radius_m)}m → {Math.round(search.radius_m)}m 자동 확대</p>}
      {readOnly && analysisBaseRadius !== undefined && analysisBaseRadius !== radius && <p role="alert" className="border-b border-rule px-5 py-2 text-xs text-amber">분석 당시 기본 반경 {analysisBaseRadius}m · 현재 반경과 다릅니다. 현재 조건으로 다시 분석하세요.</p>}
      {view === "response" && (
        <section role="region" aria-label="상황 카드" className="situation-card">
          {pending ? (
            <>
              <strong className="text-beacon">{state === "running" ? "분석 중" : "분석 대기"}</strong>
              <p className="guidance-note">분석 완료 후 선정 결과와 대응 방안을 표시합니다.</p>
            </>
          ) : <strong className={analysis?.outcome === "REVIEW_REQUIRED" ? "text-beacon" : "text-ink-soft"}>
            {analysis ? `${analysis.outcome === "REVIEW_REQUIRED" ? "영상에서 " : ""}${OUTCOME[analysis.outcome]?.label ?? analysis.outcome}` : "이번 분석 결과가 없습니다."}
          </strong>}
          <p className="situation-camera"><span className="text-ink-soft">가장 적합한 CCTV</span>{best?.video ? (
            <span><strong className="font-mono text-tide">{best.video.camera_id} · {distance(best.video.distance_m)}</strong><span className="guidance-note guidance-block">{best.video.reason}</span></span>
          ) : <span className="text-ink-soft">{pending ? "분석 완료 후 선정 결과를 표시합니다." : "영상 분석에서 선정된 웹캠이 없습니다."}</span>}</p>
          <p className="next-action"><strong>다음 할 일</strong> {plan ? nextStep >= 0 ? `${nextStep + 1}단계 · ${plan.steps[nextStep].action}` : "모든 대응 단계를 기록했습니다." : analysis?.summary?.recommended_next_step || "긴급 상황은 112·119 절차 우선"}</p>
          {!plan && (report.priority === "urgent" || report.incident_type === "FALL_SUSPECTED") && <p className="urgent-instruction">신고자에게 119 신고 여부를 확인하고, 하지 않았다면 바로 119에 신고하도록 안내하세요.</p>}
          {best?.note && <details className="guidance-disclosure"><summary>선정 근거·위치 정보</summary>
            {best.video && <><p>{[best.video.name, best.video.zone].filter(Boolean).join(" · ")}</p><p>{coordinates(best.video.latitude, best.video.longitude)}</p></>}
            {best.public && <p>{kindLabel(best.public)} · 위치 기준 1위: {best.public.name} · {distance(best.public.distance_m)} · {describe(best.public)}</p>}
            <p>{best.note}</p>
          </details>}
        </section>
      )}
      <section className="guidance-section guidance-cctv" hidden={view === "response"}>
        <h3 className="guidance-title">반경 안 CCTV <span className="guidance-meta">현재 {radius}m</span></h3>
        {!current ? <p role="status" className="guidance-note">CCTV 안내를 불러오는 중…</p> : current.error ? (
          <div role="alert">
            <p>{current.error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="guidance-retry">다시 불러오기</button>
          </div>
        ) : nearby && (
          <>
            <div className="guidance-counts">
              <strong>웹캠 영상 후보 {nearby.webcams.total.toLocaleString()}대</strong>
              <strong>CCTV {nearby.public.devices.toLocaleString()}대 <span className="guidance-meta">· {nearby.public.sites.toLocaleString()}곳{nearby.public.webcams ? ` · 시연 웹캠 ${nearby.public.webcams}대 포함` : ""}</span></strong>
            </div>
            {view === "all" && <><p className="guidance-note">공공 CCTV는 같은 좌표의 장비를 설치 장소 한 곳으로 묶었습니다.</p>
            {nearby.location_kind === "demo" && <p className="guidance-note">시연 지점 기준입니다. 실제 사건 위치·관할 기관과 다를 수 있습니다.</p>}</>}
            {nearby.webcams.cameras.length > 0 ? (
              <details className="guidance-disclosure">
                <summary>웹캠 영상 후보 위치</summary>
                <ul className="guidance-list">{nearby.webcams.cameras.map((camera) => (
                  <li key={camera.id}>
                    <strong>{camera.id}</strong> · {camera.name || "이름 미등록"} · {distance(camera.distance_m)}
                    {camera.zone && <span className="guidance-block">구역: {camera.zone}</span>}
                    <span className="guidance-note guidance-block">{coordinates(camera.latitude, camera.longitude)}</span>
                  </li>
                ))}</ul>
              </details>
            ) : <p className="guidance-note">반경 안 영상 분석 가능한 웹캠이 없습니다.</p>}
            {nearby.public.recommended.length > 0 ? (
              <details className="guidance-disclosure" open={!compact}>
                <summary>CCTV 추천 목록</summary>
                <p className="guidance-note">위치·이름 기준 상위 {nearby.public.recommended.length}곳 · 적합도는 영상 분석 신뢰도가 아닙니다.</p>
                <table className="guidance-table">
                  <caption className="sr-only">현재 반경 안 CCTV 추천(공개 CCTV·시연 웹캠)</caption>
                  <thead><tr><th scope="col">위치·정보</th><th scope="col">거리</th><th scope="col">적합도</th></tr></thead>
                  <tbody>{nearby.public.recommended.map((camera, rank) => (
                    <tr key={camera.id}>
                      <td>
                        <span className={`rec-num${rank === 0 ? " top" : ""}`} aria-label={`추천 ${rank + 1}위`}>{rank + 1}</span>
                        <strong>{camera.name}</strong>
                        {view === "all" && <><span className="guidance-block">{describe(camera)}</span>
                        <span className="guidance-note guidance-block">{coordinates(camera.latitude, camera.longitude)}</span>
                        <span className="guidance-note guidance-block">장소 단서: {camera.place ? `${camera.place} (이름으로 추정)` : "없음"}</span>
                        <ul className="guidance-reasons">{camera.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></>}
                      </td>
                      <td>{distance(camera.distance_m)}</td>
                      <td>{Math.round(camera.score * 100)}%</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="guidance-note">적합도 = 근접 55% + 사건유형·장소 30% + 신고문 지명 일치 15%</p>
              </details>
            ) : <p className="guidance-note">반경 안 CCTV가 없습니다.</p>}
            {view === "all" ? <><p className="guidance-note">{nearby.public.note}</p><p className="guidance-note">출처: {nearby.public.source}</p></> : <details className="guidance-disclosure"><summary>ⓘ CCTV 안내·출처</summary>
              <p>상세 위치·용도·추천 이유는 지도 번호 핀에서 확인합니다.</p>
              <p>공공 CCTV는 같은 좌표의 장비를 설치 장소 한 곳으로 묶었습니다.</p>
              {nearby.location_kind === "demo" && <p>시연 지점 기준입니다. 실제 사건 위치·관할 기관과 다를 수 있습니다.</p>}
              <p>{nearby.public.note}</p><p>출처: {nearby.public.source}</p>
            </details>}
          </>
        )}
      </section>

      <section className="guidance-section guidance-best-section" hidden={view !== "all"}>
        <h3 className="guidance-title">가장 적합한 CCTV</h3>
        {analysis?.nearby && (
          <p className="guidance-note">분석 당시 반경 {analysis.nearby.radius_m}m{analysisBaseRadius !== radius ? " · 현재 반경과 다릅니다. 현재 조건으로 다시 분석하세요." : " 기준"}</p>
        )}
        {best ? (
          <>
            {best.video ? (
              <div className="guidance-best">
                <strong>웹캠 영상 · {best.video.camera_id}</strong> · {distance(best.video.distance_m)}
                {(best.video.name || best.video.zone) && <p>{[best.video.name, best.video.zone].filter(Boolean).join(" · ")}</p>}
                <p className="guidance-note">{coordinates(best.video.latitude, best.video.longitude)}</p>
                <p>{best.video.reason}</p>
                <p className="guidance-note">자동 탐지 후보 · 담당자 원본 확인 필요</p>
              </div>
            ) : <p className="guidance-note">영상 분석에서 선정된 웹캠이 없습니다.</p>}
            {best.public && (
              <div className="guidance-best">
                <strong>{kindLabel(best.public)} · 위치 기준 1위</strong>
                <p>{best.public.name} · {distance(best.public.distance_m)}</p>
                <p className="guidance-note">{coordinates(best.public.latitude, best.public.longitude)}</p>
                <p className="guidance-note">{describe(best.public)}</p>
              </div>
            )}
            <p className="guidance-note">{best.note}</p>
          </>
        ) : <p className="guidance-note">{!analysis || pending ? "분석 완료 후 선정 결과를 표시합니다." : "이전 분석에 선정 기록이 없습니다. 다시 분석하면 표시됩니다."}</p>}
      </section>

      <section className="guidance-section guidance-response" hidden={view === "cctv"}>
        <h3 className="guidance-title">{view === "all" ? "대응 방안 추천" : "대응 단계"} {view === "all" && plan && <span className={`guidance-priority guidance-${plan.priority}`}>우선순위 {plan.priority_label}</span>}</h3>
        {plan ? (
          <>
            {view === "all" && <p className="guidance-note">{plan.source === "local_rules" ? "사건 유형·분석 결과 기반 규칙 추천" : plan.source}</p>}
            <ol className="guidance-steps">{plan.steps.map((step, i) => {
              const done = stepLog(i);
              return (
                <li key={`${analysis?.started_at}:${i}:${done?.created_at ?? "pending"}:${nextStep}`}>
                  {view !== "all" || readOnly ? (!readOnly && !done && i !== nextStep ? <p className="response-step">{i + 1}. {step.action}</p> : <details open={!done && i === nextStep} className={done ? "response-step done" : i === nextStep ? "response-step current" : "response-step"}>
                    <summary><span>{i + 1}. {step.action}</span>{done && <span className="guidance-logged">✓ {kstTime(done.created_at)} · {String(done.data.by ?? "")}</span>}</summary>
                    <p className="guidance-note">{step.reason}</p>
                    {events && !readOnly && <div className="guidance-log"><button type="button" disabled={busy !== null} onClick={() => log(`step-${i}`, { kind: "step", step: i })}>{busy === `step-${i}` ? "기록 중" : done ? "다시 기록" : "실행 기록"}</button></div>}
                  </details>) : <>
                  <p>{step.action}</p>
                  <p className="guidance-note">{step.reason}</p>
                  {events && !readOnly && (
                    <div className="guidance-log">
                      {done && <span className="guidance-logged">실행 기록 {kstTime(done.created_at)} · {String(done.data.by ?? "")}</span>}
                      <button type="button" disabled={busy !== null} onClick={() => log(`step-${i}`, { kind: "step", step: i })}>
                        {busy === `step-${i}` ? "기록 중" : done ? "다시 기록" : "실행 기록"}
                      </button>
                    </div>
                  )}
                  </>}
                </li>
              );
            })}</ol>
            {plan.contacts.length > 0 && <p className="guidance-contacts"><strong>연락·담당 기관</strong> · {plan.contacts.join(" · ")}</p>}
            {view === "all" && <ul className="guidance-cautions">{plan.cautions.map((caution, i) => <li key={i}>{caution}</li>)}</ul>}
          </>
        ) : <p className="guidance-note">{!analysis || pending ? "분석 완료 후 대응 방안을 표시합니다. 긴급 상황은 분석을 기다리지 말고 112·119 절차를 따르세요." : "이전 분석에 대응 방안이 없습니다. 다시 분석하면 표시됩니다."}</p>}
      </section>

      {events && !readOnly && (
        <section className="guidance-section guidance-history" hidden={view === "cctv"}>
          <h3 className="guidance-title">대응 기록 <span className="guidance-meta">{logs.length}건 · 증거 묶음에 포함</span></h3>
          <form className="guidance-memo" onSubmit={(event) => { event.preventDefault(); if (memo.trim()) log("note", { kind: "note", text: memo.trim() }); }}>
            <input value={memo} maxLength={500} onChange={(event) => setMemo(event.target.value)} placeholder="한 일을 적으세요 (예: 119 신고 확인, 현장 인력 출발)" aria-label="대응 메모" />
            <button type="submit" disabled={busy !== null || !memo.trim()}>{busy === "note" ? "기록 중" : "기록"}</button>
          </form>
          {logError && <p role="alert" className="guidance-note">{logError}</p>}
          {logs.length ? (
            <ol className="guidance-logs">{[...logs].reverse().map((event, i) => (
              <li key={`${event.created_at}-${i}`}>
                <span className="font-mono">{kstTime(event.created_at)}</span> {event.message}
                {event.data.text ? <> · {String(event.data.text)}</> : null}
                <span className="guidance-note"> · {String(event.data.by ?? "")}</span>
              </li>
            ))}</ol>
          ) : <p className="guidance-note">아직 기록이 없습니다. 추천 단계의 &lsquo;실행 기록&rsquo;이나 메모로 남기면 누가 언제 했는지 저장됩니다.</p>}
        </section>
      )}
    </div>
  );
}
