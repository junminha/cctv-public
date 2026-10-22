import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: FastAPI validates the token on every proxied request.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("cctv_admin")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // API routes answer 401 themselves instead of redirecting.
  matcher: ["/((?!login|api/|_next/static|_next/image|favicon.ico).*)"],
};
