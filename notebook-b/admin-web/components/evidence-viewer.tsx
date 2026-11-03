"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, bPath } from "@/lib/api";
import { kst } from "@/lib/labels";

// One evidence file from GET /api/v1/admin/reports/{id}/evidence (shared/API.md v0.8). Admin report detail only.
export type EvidenceItem = {
  id: string;
  category: "attachment" | "artifact" | "clip";
  kind: "image" | "audio" | "video";
  label: string;
  representation: "upload_original" | "analysis_overlay" | "remux_copy";
  content_type: string;
  bytes: number | null;
  stored_at: string | null;
  captured_at: string | null;
  timestamp_seconds: number | null;
  recorded_sha256: string | null;
  current_sha256: string | null;
  integrity: "unknown" | "match" | "mismatch";
  available: boolean;
  view_url: string;
  download_url: string;
  thumbnail_url: string | null;
  analysis_started_at: string | null;
  attachment_id?: string;
  clip_id?: string;
  camera_id?: string | null;
  artifact_kind?: string;
};

type Catalog = { items: EvidenceItem[]; analysis_started_at: string | null; warnings: string[] };

const REPRESENTATION: Record<EvidenceItem["representation"], string> = {
  upload_original: "신고자 업로드 원본",
  analysis_overlay: "AI 표시가 포함된 분석본",
  remux_copy: "보존 사본 (원본 녹화를 다시 담은 파일)",
};
const KIND: Record<EvidenceItem["kind"], string> = { image: "사진", audio: "녹음", video: "영상" };

const size = (bytes: number | null) =>
  bytes === null ? "크기 미확인" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

// Loads the report's evidence list; `refreshKey` changes when the analysis or preserved clips change.
export function useEvidence(reportId: string, refreshKey: string) {
  const key = `${reportId}:${refreshKey}`;
  const [state, setState] = useState<{ key: string; catalog?: Catalog; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    api<Catalog>(`/api/v1/admin/reports/${reportId}/evidence`)
      // A malformed answer must not take the whole report panel down.
      .then((value) => alive && setState(Array.isArray(value?.items)
        ? { key, catalog: { items: value.items, analysis_started_at: value.analysis_started_at ?? null, warnings: Array.isArray(value.warnings) ? value.warnings : [] } }
        : { key, error: "자료 목록 응답 형식이 올바르지 않습니다." }))
      .catch((reason) => alive && setState({ key, error: reason instanceof Error ? reason.message : "자료 목록을 불러오지 못했습니다." }));
    return () => {
      alive = false;
    };
  }, [reportId, key, attempt]);
  const current = state?.key === key ? state : null;
  return { catalog: current?.catalog ?? null, error: current?.error ?? null, loading: !current, retry: () => setAttempt((n) => n + 1) };
}

export function EvidenceStatus({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  if (error) {
    return (
      <div role="alert" className="evidence-status">
        <p>{error}</p>
        <button type="button" onClick={retry}>자료 다시 불러오기</button>
      </div>
    );
  }
  return loading ? <p role="status" className="evidence-status">자료 목록을 불러오는 중…</p> : null;
}

const openLabel = (item: EvidenceItem) => `${item.label} ${item.kind === "audio" ? "재생" : "크게 보기"}`;

// Thumbnails only; originals load when the viewer opens.
export function EvidenceList({ label, items, onOpen, empty }: {
  label: string;
  items: EvidenceItem[];
  onOpen: (items: EvidenceItem[], index: number) => void;
  empty?: string;
}) {
  if (!items.length) return empty ? <p className="evidence-empty">{empty}</p> : null;
  return (
    <ul aria-label={label} className="evidence-list">
      {items.map((item, index) => (
        <li key={item.id} className="evidence-tile">
          <button type="button" aria-label={openLabel(item)} disabled={!item.available} onClick={() => onOpen(items, index)} className="evidence-thumb">
            {item.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy thumbnail
              <img src={bPath(item.thumbnail_url)} alt="" loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
            ) : null}
            <span className="evidence-kind">{KIND[item.kind]}</span>
          </button>
          <span className="evidence-name" title={item.label}>{item.label}</span>
          <span className="evidence-meta">
            {item.category === "artifact" && `${item.artifact_kind}${item.camera_id ? ` · ${item.camera_id}` : ""} · `}
            {size(item.bytes)}{item.available ? "" : " · 파일 없음"}
          </span>
          {item.available && <a href={bPath(item.download_url)} download className="evidence-download">다운로드</a>}
        </li>
      ))}
    </ul>
  );
}

// Native modal viewer: image zoom, audio/video playback, file facts and download. Media unmounts on close.
export function EvidenceViewer({ reportId, items, index, onIndex, onClose }: {
  reportId: string;
  items: EvidenceItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const [zoom, setZoom] = useState<"fit" | "2x">("fit");
  const [checked, setChecked] = useState<{ id: string; item?: EvidenceItem; error?: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const item = items[index];
  const verified = checked?.id === item.id ? checked : null;

  useEffect(() => {
    opener.current = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const go = useCallback((target: number) => {
    setZoom("fit");
    onIndex((target + items.length) % items.length);
  }, [items.length, onIndex]);

  async function verify() {
    setChecked({ id: item.id });
    const version = item.analysis_started_at ? `&analysis_started_at=${encodeURIComponent(item.analysis_started_at)}` : "";
    try {
      const result = await api<EvidenceItem>(`/api/v1/admin/reports/${reportId}/evidence/${item.id}?verify=true${version}`);
      setChecked({ id: item.id, item: result });
    } catch (reason) {
      setChecked({ id: item.id, error: reason instanceof Error ? reason.message : "검증하지 못했습니다." });
    }
  }

  return (
    <dialog ref={dialog} aria-label="증거 자료 보기" className="evidence-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Media and form controls keep their own keys (seek, volume).
        if ((event.target as HTMLElement).closest("video, audio, input")) return;
        const target = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (target === null || items.length < 2) return;
        event.preventDefault();
        go(target);
      }}>
      <header className="evidence-dialog-head">
        <strong>{item.label}</strong>
        <span className="evidence-meta">{index + 1} / {items.length}</span>
        <button type="button" onClick={onClose}>닫기</button>
      </header>
      <div className="evidence-dialog-body">
        <div className="evidence-media">
          {item.kind === "image" ? (
            <>
              <div className="evidence-image-stage" data-zoom={zoom}>
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy original */}
                <img key={item.id} src={bPath(item.view_url)} alt={item.label} onError={() => setFailed(item.id)} />
              </div>
              <div className="evidence-tools">
                <button type="button" onClick={() => setZoom("2x")} disabled={zoom === "2x"}>확대</button>
                <button type="button" onClick={() => setZoom("fit")} disabled={zoom === "fit"}>맞춤</button>
              </div>
            </>
          ) : item.kind === "video" ? (
            <video key={item.id} src={bPath(item.view_url)} controls preload="metadata" onError={() => setFailed(item.id)} />
          ) : (
            <audio key={item.id} src={bPath(item.view_url)} controls preload="none" onError={() => setFailed(item.id)} />
          )}
          {/* Keep the player so its controls stay reachable; explain instead of hiding it. */}
          {failed === item.id && <p role="status" className="evidence-bad">브라우저에서 열 수 없습니다(형식 미지원 또는 무결성 검증 실패). 원본 다운로드로 확인하세요.</p>}
        </div>
        <dl className="evidence-facts">
          <dt>구분</dt><dd>{REPRESENTATION[item.representation]}</dd>
          <dt>형식</dt><dd>{KIND[item.kind]} · {item.content_type} · {size(item.bytes)}</dd>
          <dt>저장 시각</dt><dd>{item.stored_at ? kst(item.stored_at) : "미확인"}</dd>
          <dt>촬영 시각</dt><dd>{item.captured_at ? kst(item.captured_at) : "촬영 시각 미확인"}
            {item.timestamp_seconds !== null && <> · 분석 구간 +{item.timestamp_seconds}초</>}</dd>
          <dt>기록 SHA256</dt><dd className="evidence-hash">{item.recorded_sha256 ?? "기록 없음 (분석 중 생성된 파일)"}</dd>
          {verified?.item && (
            <>
              <dt>현재 SHA256</dt>
              <dd className="evidence-hash"><span>{verified.item.current_sha256}</span>
                <span className={verified.item.integrity === "mismatch" ? "evidence-bad" : "evidence-good"}>
                  {verified.item.integrity === "match" ? " 일치" : verified.item.integrity === "mismatch" ? " 불일치" : " 비교 기록 없음"}
                </span>
              </dd>
            </>
          )}
        </dl>
        {verified?.error && <p role="alert" className="evidence-bad">{verified.error}</p>}
        <div className="evidence-tools">
          <button type="button" onClick={verify} disabled={verified !== null && !verified.item && !verified.error}>해시 검증</button>
          <a href={bPath(item.download_url)} download>원본 다운로드</a>
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => go(index - 1)}>이전</button>
              <button type="button" onClick={() => go(index + 1)}>다음</button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
