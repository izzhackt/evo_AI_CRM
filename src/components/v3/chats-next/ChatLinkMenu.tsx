"use client";

import Link from "next/link";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type ChatLinkOption = Readonly<{ key: string; label: string; href: string; selected: boolean }>;

/**
 * Выбор порядка списка чатов: кнопка с выбранным значением и пункты-ссылки (адрес остаётся состоянием). Окно
 * открывается и с клавиатуры, Esc возвращает фокус на кнопку (Radix). Тот же вид, что выбор «Срока» в «Задачах».
 */
export function ChatLinkMenu({
  label,
  valueLabel,
  options,
}: Readonly<{ label: string; valueLabel: string | null; options: readonly ChatLinkOption[] }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-full">
          <span className="min-w-0 truncate">{label}{valueLabel ? <>: <span className="text-fg">{valueLabel}</span></> : null}</span>
          <ChevronDownIcon aria-hidden="true" className="text-fg-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={label}>
        {options.map((option) => (
          <DropdownMenuItem key={option.key} asChild>
            <Link href={option.href} aria-current={option.selected ? "true" : undefined}>
              <span className="min-w-0 flex-1">{option.label}</span>
              {option.selected ? <CheckIcon aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
