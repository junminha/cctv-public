"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "상황판" },
  { href: "/cameras", label: "카메라 등록" },
  { href: "/metrics", label: "성능 비교" },
];

export function ConsoleNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 text-sm">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1.5 ${active ? "bg-ink text-white" : "text-ink-soft hover:bg-chart hover:text-ink"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
