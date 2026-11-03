"use client";

import { useState } from "react";
import type { ReportSummary } from "@/lib/api";
import { INCIDENT, kstTime, shortId } from "@/lib/labels";
import { acknowledge, urgentOpen, useAlarm } from "@/lib/urgent";

// Raised urgent reports, shown above everything until acknowledged. Acknowledging is logged on B.
export function UrgentBanner({ reports, onShow }: { reports: ReportSummary[]; onShow: (reportId: string) => void }) {
  useAlarm(reports);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const raised = reports.filter(urgentOpen).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!raised.length) return null;

  async function ack(reportId: string) {
    setBusy(reportId);
    setError("");
    try {
      await acknowledge(reportId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "확인을 기록하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="alert" className="urgent-banner">
      {raised.slice(0, 1).map((report) => (
        <div key={report.report_id} className="urgent-row">
          <span className="urgent-label">긴급</span>
          <span className="urgent-text">
            <strong>{INCIDENT[report.incident_type ?? ""] ?? (report.priority_basis === "keywords" ? "쓰러짐·화재 의심 (신고문 기준)" : "먼저 확인할 신고")}</strong>
            <span className="urgent-meta">{kstTime(report.created_at)} · #{shortId(report.report_id)}</span>
            <span className="urgent-desc">{report.description || "위치만 보낸 신고"}</span>
          </span>
          <button type="button" onClick={() => onShow(report.report_id)} className="urgent-show">보기</button>
          <button type="button" disabled={busy === report.report_id} onClick={() => ack(report.report_id)} className="urgent-ack">
            {busy === report.report_id ? "기록 중" : "확인"}
          </button>
        </div>
      ))}
      {raised.length > 1 && <p className="urgent-more">긴급 신고 {raised.length - 1}건 더 있음 · 왼쪽 목록의 긴급 탭에서 확인하세요.</p>}
      {error && <p className="urgent-more">{error}</p>}
      <p className="urgent-more">119·112 신고 여부를 먼저 확인하세요. 확인을 누르면 누가 언제 확인했는지 기록됩니다.</p>
    </div>
  );
}
