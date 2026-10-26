"use client";

import { useState } from "react";

export function LiveEvidence({ src, caption }: { src: string; caption: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="evidence">
      <a href={src} target="_blank" rel="noreferrer" aria-label={`근거 프레임 원본 보기: ${caption}`}>
        {broken ? <p className="evidence-error">근거 이미지를 불러오지 못했습니다. 원본을 직접 확인하세요.</p> : (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated artifact proxy
          <img src={src} alt={`AI 근거 프레임: ${caption}`} onError={() => setBroken(true)} />
        )}
      </a>
      <figcaption>{caption} · 자동 탐지 후보, 미확인</figcaption>
    </figure>
  );
}
