"use client";

import { useState } from "react";
import { api, ApiError, bPath, type Job } from "@/lib/api";

const EXAMPLES = ["정문 안쪽 복도에 사람이 쓰러져 있어요", "차량이 통행로를 막고 서 있어요"];

// "2026-12-02T13:20" from <input type=datetime-local> is Korean local time.
const toKst = (value: string) => (value ? `${value}:00+09:00` : undefined);

export function DemoReportForm({ point, onCancel, onCreated }: {
  point: [number, number];
  onCancel: () => void;
  onCreated: (reportId: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [landmark, setLandmark] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [radius, setRadius] = useState(100);
  const [kind, setKind] = useState<"demo" | "real">("demo");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const details = [building && `건물: ${building}`, floor && `층: ${floor}`, landmark && `주변 표지: ${landmark}`]
      .filter(Boolean).join(" / ");
    try {
      const created = await api<{ report_id: string; job: Job }>("/api/v1/demo/reports", {
        method: "POST",
        json: { description, details, latitude: point[0], longitude: point[1], location_kind: kind,
          radius_m: radius, occurred_at: toKst(occurredAt) },
      });
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("consent", "true");
        const response = await fetch(bPath(`/api/v1/reports/${created.report_id}/attachments`), { method: "POST", body: form });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null))?.detail;
          setNotice(`첨부 "${file.name}" 업로드 실패: ${typeof detail === "string" ? detail : response.status}`);
        }
      }
      if (files.length && created.job.params) {
        // Re-run with attachments included; a running job keeps going and can be re-run afterwards.
        await api(`/api/v1/admin/reports/${created.report_id}/analyze`, { method: "POST", json: created.job.params })
          .catch((reason) => reason instanceof ApiError && reason.status === 409 && setNotice("분석이 이미 시작되어 첨부는 다음 재분석에 반영됩니다."));
      }
      onCreated(created.report_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "접수하지 못했습니다.");
      setBusy(false);
    }
  }

  const field = "w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div>
        <p className="font-mono text-[11px] text-ink-soft">모의 신고 · 시민 앱과 같은 접수 경로</p>
        <h2 className="font-display text-2xl">신고 내용 입력</h2>
        <p className="mt-1 font-mono text-xs text-ink-soft">지점 {point[0].toFixed(6)}, {point[1].toFixed(6)}</p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">무슨 일인가요</span>
        <textarea required maxLength={4000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        <span className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button type="button" key={example} onClick={() => setDescription(example)}
              className="rounded-full border border-rule px-2 py-0.5 text-xs text-ink-soft hover:bg-chart">{example}</button>
          ))}
        </span>
      </label>

      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 text-sm font-medium">상세 위치 (실내라면 꼭 적어 주세요)</legend>
        <input placeholder="건물명" value={building} onChange={(e) => setBuilding(e.target.value)} className={field} />
        <input placeholder="층수" value={floor} onChange={(e) => setFloor(e.target.value)} className={field} />
        <input placeholder="출입구·주변 표지 (예: 파란 안내판 앞)" value={landmark} onChange={(e) => setLandmark(e.target.value)} className={`${field} col-span-2`} />
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">발생 시각 (선택)</span>
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className={field} />
          <span className="block text-[11px] text-ink-soft">2분 넘게 지난 시각이면 녹화 영상을 분석합니다.</span>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">검색 반경</span>
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className={field}>
            {[50, 100, 200, 300, 500].map((value) => <option key={value} value={value}>{value}m</option>)}
          </select>
        </label>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">위치 종류</legend>
        <label className="mr-4 text-sm"><input type="radio" checked={kind === "demo"} onChange={() => setKind("demo")} /> 시연 부스 지점</label>
        <label className="text-sm"><input type="radio" checked={kind === "real"} onChange={() => setKind("real")} /> 실제 위치</label>
        <p className="text-[11px] text-ink-soft">같은 종류로 등록된 카메라만 후보가 됩니다.</p>
      </fieldset>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="attachments">사진·짧은 영상·녹음 (선택)</label>
        <input id="attachments" type="file" multiple accept="image/jpeg,image/png,image/webp,audio/*,video/mp4,video/quicktime,video/webm"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block text-sm" />
        {files.length > 0 && (
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            신고자가 이 자료를 상황 확인에 쓰도록 직접 선택했습니다. 사진 15MB, 녹음 25MB, 영상 100MB까지.
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-beacon">{error}</p>}
      {notice && <p className="text-sm text-amber">{notice}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !description.trim() || (files.length > 0 && !consent)}
          className="flex-1 rounded bg-beacon px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "접수 중…" : "신고 접수"}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-rule px-4 py-2 text-sm">취소</button>
      </div>
    </form>
  );
}
