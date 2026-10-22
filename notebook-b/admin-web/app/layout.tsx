import type { Metadata } from "next";
import { Black_Han_Sans, IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

const plexKr = IBM_Plex_Sans_KR({ variable: "--font-plex-kr", weight: ["400", "500", "700"], subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", weight: ["400", "500"], subsets: ["latin"] });
const han = Black_Han_Sans({ variable: "--font-han", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "신고 기반 CCTV 관제",
  description: "시민 신고 기반 CCTV 선택적 AI 영상 분석 관리자 화면 (노트북 B)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${plexKr.variable} ${plexMono.variable} ${han.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-chart text-ink">{children}</body>
    </html>
  );
}
