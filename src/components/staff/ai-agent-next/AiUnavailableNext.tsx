import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";

/** Чтение подраздела не удалось: слова и «Повторить» вместо пустого экрана и нуля. */
export function AiUnavailableNext({ what, retryHref }: Readonly<{ what: string; retryHref: string }>) {
  return (
    <div role="alert" className="rounded-card border border-border bg-surface" data-testid="v3-ai-unavailable">
      <EmptyState tone="danger" title={`Не удалось загрузить ${what}.`} action={<Button variant="outline" asChild><a href={retryHref}>Повторить</a></Button>} />
    </div>
  );
}
