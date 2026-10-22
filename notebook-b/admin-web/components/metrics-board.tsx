"use client";

import { useEffect, useState } from "react";
import { api, type Benchmark } from "@/lib/api";
import { kst, OUTCOME, shortId } from "@/lib/labels";

type Metrics = {
  reports: Record<string, number>;
  jobs: Record<string, number>;
  attachments: number;
  preserved_clips: number;
  confirmed: number;
  closed: number;
  outcomes: Record<string, number>;
  latency_seconds: { count: number; mean: number; median: number; p95: number } | null;
  benchmarks: (Benchmark & { report_id: string; finished_at: string })[];
  note: string;
};

function Tile({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="rounded border border-rule bg-surface px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular">{value}<span className="ml-1 text-sm text-ink-soft">{unit}</span></p>
    </div>
  );
}

function PairedBars({ rows }: { rows: Metrics["benchmarks"] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.selective.frames, row.all.frames]));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs" aria-label="범례">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-series-selective" />신고 기반 선택 분석</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-series-all" />전체 카메라 집중 분석</span>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.report_id + row.finished_at} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2"
            onMouseEnter={() => setHover(row.report_id)} onMouseLeave={() => setHover(null)}>
            <span className="font-mono text-[11px] text-ink-soft">#{shortId(row.report_id)}</span>
            <div className="relative space-y-0.5">
              {(["selective", "all"] as const).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={`block h-2.5 rounded-r ${key === "selective" ? "bg-series-selective" : "bg-series-all"}`}
                    style={{ width: `${(row[key].frames / max) * 100}%`, minWidth: 2 }} />
                  <span className="font-mono text-[11px] tabular text-ink-soft">{row[key].frames}</span>
                </div>
              ))}
              {hover === row.report_id && (
                <div role="tooltip" className="absolute right-0 top-0 z-10 rounded bg-ink px-2 py-1 font-mono text-[11px] text-white shadow">
                  선택 {row.selective.frames}프레임 {row.selective.seconds}s · 전체 {row.all.frames}프레임 {row.all.seconds}s ·
                  {row.same_selection ? " 선정 일치" : " 선정 불일치"}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink-soft">막대 길이는 처리한 프레임 수입니다. 같은 영상 구간을 두 방식으로 분석했습니다.</p>
    </div>
  );
}

export function MetricsBoard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Metrics>("/api/v1/admin/metrics").then(setMetrics).catch((reason) => setError(reason.message));
  }, []);

  if (error) return <main className="p-6 text-sm text-amber">{error}</main>;
  if (!metrics) return <main className="p-6 text-sm text-ink-soft">불러오는 중…</main>;
  const total = Object.values(metrics.reports).reduce((sum, value) => sum + value, 0);
  const reductions = metrics.benchmarks.map((row) => row.frame_reduction).filter((value): value is number => value !== null);
  const meanReduction = reductions.length ? reductions.reduce((sum, value) => sum + value, 0) / reductions.length : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <h1 className="font-display text-3xl">성능 비교</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        이 화면의 숫자는 이 B 서버에서 실제로 처리한 신고의 측정값입니다. 합성 영상이나 연출 영상의 결과는 실제 현장 성능이 아닙니다.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="접수 신고" value={total} unit="건" />
        <Tile label="분석 요청부터 결과까지 중앙값" value={metrics.latency_seconds ? metrics.latency_seconds.median.toFixed(1) : "—"} unit="초" />
        <Tile label="P95 지연" value={metrics.latency_seconds ? metrics.latency_seconds.p95.toFixed(1) : "—"} unit="초" />
        <Tile label="비교 실험 평균 프레임 감소" value={meanReduction === null ? "—" : Math.round(meanReduction * 100)} unit={meanReduction === null ? "" : "%"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded border border-rule bg-surface p-4">
          <h2 className="text-sm font-bold">선택 분석 vs 전체 분석 · 처리 프레임</h2>
          {metrics.benchmarks.length ? <div className="mt-3"><PairedBars rows={metrics.benchmarks} /></div> : (
            <p className="mt-2 text-sm text-ink-soft">아직 비교 실험이 없습니다. 상황판에서 신고를 고르고 분석 방식을 &lsquo;두 방식 비교 실험&rsquo;으로 실행하세요.</p>
          )}
        </section>
        <section className="rounded border border-rule bg-surface p-4">
          <h2 className="text-sm font-bold">분석 결과 분포</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(metrics.outcomes).map(([key, value]) => (
              <li key={key} className="flex justify-between"><span>{OUTCOME[key]?.label ?? key}</span><span className="font-mono tabular">{value}</span></li>
            ))}
            {!Object.keys(metrics.outcomes).length && <li className="text-ink-soft">분석 결과 없음</li>}
          </ul>
          <dl className="mt-4 grid grid-cols-2 gap-y-1 border-t border-rule pt-3 text-xs">
            <dt className="text-ink-soft">담당자 확인</dt><dd className="text-right font-mono">{metrics.confirmed}</dd>
            <dt className="text-ink-soft">종결</dt><dd className="text-right font-mono">{metrics.closed}</dd>
            <dt className="text-ink-soft">보존 영상</dt><dd className="text-right font-mono">{metrics.preserved_clips}</dd>
            <dt className="text-ink-soft">신고자 첨부</dt><dd className="text-right font-mono">{metrics.attachments}</dd>
          </dl>
        </section>
      </div>

      {metrics.benchmarks.length > 0 && (
        <section className="mt-6 overflow-x-auto rounded border border-rule bg-surface p-4">
          <h2 className="text-sm font-bold">비교 실험 표</h2>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-ink-soft">
              <tr><th className="py-1 font-medium">신고</th><th className="font-medium">완료</th><th className="font-medium">선택 프레임 / 시간</th><th className="font-medium">전체 프레임 / 시간</th><th className="font-medium">프레임 감소</th><th className="font-medium">선정 카메라</th></tr>
            </thead>
            <tbody className="font-mono tabular">
              {metrics.benchmarks.map((row) => (
                <tr key={row.report_id + row.finished_at} className="border-t border-rule">
                  <td className="py-1">#{shortId(row.report_id)}</td>
                  <td>{kst(row.finished_at)}</td>
                  <td>{row.selective.frames} / {row.selective.seconds}s</td>
                  <td>{row.all.frames} / {row.all.seconds}s</td>
                  <td>{row.frame_reduction === null ? "—" : `${Math.round(row.frame_reduction * 100)}%`}</td>
                  <td className="font-sans">{row.selective.selected.join(", ") || "없음"} {row.same_selection ? "(일치)" : `(전체: ${row.all.selected.join(", ") || "없음"})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {metrics.latency_seconds && (
        <p className="mt-4 font-mono text-[11px] text-ink-soft">
          지연 n={metrics.latency_seconds.count} · 평균 {metrics.latency_seconds.mean}s · 중앙값 {metrics.latency_seconds.median}s · P95 {metrics.latency_seconds.p95}s. {metrics.note}
        </p>
      )}
    </main>
  );
}
