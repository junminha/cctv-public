import { NextResponse, type NextRequest } from "next/server";
import { B_API_URL, SESSION_COOKIE } from "@/lib/server";

// Same-origin proxy to B: attaches the admin token server side and streams bodies both ways.
const PASS_REQUEST = ["content-type", "range"];
const PASS_RESPONSE = ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "cache-control"];

async function forward(request: NextRequest, ctx: RouteContext<"/api/b/[...path]">) {
  const { path } = await ctx.params;
  if (path[0] !== "api" || path[1] !== "v1" || path.some((part) => part === ".." || part === "")) {
    return NextResponse.json({ detail: "허용되지 않은 경로입니다." }, { status: 404 });
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  }
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of PASS_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const target = `${B_API_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      cache: "no-store",
      redirect: "manual",
      // Required by Node fetch to stream a request body (multipart uploads).
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return NextResponse.json({ detail: "B 중앙 서버에 연결할 수 없습니다." }, { status: 503 });
  }
  const out = new Headers();
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
