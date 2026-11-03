import Link from "next/link";
import { Suspense } from "react";
import { ConsoleNav } from "@/components/console-nav";
import { LogoutButton } from "@/components/logout-button";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    // Desktop: the header stays put and only the content below it scrolls; phones keep normal page scroll.
    <div className="flex min-h-screen flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-surface px-4 py-2">
        <Link href="/" className="font-display text-xl leading-none" aria-label="신고 관제 첫 화면으로">
          신고 관제
        </Link>
        <Suspense>
          <ConsoleNav />
        </Suspense>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">{children}</div>
    </div>
  );
}
