"use client";

import { useState } from "react";
import { bPath, type ReportSummary } from "@/lib/api";
import { INCIDENT, jobLabel, kstTime, OUTCOME, shortId, sourceLabel } from "@/lib/labels";
import { ConsoleTabs } from "./console-tabs";

const CONNECTION = { connecting: "연결 중", live: "실시간", offline: "재연결 중" } as const;

export function ReportQueue({ reports, selectedId, connection, onSelect }: {
  reports: ReportSummary[];
  selectedId: string | null;
  connection: keyof typeof CONNECTION;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"urgent" | "processing" | "completed">("processing");
  const complete = (report: ReportSummary) => !!(report.review?.confirmed_at || report.review?.closed_at);
  const groups = {
    urgent: reports.filter((report) => report.priority === "urgent" && !complete(report)),
    processing: reports.filter((report) => !complete(report)),
    completed: reports.filter(complete),
  };
  const filtered = groups[filter];
  return (
    <div className="report-queue">
      <div className="sticky top-0 z-10 border-b border-rule bg-surface px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">접수된 신고</h2>
          <span className={`font-mono text-[11px] ${connection === "live" ? "text-tide" : "text-amber"}`}>
            ● {CONNECTION[connection]}
          </span>
        </div>
      </div>
      <ConsoleTabs label="신고 목록 필터" value={filter} onChange={setFilter} items={[
        { id: "urgent", label: <>긴급 <span className="font-mono">{groups.urgent.length}</span></> },
        { id: "processing", label: <>처리 중 <span className="font-mono">{groups.processing.length}</span></> },
        { id: "completed", label: <>완료 <span className="font-mono">{groups.completed.length}</span></> },
      ]}>
      <a href={bPath("/api/v1/admin/exports/reports.csv")} download
        className="queue-export block border border-ink px-3 py-1.5 text-center text-xs font-bold">
        CSV 내보내기
      </a>
      {filtered.length === 0 ? (
        <p className="p-4 text-sm text-ink-soft">{reports.length ? "해당 상태의 신고가 없습니다." : "아직 접수된 신고가 없습니다."}</p>
      ) : (
        <ul>
          {filtered.map((report) => {
            const active = report.report_id === selectedId;
            const outcome = report.job.state === "completed" || report.job.state === "failed" ? OUTCOME[report.job.stage] : null;
            const tone = outcome?.tone === "alert" ? "text-beacon" : outcome?.tone === "warn" ? "text-amber" : "text-ink-soft";
            return (
              <li key={report.report_id}>
                <button
                  onClick={() => onSelect(report.report_id)}
                  aria-current={active ? "true" : undefined}
                  className={`queue-report block w-full border-b border-rule px-4 py-3 text-left ${active ? "queue-selected bg-chart" : "hover:bg-chart"}`}
                >
                  <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                    <span>{kstTime(report.created_at)}</span>
                    <span>#{shortId(report.report_id)}</span>
                    <span className="ml-auto">{sourceLabel(report.source)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{report.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    {report.priority === "urgent" && !report.review?.closed_at && (
                      <span className={`px-1.5 py-0.5 font-bold ${report.alert_acknowledged ? "border border-signal text-signal" : "bg-signal text-white"}`}>
                        긴급{report.alert_acknowledged ? " · 확인됨" : ""}
                      </span>
                    )}
                    {report.priority === "high" && !report.review?.closed_at && <span className="border border-amber px-1.5 py-0.5 font-bold text-amber">높음</span>}
                    {report.incident_type && <span>{INCIDENT[report.incident_type] ?? report.incident_type}</span>}
                    <span className={`font-medium ${tone}`}>
                      {report.job.state === "running" && <span className="beacon-pulse mr-1">●</span>}
                      {jobLabel(report.job)}
                    </span>
                    {report.review?.closed_at && <span className="ml-auto text-ink-soft">종결</span>}
                    {report.review?.confirmed_at && !report.review.closed_at && <span className="text-tide">확인 완료</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </ConsoleTabs>
    </div>
  );
}
