"use client";

import { useEffect, useState } from "react";
import { api, type Camera, type ReportSummary } from "./api";

export type Snapshot = { reports: ReportSummary[]; cameras: Camera[]; time: string; worker_running: boolean };
export type LiveState = { snapshot: Snapshot | null; connection: "connecting" | "live" | "offline" };

const WS_URL = process.env.NEXT_PUBLIC_B_WS_URL ?? "ws://127.0.0.1:8000/ws/v1/admin";

// One single-use ticket per connection; the admin token itself never reaches the browser.
export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>({ snapshot: null, connection: "connecting" });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    async function connect() {
      try {
        const { ticket } = await api<{ ticket: string }>("/api/v1/admin/ws-ticket", { method: "POST" });
        if (stopped) return;
        socket = new WebSocket(WS_URL);
        socket.onopen = () => socket?.send(JSON.stringify({ ticket }));
        socket.onmessage = (event) => {
          attempt = 0;
          const data = JSON.parse(event.data);
          if (data.type === "snapshot") setState({ snapshot: data, connection: "live" });
        };
        socket.onclose = () => schedule();
      } catch {
        schedule();
      }
    }

    function schedule() {
      if (stopped) return;
      setState((current) => ({ ...current, connection: "offline" }));
      attempt += 1;
      retry = setTimeout(connect, Math.min(10000, 1000 * attempt));
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return state;
}
