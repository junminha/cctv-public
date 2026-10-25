"use client";

import { useEffect, useRef } from "react";
import { api, type ReportSummary } from "./api";

// An urgent report stays raised until someone acknowledges, confirms or closes it.
export const urgentOpen = (report: ReportSummary) =>
  report.priority === "urgent" && !report.alert_acknowledged && !report.review?.closed_at;

// Raised urgent reports first, newest on top; everything else keeps its order.
export function byUrgency(reports: ReportSummary[]) {
  const raised = reports.filter(urgentOpen).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...raised, ...reports.filter((report) => !urgentOpen(report))];
}

export const acknowledge = (reportId: string) =>
  api(`/api/v1/admin/reports/${reportId}/log`, { method: "POST", json: { kind: "alert_ack" } });

// Three short tones whenever a new urgent report is raised. Browsers allow sound only after the
// page has been clicked once; until then the banner alone carries the alert.
export function useAlarm(reports: ReportSummary[]) {
  const heard = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const ids = reports.filter(urgentOpen).map((report) => report.report_id).join(",");

  useEffect(() => {
    const current = ids ? ids.split(",") : [];
    if (heard.current === null) heard.current = new Set();
    const fresh = current.filter((id) => !heard.current!.has(id));
    current.forEach((id) => heard.current!.add(id));
    if (!fresh.length) return;
    try {
      audio.current ??= new AudioContext();
      const context = audio.current;
      void context.resume();
      [0, 0.28, 0.56].forEach((offset) => {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = 880;
        gain.gain.setValueAtTime(0.18, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + offset + 0.2);
        tone.connect(gain).connect(context.destination);
        tone.start(context.currentTime + offset);
        tone.stop(context.currentTime + offset + 0.22);
      });
    } catch {
      // No audio device or autoplay blocked: the banner is still shown.
    }
  }, [ids]);
}
