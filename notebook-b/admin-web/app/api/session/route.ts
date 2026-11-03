import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { B_API_URL, SESSION_COOKIE, sessionCookie } from "@/lib/server";

// Log in with the local admin token from B runtime/secrets.json; it is kept in an HttpOnly cookie.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    return NextResponse.json({ detail: "관리자 토큰 형식이 아닙니다." }, { status: 400 });
  }
  let status: number;
  try {
    const check = await fetch(`${B_API_URL}/api/v1/admin/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    status = check.status;
  } catch {
    return NextResponse.json({ detail: "중앙 서버(127.0.0.1:8000)에 연결할 수 없습니다. start.ps1로 서버를 먼저 실행하세요." }, { status: 503 });
  }
  if (status === 401 || status === 403) {
    return NextResponse.json({ detail: "관리자 토큰이 아닙니다. runtime/secrets.json의 admin 토큰을 사용하세요." }, { status: 401 });
  }
  if (status !== 200) {
    return NextResponse.json({ detail: `중앙 서버 응답 오류 (${status})` }, { status: 502 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(token, request.nextUrl.protocol === "https:"));
  return response;
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
