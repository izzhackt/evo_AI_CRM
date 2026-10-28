import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Классы кнопок для прежних форм-команд (`AiActionForm` принимает строку классов): тот же вид, что у `Button` набора. Основная — одна
 * красная кнопка подраздела; остальные — контурные. Подпись команды длинная («Отозвать — ИИ перестанет готовить ответы», «Удалить — агент
 * перестанет его использовать»): кнопка переносит её на строки и растёт по высоте (не меньше 44 px), а не растягивает карточку и панель
 * шире окна. `cn` убирает запрет переноса и фиксированную высоту, которые даёт `buttonVariants`.
 */
const WRAP = "h-auto min-h-11 max-w-full whitespace-normal py-2 text-left";
export const AI_PRIMARY_BUTTON = cn(buttonVariants({ variant: "default", className: WRAP }));
export const AI_OUTLINE_BUTTON = cn(buttonVariants({ variant: "outline", className: WRAP }));
