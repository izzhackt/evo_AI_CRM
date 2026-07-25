import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import { Icon } from "@/components/icons";

export function CommunicationsSourceDisclosure({
  title,
  description,
  mobileSummary,
}: {
  title: string;
  description: string;
  mobileSummary: string;
}) {
  return (
    <>
      <div className="hidden sm:block">
        <ContextBanner title={title} description={description} tone="info" />
      </div>
      <details
        aria-label={mobileSummary}
        className="group rounded-ctl border border-info/30 bg-info-weak px-3 py-2 text-info sm:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] font-semibold marker:hidden">
          <span>{mobileSummary}</span>
          <Icon
            name="chevron-right"
            size={14}
            className="shrink-0 transition-transform group-open:rotate-90"
          />
        </summary>
        <p className="mt-2 border-t border-info/20 pt-2 text-[11.5px] leading-4">
          {description}
        </p>
      </details>
    </>
  );
}
