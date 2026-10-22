"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setError((await response.json().catch(() => null))?.detail ?? "로그인하지 못했습니다.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <label className="block text-sm font-medium" htmlFor="token">관리자 토큰</label>
      <input
        id="token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        className="w-full rounded border border-rule bg-surface px-3 py-2 font-mono text-sm"
        required
      />
      {error && <p role="alert" className="text-sm text-beacon">{error}</p>}
      <button disabled={busy || !token} className="w-full rounded bg-ink px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
