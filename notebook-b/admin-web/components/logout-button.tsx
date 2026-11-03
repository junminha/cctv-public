"use client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE" });
        window.location.href = "/login";
      }}
    >
      로그아웃
    </button>
  );
}
