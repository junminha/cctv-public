import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-4xl leading-tight">신고 기반 CCTV 관제</h1>
        <p className="mt-3 text-sm text-ink-soft">
          중앙 서버 <code className="font-mono">runtime/secrets.json</code>에 있는 관리자 토큰으로 로그인합니다.
          토큰은 이 브라우저의 HttpOnly 쿠키에만 저장됩니다.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
