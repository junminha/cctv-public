"use client";

import { useId } from "react";

export function ConsoleTabs<T extends string>({ label, items, value, onChange, children }: {
  label: string;
  items: readonly { id: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <>
      <div role="tablist" aria-label={label} className="console-tabs">
        {items.map((item, index) => (
          <button key={item.id} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-panel`}
            aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
            onClick={() => onChange(item.id)} onKeyDown={(event) => {
              const target = event.key === "ArrowRight" ? (index + 1) % items.length
                : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
                : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
              if (target < 0) return;
              event.preventDefault();
              onChange(items[target].id);
              (event.currentTarget.parentElement?.children[target] as HTMLButtonElement | undefined)?.focus();
            }}>{item.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0} className="console-tabpanel">
        {children}
      </div>
    </>
  );
}
