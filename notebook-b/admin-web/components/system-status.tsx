"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Status = {
  ai_worker_available: boolean;
  worker_running: boolean;
  worker_enabled: boolean;
  vision: { device: string | null; models_present: boolean; loaded: boolean };
  openai: { configured: boolean; model: string };
  adapter_configured: boolean;
};

function Chip({ ok, label, title }: { ok: boolean | null; label: string; title: string }) {
  const tone = ok === null ? "bg-chart text-ink-soft" : ok ? "bg-tide-wash text-tide" : "bg-amber-wash text-amber";
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function SystemStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Status>("/api/v1/admin/status")
        .then((value) => alive && (setStatus(value), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <Chip ok={false} label="B 서버 연결 끊김" title="FastAPI 127.0.0.1:8000 응답 없음" />;
  if (!status) return <Chip ok={null} label="상태 확인 중" title="" />;
  const device = status.vision.device ?? (status.vision.loaded ? "?" : "대기");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        ok={status.ai_worker_available}
        label={status.ai_worker_available ? `AI 분석 ${device === "cuda:0" ? "GPU" : device}` : "AI 분석 꺼짐"}
        title={status.worker_enabled ? "worker 실행 여부와 모델 파일 확인" : ".env의 CCTV_WORKER_ENABLED=true 필요"}
      />
      <Chip
        ok={status.openai.configured}
        label={status.openai.configured ? `OpenAI ${status.openai.model}` : "OpenAI 키 없음 · 로컬 요약"}
        title="B 중앙 서버 .env의 OPENAI_API_KEY"
      />
      <Chip ok={status.adapter_configured} label={status.adapter_configured ? "A 연결 설정됨" : "A 연결 미설정"} title="runtime/a-secrets.json" />
      <button
        className="ml-1 text-xs text-ink-soft underline-offset-2 hover:underline"
        onClick={async () => {
          await fetch("/api/session", { method: "DELETE" });
          window.location.href = "/login";
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
