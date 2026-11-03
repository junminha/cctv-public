"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api, type Nearby, type ReportDetail } from "@/lib/api";
import { useLive } from "@/lib/live";
import { byUrgency } from "@/lib/urgent";
import { ReportPanel } from "./report-panel";
import { ReportQueue } from "./report-queue";
import { UrgentBanner } from "./urgent-banner";

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

  const reports = useMemo(() => snapshot?.reports ?? [], [snapshot]);
  const cameras = snapshot?.cameras ?? [];
  const selected = reports.find((report) => report.report_id === selectedId) ?? null;
  const [preview, setPreview] = useState<{ id: string; radius: number } | null>(null);
  // Show the radius being dragged right away instead of waiting for the save and the next live snapshot.
  const currentDetail = detail?.report_id === selectedId ? detail : null;
  const lastRun = currentDetail?.events.map((event) => event.type).lastIndexOf("analysis_requested") ?? -1;
  const analysis = currentDetail?.analysis;
  const currentAnalysis = analysis && selected?.job.state !== "running" && selected?.job.state !== "queued"
    && (lastRun < 0 || Date.parse(analysis.started_at) >= Date.parse(currentDetail!.events[lastRun].created_at)) ? analysis : null;
  const mapSelected = selected ? { ...selected, selected_camera_ids: currentAnalysis?.selected_camera_ids ?? [],
    radius_m: preview?.id === selected.report_id ? preview.radius : selected.radius_m } : null;
  // Refetch the full detail whenever the live job state for the selected report changes.
  const jobKey = selected ? `${selected.job.state}:${selected.job.stage}:${selected.job.progress}:${selected.review?.closed_at}:${selected.response_logs ?? 0}:${selected.alert_acknowledged}` : "";

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
    setPreview(null);
  }

  // Recommended public CCTV for the selected report at its current radius, numbered on the map.
  const nearbyKey = selected ? `${selected.report_id}:${selected.radius_m}` : "";
  const [nearby, setNearby] = useState<{ key: string; data: Nearby } | null>(null);
  useEffect(() => {
    if (!nearbyKey) return;
    let alive = true;
    api<Nearby>(`/api/v1/admin/reports/${nearbyKey.split(":")[0]}/nearby`)
      .then((data) => alive && setNearby({ key: nearbyKey, data }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [nearbyKey]);
  const recommended = nearby?.key === nearbyKey ? nearby.data.public.recommended : [];

  const refresh = () => selectedId && api<ReportDetail>(`/api/v1/admin/reports/${selectedId}`).then(setDetail).catch(() => {});

  return (
    <main className="admin-console">
      <div className="console-urgent"><UrgentBanner reports={reports} onShow={select} /></div>
      <div className="console-workspace">
      <aside aria-label="접수된 신고" className="console-queue border-rule bg-surface lg:border-r">
        <ReportQueue
          reports={byUrgency(reports)}
          selectedId={selectedId}
          connection={connection}
          onSelect={select}
        />
      </aside>

      <section aria-label="신고 위치 지도" className="console-map relative">
        <ChartMap
          reports={reports}
          cameras={cameras}
          selected={mapSelected}
          ranking={currentAnalysis?.cameras ?? []}
          draft={null}
          picking={false}
          showPublic={showPublic}
          onPick={() => {}}
          onSelect={select}
          onPublicCount={setPublicCount}
          recommended={recommended}
        />
        <div className="pointer-events-none absolute bottom-6 left-3 z-[500]">
          <div className="console-legend pointer-events-auto border border-rule bg-surface px-2 py-1.5 text-[11px] leading-[1.35]">
            <p className="mb-0.5 font-medium">지도 범례</p>
            <ul className="space-y-0.5 text-ink-soft">
              <li className="flex items-center gap-1.5"><span className="legend-report" aria-hidden />신고 지점과 검색 반경</li>
              <li className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 bg-tide" />분석 승인된 시연 웹캠 (cam-01~03)</li>
              <li className="flex items-center gap-1.5"><span className="rec-num top shrink-0">1</span>선택한 신고의 추천 공공 CCTV 순위 (위치정보 기준)</li>
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 bg-signal ring-1 ring-white" />
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="h-3 w-3 shrink-0" checked={showPublic} onChange={(event) => setShowPublic(event.target.checked)} />
                  부산 공개 CCTV 위치 (지도 표시 전용)
                </label>
              </li>
            </ul>
            {showPublic && publicCount && (
              <p className="mt-1 font-mono text-[11px] text-ink-soft">
                {publicCount.total < 0 ? "확대하면 공개 위치를 표시합니다" : `${publicCount.shown.toLocaleString()} / ${publicCount.total.toLocaleString()}개 표시`}
              </p>
            )}
          </div>
        </div>
      </section>

      <aside aria-label="신고 상세" className="console-detail border-rule bg-surface lg:border-l">
        {selected && detail && detail.report_id === selected.report_id ? (
          <ReportPanel key={detail.report_id} detail={detail} live={selected} cameras={cameras} onChanged={refresh}
            onRadiusPreview={(radius) => setPreview({ id: detail.report_id, radius })} />
        ) : (
          <div className="p-6 text-sm text-ink-soft">
            <p className="font-display text-2xl text-ink">신고를 선택하세요</p>
            <p className="mt-2">왼쪽 목록이나 지도의 신고 지점을 누르면 후보 카메라, 분석 근거, 요약이 여기에 표시됩니다.</p>
            <p className="mt-2">
              접수된 신고 전체는 왼쪽 위 <strong className="text-ink">CSV 내보내기</strong>로, 신고 1건의 증거 자료는 상세 화면의 <strong className="text-ink">증거 묶음 다운로드</strong>로 받을 수 있습니다.
            </p>
          </div>
        )}
      </aside>
      </div>
    </main>
  );
}
