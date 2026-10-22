import { Suspense } from "react";
import { ConsoleNav } from "@/components/console-nav";
import { SystemStatus } from "@/components/system-status";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-surface px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xl leading-none">신고 관제</span>
          <span className="font-mono text-[11px] text-ink-soft">NOTEBOOK B</span>
        </div>
        <Suspense>
          <ConsoleNav />
        </Suspense>
        <div className="ml-auto">
          <SystemStatus />
        </div>
      </header>
      {children}
    </div>
  );
}
