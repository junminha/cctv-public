import type { Metadata } from "next";
import { LiveWall } from "@/components/live-wall";

export const metadata: Metadata = { title: "AI 분석 라이브" };

// Exhibition display: open full-screen on the booth TV (admin login required).
export default function Page() {
  return <LiveWall />;
}
