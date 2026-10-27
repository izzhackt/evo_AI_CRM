"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Вкладки одной страницы, переключаемые без перехода. Вкладки-разделы с адресом `?tab=` — это ссылки,
 * для них `SectionTabs` (src/components/kit): «вкладка» и «переход» в CRM — разные вещи (CLAUDE.md).
 * Выбранная вкладка — нейтральная, как `.v3-choice`: красной подложки у выбранного нет.
 */
function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-3 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva("flex w-fit max-w-full items-center gap-1 overflow-x-auto", {
  variants: {
    variant: {
      line: "w-full border-b border-border pb-2",
      default: "rounded-ctl bg-surface-2 p-1",
    },
  },
  defaultVariants: { variant: "line" },
});

function TabsList({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-nav border border-transparent px-3 t-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:-outline-offset-2! disabled:pointer-events-none disabled:text-fg-3 data-active:border-accent-text data-active:bg-accent-weak data-active:font-semibold data-active:text-accent-text [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("min-w-0 flex-1", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
