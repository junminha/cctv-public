import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard (npm package, self-hosted) carries every Korean label; Plex Mono is kept for IDs, times and figures.
const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "신고 기반 CCTV 관제",
  description: "시민 신고 기반 CCTV 선택적 AI 영상 분석 관리자 화면",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-chart text-ink">{children}</body>
    </html>
  );
}
