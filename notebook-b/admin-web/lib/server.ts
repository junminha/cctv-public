import "server-only";

// B FastAPI listens on loopback only; the browser never talks to it with the admin token.
export const B_API_URL = (process.env.B_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
export const SESSION_COOKIE = "cctv_admin";
export const SESSION_SECONDS = 12 * 60 * 60;

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}
