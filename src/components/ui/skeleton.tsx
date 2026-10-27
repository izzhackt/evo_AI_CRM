import { cn } from "@/lib/utils";

/** Заглушка загрузки; пульс отключается `prefers-reduced-motion` (v3.css). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("animate-pulse rounded-ctl bg-surface-2", className)} {...props} />;
}

export { Skeleton };
