"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api, type ReportDetail } from "@/lib/api";
import { useLive } from "@/lib/live";
import { ReportPanel } from "./report-panel";
import { ReportQueue } from "./report-queue";

const ChartMap = dynamic(() => import("./chart-map"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-soft">지도 불러오는 중…</div>,
});

export function Console() {
  const { snapshot, connection } = useLive();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [showPublic, setShowPublic] = useState(true);
  const [publicCount, setPublicCount] = useState<{ shown: number; total: number } | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);

  const reports = useMemo(() => snapshot?.reports ?? [], [snapshot]);
  const cameras = snapshot?.cameras ?? [];
  const selected = reports.find((report) => report.report_id === selectedId) ?? null;
  // Refetch the full detail whenever the live job state for the selected report changes.
  const jobKey = selected ? `${selected.job.state}:${selected.job.stage}:${selected.job.progress}:${selected.review?.closed_at}` : "";

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    api<ReportDetail>(`/api/v1/admin/reports/${selectedId}`).then((value) => alive && setDetail(value)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedId, jobKey]);

  function select(reportId: string) {
    setSelectedId(reportId);
    const report = reports.find((row) => row.report_id === reportId);
    if (report) setFocus([report.latitude, report.longitude]);
  }

  const refresh = () => selectedId && api<ReportDetail>(`/api/v1/admin/reports/${selectedId}`).then(setDetail).catch(() => {});

  return (
    <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)_460px] lg:overflow-hidden">
      <aside className="order-2 border-rule bg-surface lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-r">
        <ReportQueue
          reports={reports}
          selectedId={selectedId}
          connection={connection}
          onSelect={select}
        />
      </aside>

      <section className="relative order-1 h-[55vh] lg:order-2 lg:h-auto lg:min-h-0">
        <ChartMap
          reports={reports}
          cameras={cameras}
          selected={selected}
          ranking={detail?.report_id === selectedId ? detail?.analysis?.cameras ?? [] : []}
          draft={null}
          picking={false}
          showPublic={showPublic}
          focus={focus}
          onPick={() => {}}
          onSelect={select}
          onPublicCount={setPublicCount}
        />
        <div className="pointer-events-none absolute bottom-6 left-3 z-[500]">
          <div className="pointer-events-auto rounded border border-rule bg-surface/95 px-3 py-2 text-xs shadow-sm">
            <p className="mb-1 font-medium">지도 범례</p>
            <ul className="space-y-1 text-ink-soft">
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-beacon" />신고 지점과 검색 반경</li>
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-tide" />분석 승인된 시연 웹캠 (cam-01~03)</li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-signal ring-1 ring-white" />
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={showPublic} onChange={(event) => setShowPublic(event.target.checked)} />
                  부산 공개 CCTV 위치 (지도 표시 전용)
                </label>
              </li>
            </ul>
            {showPublic && publicCount && (
              <p className="mt-1.5 font-mono text-[11px] text-ink-soft">
                {publicCount.total < 0 ? "확대하면 공개 위치를 표시합니다" : `${publicCount.shown.toLocaleString()} / ${publicCount.total.toLocaleString()}개 표시`}
              </p>
            )}
          </div>
        </div>
      </section>

      <aside className="order-3 border-rule bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-l">
        {selected && detail && detail.report_id === selected.report_id ? (
          <ReportPanel detail={detail} live={selected} cameras={cameras} onChanged={refresh} />
        ) : (
          <div className="p-6 text-sm text-ink-soft">
            <p className="font-display text-2xl text-ink">신고를 선택하세요</p>
            <p className="mt-2">왼쪽 목록이나 지도의 주황 지점을 누르면 후보 카메라, 분석 근거, 요약이 여기에 표시됩니다.</p>
            <p className="mt-2">
              접수된 신고 전체는 왼쪽 위 <strong className="text-ink">CSV 내보내기</strong>로, 신고 1건의 증거 자료는 상세 화면의 <strong className="text-ink">증거 묶음 다운로드</strong>로 받을 수 있습니다.
            </p>
          </div>
        )}
      </aside>
    </main>
  );
}
