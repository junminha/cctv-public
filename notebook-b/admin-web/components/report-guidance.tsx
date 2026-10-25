"use client";

import { useEffect, useState } from "react";
import { api, type Analysis, type Nearby, type ReportEvent, type ReportSummary } from "@/lib/api";
import { kstTime } from "@/lib/labels";

const distance = (value: number | null) => value === null ? "거리 미등록" : `${Math.round(value)}m`;
const coordinates = (latitude: number | null, longitude: number | null) =>
  latitude === null || longitude === null ? "좌표 미등록" : `위도 ${latitude.toFixed(5)} · 경도 ${longitude.toFixed(5)}`;

// Current nearby metadata is fetched separately from the stored analysis snapshot.
export function ReportGuidance({ report, analysis, compact = false, events, onLogged }: {
  report: ReportSummary;
  analysis: Analysis | null;
  compact?: boolean;
  // Given in the report detail: response logs can be written and are listed. /live stays read-only.
  events?: ReportEvent[];
  onLogged?: () => void;
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
  const logs = (events ?? []).filter((event) => event.type === "response_log");
  // Step numbers belong to this analysis's plan; logs from before it ran refer to an older plan.
  const stepLog = (index: number) => logs.find((event) => event.data.kind === "step" && event.data.step === index
    && (!analysis?.finished_at || event.created_at >= analysis.finished_at));
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
      <section className="guidance-section">
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
              <strong>공공 CCTV {nearby.public.devices.toLocaleString()}대 <span className="guidance-meta">· {nearby.public.sites.toLocaleString()}곳</span></strong>
            </div>
            <p className="guidance-note">공공 CCTV는 같은 좌표의 장비를 설치 장소 한 곳으로 묶었습니다.</p>
            {nearby.location_kind === "demo" && <p className="guidance-note">시연 지점 기준입니다. 실제 사건 위치·관할 기관과 다를 수 있습니다.</p>}
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
                <summary>공공 CCTV 추천 목록</summary>
                <p className="guidance-note">위치·이름 기준 상위 {nearby.public.recommended.length}곳 · 적합도는 영상 분석 신뢰도가 아닙니다.</p>
                <table className="guidance-table">
                  <caption className="sr-only">현재 반경 안 공공 CCTV 위치정보 추천</caption>
                  <thead><tr><th scope="col">위치·정보</th><th scope="col">거리</th><th scope="col">적합도</th></tr></thead>
                  <tbody>{nearby.public.recommended.map((camera, rank) => (
                    <tr key={camera.id}>
                      <td>
                        <span className={`rec-num${rank === 0 ? " top" : ""}`} aria-label={`추천 ${rank + 1}위`}>{rank + 1}</span>
                        <strong>{camera.name}</strong>
                        <span className="guidance-block">{camera.district} · {camera.purpose} · {camera.device_count}대</span>
                        <span className="guidance-note guidance-block">{coordinates(camera.latitude, camera.longitude)}</span>
                        <span className="guidance-note guidance-block">장소 단서: {camera.place ? `${camera.place} (이름으로 추정)` : "없음"}</span>
                        <ul className="guidance-reasons">{camera.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
                      </td>
                      <td>{distance(camera.distance_m)}</td>
                      <td>{Math.round(camera.score * 100)}%</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="guidance-note">적합도 = 근접 55% + 사건유형·장소 30% + 신고문 지명 일치 15%</p>
              </details>
            ) : <p className="guidance-note">반경 안 공공 CCTV가 없습니다.</p>}
            <p className="guidance-note">{nearby.public.note}</p>
            <p className="guidance-note">출처: {nearby.public.source}</p>
          </>
        )}
      </section>

      <section className="guidance-section">
        <h3 className="guidance-title">가장 적합한 CCTV</h3>
        {analysis?.nearby && (
          <p className="guidance-note">분석 당시 반경 {analysis.nearby.radius_m}m{analysis.nearby.radius_m !== radius ? " · 현재 반경과 다릅니다. 현재 조건으로 다시 분석하세요." : " 기준"}</p>
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
                <strong>공공 CCTV · 위치 기준</strong>
                <p>{best.public.name} · {distance(best.public.distance_m)}</p>
                <p className="guidance-note">{coordinates(best.public.latitude, best.public.longitude)}</p>
                <p className="guidance-note">{best.public.district} · {best.public.purpose} · 영상 미분석</p>
              </div>
            )}
            <p className="guidance-note">{best.note}</p>
          </>
        ) : <p className="guidance-note">{!analysis || pending ? "분석 완료 후 선정 결과를 표시합니다." : "이전 분석에 선정 기록이 없습니다. 다시 분석하면 표시됩니다."}</p>}
      </section>

      <section className="guidance-section">
        <h3 className="guidance-title">대응 방안 추천 {plan && <span className={`guidance-priority guidance-${plan.priority}`}>우선순위 {plan.priority_label}</span>}</h3>
        {plan ? (
          <>
            <p className="guidance-note">{plan.source === "local_rules" ? "사건 유형·분석 결과 기반 규칙 추천" : plan.source}</p>
            <ol className="guidance-steps">{plan.steps.map((step, i) => {
              const done = stepLog(i);
              return (
                <li key={i}>
                  <p>{step.action}</p>
                  <p className="guidance-note">{step.reason}</p>
                  {events && (
                    <div className="guidance-log">
                      {done && <span className="guidance-logged">실행 기록 {kstTime(done.created_at)} · {String(done.data.by ?? "")}</span>}
                      <button type="button" disabled={busy !== null} onClick={() => log(`step-${i}`, { kind: "step", step: i })}>
                        {busy === `step-${i}` ? "기록 중" : done ? "다시 기록" : "실행 기록"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}</ol>
            {plan.contacts.length > 0 && <p className="guidance-contacts"><strong>연락·담당 기관</strong> · {plan.contacts.join(" · ")}</p>}
            <ul className="guidance-cautions">{plan.cautions.map((caution, i) => <li key={i}>{caution}</li>)}</ul>
          </>
        ) : <p className="guidance-note">{!analysis || pending ? "분석 완료 후 대응 방안을 표시합니다. 긴급 상황은 분석을 기다리지 말고 112·119 절차를 따르세요." : "이전 분석에 대응 방안이 없습니다. 다시 분석하면 표시됩니다."}</p>}
      </section>

      {events && (
        <section className="guidance-section">
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
