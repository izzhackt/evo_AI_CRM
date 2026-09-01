"use client";

import { Icon } from "@/components/icons";

export function ThemeToggle({ label }: { label: string }) {
  function toggle() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="theme-toggle inline-flex h-[38px] w-[38px] items-center justify-center rounded-ctl border border-control-edge bg-surface text-fg-2 transition-[background-color,color,border-color] duration-150 hover:border-control-edge hover:text-fg"
    >
      <Icon name="sun" size={18} className="i-sun" />
      <Icon name="moon" size={18} className="i-moon" />
    </button>
  );
}
