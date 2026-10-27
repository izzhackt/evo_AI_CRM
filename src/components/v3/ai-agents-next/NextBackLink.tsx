import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

/** «Все ИИ-агенты» над заголовком страницы агента: слот `back` рамки `PageShell`. */
export function NextBackLink() {
  return <Button variant="ghost" asChild className="-ms-3 mb-2"><Link href={AI_AGENTS_HUB_HREF}><ArrowLeftIcon aria-hidden="true" /> Все ИИ-агенты</Link></Button>;
}
