"use client";

import { bPath, type ReportSummary } from "@/lib/api";
import { INCIDENT, jobLabel, kstTime, OUTCOME, shortId, sourceLabel } from "@/lib/labels";

const CONNECTION = { connecting: "연결 중", live: "실시간", offline: "재연결 중" } as const;

export function ReportQueue({ reports, selectedId, connection, onSelect }: {
  reports: ReportSummary[];
  selectedId: string | null;
  connection: keyof typeof CONNECTION;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-rule bg-surface px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">접수된 신고</h2>
          <span className={`font-mono text-[11px] ${connection === "live" ? "text-tide" : "text-amber"}`}>
            ● {CONNECTION[connection]}
          </span>
        </div>
        <a href={bPath("/api/v1/admin/exports/reports.csv")} download
          className="mt-3 block w-full rounded bg-beacon px-3 py-2 text-center text-sm font-bold text-white hover:brightness-95">
          CSV 내보내기
        </a>
      </div>
      {reports.length === 0 ? (
        <p className="p-4 text-sm text-ink-soft">아직 접수된 신고가 없습니다.</p>
      ) : (
        <ul>
          {reports.map((report) => {
            const active = report.report_id === selectedId;
            const outcome = report.job.state === "completed" || report.job.state === "failed" ? OUTCOME[report.job.stage] : null;
            const tone = outcome?.tone === "alert" ? "text-beacon" : outcome?.tone === "warn" ? "text-amber" : "text-ink-soft";
            return (
              <li key={report.report_id}>
                <button
                  onClick={() => onSelect(report.report_id)}
                  aria-current={active ? "true" : undefined}
                  className={`block w-full border-b border-rule px-4 py-3 text-left ${active ? "bg-beacon-wash" : "hover:bg-chart"}`}
                >
                  <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                    <span>{kstTime(report.created_at)}</span>
                    <span>#{shortId(report.report_id)}</span>
                    <span className="ml-auto">{sourceLabel(report.source)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{report.description}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    {report.incident_type && <span className="rounded bg-chart px-1.5 py-0.5">{INCIDENT[report.incident_type] ?? report.incident_type}</span>}
                    <span className={`font-medium ${tone}`}>
                      {report.job.state === "running" && <span className="beacon-pulse mr-1">●</span>}
                      {jobLabel(report.job)}
                    </span>
                    {report.review?.closed_at && <span className="ml-auto text-ink-soft">종결</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
