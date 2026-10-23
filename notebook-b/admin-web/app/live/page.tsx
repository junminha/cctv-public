import type { Metadata } from "next";
import { LiveWall } from "@/components/live-wall";

export const metadata: Metadata = { title: "AI 분석 로그" };

// Live analysis log: report list, per-report pipeline log and camera monitors (admin login required).
export default function Page() {
  return <LiveWall />;
}
