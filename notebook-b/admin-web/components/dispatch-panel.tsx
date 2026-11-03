"use client";

import { useState } from "react";
import { api, type ReportEvent } from "@/lib/api";
import { kstTime, sourceLabelAI } from "@/lib/labels";

type Agency = "FIRE_119" | "POLICE_112" | "DISTRICT_OFFICE" | "PUBLIC_HEALTH" | "CCTV_CENTER";
type Pick = { agency: Agency; name: string; reason: string; message: string };
type Recommendation = { agencies: Pick[]; source: string; warnings: string[]; district: string };

// Demo-only agency connection (shared/API.md v0.10): GPT or rules suggest who to contact, a person
// presses the mock send, and only a record is kept. Nothing leaves this system.
export function DispatchPanel({ reportId, events, onSent }: { reportId: string; events: ReportEvent[]; onSent: () => void }) {
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sent = events.filter((event) => event.type === "dispatch_simulated");

  async function recommend() {
    setBusy("recommend");
    setError("");
    try {
      const result = await api<Recommendation>(`/api/v1/admin/reports/${reportId}/dispatch/recommend`, { method: "POST" });
      setRecommendation(result);
      setDrafts(Object.fromEntries(result.agencies.map((row) => [row.agency, row.message])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "추천을 받지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function send(row: Pick) {
    setBusy(row.agency);
    setError("");
    try {
      await api(`/api/v1/admin/reports/${reportId}/dispatch`, { method: "POST", json: { agency: row.agency, message: drafts[row.agency] ?? row.message } });
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "모의 전송을 기록하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dispatch">
      <p className="dispatch-notice"><strong>시연용 모의 연결</strong> 실제 기관으로는 아무것도 전송하지 않고 전송 기록만 남깁니다.</p>

      <section className="dispatch-section">
        <div className="dispatch-head">
          <h3>연결 대상 추천</h3>
          <button type="button" onClick={recommend} disabled={busy !== null}>
            {busy === "recommend" ? "추천 받는 중…" : recommendation ? "다시 추천 받기" : "추천 받기"}
          </button>
        </div>
        {recommendation ? (
          <>
            <p className="dispatch-meta">{recommendation.source === "local_rules" ? "사건 유형 규칙 추천" : `${sourceLabelAI(recommendation.source)} 판단`} · 관할 {recommendation.district}</p>
            {recommendation.warnings.map((warning) => <p key={warning} className="dispatch-meta">{warning}</p>)}
            <ol className="dispatch-list">
              {recommendation.agencies.map((row) => {
                const done = sent.some((event) => event.data.agency === row.agency);
                return (
                  <li key={row.agency}>
                    <div className="dispatch-row">
                      <strong>{row.name}</strong>
                      {done && <span className="dispatch-done">모의 전송됨</span>}
                    </div>
                    <p className="dispatch-meta">{row.reason}</p>
                    <label className="dispatch-draft">
                      <span>보낼 메시지 (수정 가능)</span>
                      <textarea rows={5} maxLength={1000} value={drafts[row.agency] ?? row.message}
                        onChange={(event) => setDrafts({ ...drafts, [row.agency]: event.target.value })} />
                    </label>
                    <button type="button" disabled={busy !== null || !(drafts[row.agency] ?? row.message).trim()} onClick={() => send(row)}>
                      {busy === row.agency ? "기록 중…" : `${row.name}에 모의 전송`}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="dispatch-meta">추천은 참고용입니다. 연락·출동 여부는 담당자가 정합니다.</p>
          </>
        ) : (
          <p className="dispatch-meta">신고 내용과 분석 결과를 보고 연락할 기관(119·112·구청·보건소·CCTV 관제센터 중)을 추천합니다.</p>
        )}
        {error && <p role="alert" className="dispatch-error">{error}</p>}
      </section>

      <section className="dispatch-section">
        <div className="dispatch-head"><h3>전송 기록</h3><span className="dispatch-meta">{sent.length}건 · 증거 묶음에 포함</span></div>
        {sent.length ? (
          <ol className="dispatch-log">
            {[...sent].reverse().map((event, index) => (
              <li key={`${event.created_at}-${index}`}>
                <div className="dispatch-row">
                  <span className="font-mono">{kstTime(event.created_at)}</span>
                  <strong>{String(event.data.name ?? event.message)}</strong>
                  <span className="dispatch-done">모의 전송 완료</span>
                  <span className="dispatch-meta">{String(event.data.by ?? "")}</span>
                </div>
                <details><summary>보낸 메시지</summary><pre>{String(event.data.message ?? "")}</pre></details>
              </li>
            ))}
          </ol>
        ) : <p className="dispatch-meta">아직 모의 전송 기록이 없습니다.</p>}
      </section>
    </div>
  );
}
