"use client";

import { useEffect, useState } from "react";
import { api, bPath, type Camera } from "@/lib/api";
import { kst } from "@/lib/labels";

type Health = { disk_free_gb: number; disk_low: boolean; cameras: { id: string; online: boolean; recording: boolean }[] };

function CameraCard({ camera, onSaved }: { camera: Camera; onSaved: () => void }) {
  const [latitude, setLatitude] = useState(camera.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(camera.longitude?.toString() ?? "");
  const [kind, setKind] = useState<"demo" | "real">(camera.kind ?? "demo");
  const [zone, setZone] = useState(camera.zone ?? "");
  const [approved, setApproved] = useState(camera.approved);
  const [consent, setConsent] = useState(camera.approved);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await api(`/api/v1/admin/cameras/${camera.id}/location`, {
        method: "PUT",
        json: { latitude: Number(latitude), longitude: Number(longitude), kind, approved, zone: zone || null },
      });
      setMessage("저장했습니다.");
      onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    }
  }

  const field = "w-full rounded border border-rule bg-surface px-2 py-1 font-mono text-sm";
  return (
    <form onSubmit={save} className="rounded border border-rule bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-lg font-medium">{camera.id}</h3>
        <span className={`text-xs font-medium ${camera.online && camera.fresh ? "text-tide" : "text-amber"}`}>
          {camera.online ? (camera.recording ? "녹화 중" : "온라인") : "오프라인"}{camera.fresh ? "" : " · 상태 갱신 필요"}
        </span>
      </div>
      <p className="text-sm text-ink-soft">{camera.name}</p>
      <p className="font-mono text-[11px] text-ink-soft">마지막 동기화 {kst(camera.synced_at)}</p>

      {!camera.demo_source && <p className="mt-2 rounded bg-amber-wash px-2 py-1 text-xs text-amber">시연 웹캠(cam-01~03)이 아니므로 분석 승인할 수 없습니다.</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-ink-soft">위도<input required inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} className={field} /></label>
        <label className="text-xs text-ink-soft">경도<input required inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} className={field} /></label>
        <label className="text-xs text-ink-soft">시연 구역<input maxLength={100} placeholder="예: BOOTH_Z1 정문" value={zone} onChange={(e) => setZone(e.target.value)} className={`${field} font-sans`} /></label>
        <label className="text-xs text-ink-soft">위치 종류
          <select value={kind} onChange={(e) => setKind(e.target.value as "demo" | "real")} className={`${field} font-sans`}>
            <option value="demo">시연 부스 지점</option><option value="real">실제 위치</option>
          </select>
        </label>
      </div>

      <fieldset className="mt-3 space-y-1.5 text-xs" disabled={!camera.demo_source}>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); if (!e.target.checked) setApproved(false); }} className="mt-0.5" />
          촬영 구역 안내를 붙였고, 화면에 나오는 출연자의 동의를 받았습니다.
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={approved} disabled={!consent} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5" />
          이 카메라를 신고 기반 AI 분석에 사용합니다.
        </label>
      </fieldset>

      <div className="mt-3 flex items-center gap-2">
        <button className="rounded bg-ink px-3 py-1.5 text-sm text-white">위치·승인 저장</button>
        {camera.approved && (
          <button type="button" onClick={() => setPreview(`${bPath(`/api/v1/admin/cameras/${camera.id}/snapshot`)}?t=${Date.now()}`)}
            className="rounded border border-rule px-3 py-1.5 text-sm">현재 화면 보기</button>
        )}
        {message && <span role="status" className="text-xs">{message}</span>}
      </div>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated live frame from B proxy
        <img src={preview} alt={`${camera.id} 현재 화면`} className="mt-3 aspect-video w-full rounded bg-chart object-cover"
          onError={() => setMessage("현재 화면을 받지 못했습니다. A의 RTSP 중계와 Tailscale 연결을 확인하세요.")} />
      )}
    </form>
  );
}

export function CameraRegistry() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState("");

  const load = () => api<{ cameras: Camera[] }>("/api/v1/admin/cameras").then((value) => setCameras(value.cameras)).catch(() => {});

  async function sync() {
    setMessage("A에서 카메라 상태를 가져오는 중…");
    try {
      const value = await api<{ cameras: Camera[] }>("/api/v1/admin/agent/sync", { method: "POST" });
      setCameras(value.cameras);
      setHealth(await api<Health>("/api/v1/admin/agent/health"));
      setMessage("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "A에 연결하지 못했습니다.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">카메라 등록</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            영상 분석에는 노트북 A의 시연 웹캠 cam-01(내장), cam-02·cam-03(USB)만 사용합니다. 위치와 시연 구역을 실제 설치 지점대로 입력하고,
            출연자 동의를 받은 카메라만 분석을 승인하세요. 부산 공개 CCTV는 지도 표시 전용이며 여기 등록하지 않습니다.
          </p>
        </div>
        <button onClick={sync} className="rounded bg-beacon px-4 py-2 text-sm font-bold text-white">A 카메라 상태 가져오기</button>
      </div>
      {message && <p role="status" className="mt-3 text-sm text-amber">{message}</p>}
      {health && (
        <p className="mt-3 font-mono text-xs text-ink-soft">
          A 저장공간 {health.disk_free_gb.toFixed(1)}GB 남음{health.disk_low ? " · 공간 부족으로 녹화 중지" : ""} ·
          녹화 중 {health.cameras.filter((camera) => camera.recording).length}/{health.cameras.length}채널
        </p>
      )}
      {cameras.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">등록된 카메라가 없습니다. A 카메라 상태 가져오기를 누르세요.</p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cameras.map((camera) => <CameraCard key={`${camera.id}-${camera.synced_at}`} camera={camera} onSaved={load} />)}
        </div>
      )}
    </main>
  );
}
