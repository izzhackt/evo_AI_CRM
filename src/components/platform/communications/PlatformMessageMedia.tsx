import { cn } from "@/components/ui";
import type {
  PlatformMessageMedia,
  PlatformMessageMediaArchivalStatus,
  PlatformMessageMediaKind,
} from "@/lib/platform-communications";

type PlatformMessageMediaLabels = Readonly<{
  platformMediaGalleryLabel: string;
  platformMediaImageAlt: string;
  platformMediaAudioLabel: string;
  platformMediaVideoLabel: string;
  platformMediaDownload: string;
  platformMediaDownloadPdf: string;
  platformMediaPending: string;
  platformMediaProcessing: string;
  platformMediaRetryableError: string;
  platformMediaTerminalError: string;
  platformMediaFileUnnamed: string;
  platformMediaSizeUnknown: string;
}>;

export function buildPlatformMediaHref(
  mediaId: string,
  options: Readonly<{ download?: boolean }> = {},
): string {
  const params = new URLSearchParams();
  if (options.download) params.set("download", "1");
  const query = params.toString();
  return `/api/platform-messaging/media/${encodeURIComponent(mediaId)}${
    query.length > 0 ? `?${query}` : ""
  }`;
}

export function mediaStatusLabel(
  status: PlatformMessageMediaArchivalStatus,
  labels: PlatformMessageMediaLabels,
): string {
  switch (status) {
    case "pending":
      return labels.platformMediaPending;
    case "processing":
      return labels.platformMediaProcessing;
    case "retryable_error":
      return labels.platformMediaRetryableError;
    case "terminal_error":
      return labels.platformMediaTerminalError;
    case "archived":
      return "";
  }
}

function formatBytes(value: number | null, labels: PlatformMessageMediaLabels) {
  if (value === null || value < 0) return labels.platformMediaSizeUnknown;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function displayFileName(
  media: PlatformMessageMedia,
  labels: PlatformMessageMediaLabels,
) {
  return media.fileName ?? labels.platformMediaFileUnnamed;
}

function canPreview(kind: PlatformMessageMediaKind) {
  return kind === "image" || kind === "audio" || kind === "video";
}

function statusTone(status: PlatformMessageMediaArchivalStatus) {
  switch (status) {
    case "pending":
    case "processing":
      return "border-info/30 bg-info-weak text-info";
    case "retryable_error":
    case "terminal_error":
      return "border-warn/40 bg-warn-weak text-warn";
    case "archived":
      return "border-border bg-bg text-fg";
  }
}

export function PlatformMessageMedia({
  media,
  outgoing,
  labels,
}: Readonly<{
  media: readonly PlatformMessageMedia[];
  outgoing: boolean;
  labels: PlatformMessageMediaLabels;
}>) {
  if (media.length === 0) return null;

  return (
    <div
      aria-label={labels.platformMediaGalleryLabel}
      className="mt-2 space-y-2"
      role="group"
    >
      {media.map((entry) => {
        const href = buildPlatformMediaHref(entry.id, {
          download: !canPreview(entry.mediaKind),
        });
        const statusLabel = mediaStatusLabel(entry.archivalStatus, labels);
        const fileLabel = displayFileName(entry, labels);

        return (
          <section
            key={entry.id}
            className={cn(
              "overflow-hidden rounded-2xl border",
              statusTone(entry.archivalStatus),
              outgoing && entry.archivalStatus === "archived"
                ? "bg-white/10 text-white"
                : "",
            )}
          >
            {entry.archivalStatus === "archived" ? (
              <div className="space-y-2 p-2.5">
                {entry.mediaKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived authenticated media redirects are not compatible with Next image optimization.
                  <img
                    alt={`${labels.platformMediaImageAlt}: ${fileLabel}`}
                    className="max-h-72 w-full rounded-xl object-cover"
                    loading="lazy"
                    src={buildPlatformMediaHref(entry.id)}
                  />
                ) : null}
                {entry.mediaKind === "audio" ? (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold">
                      {labels.platformMediaAudioLabel}
                    </p>
                    <audio
                      aria-label={`${labels.platformMediaAudioLabel}: ${fileLabel}`}
                      className="w-full"
                      controls
                      preload="none"
                      src={buildPlatformMediaHref(entry.id)}
                    />
                  </div>
                ) : null}
                {entry.mediaKind === "video" ? (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold">
                      {labels.platformMediaVideoLabel}
                    </p>
                    <video
                      aria-label={`${labels.platformMediaVideoLabel}: ${fileLabel}`}
                      className="max-h-72 w-full rounded-xl bg-black"
                      controls
                      preload="metadata"
                      src={buildPlatformMediaHref(entry.id)}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 break-words font-semibold">
                    {fileLabel}
                  </span>
                  <span className="shrink-0 opacity-80">
                    {formatBytes(entry.fileSizeBytes, labels)}
                  </span>
                </div>
                {entry.mediaKind === "pdf" || entry.mediaKind === "file" ? (
                  <a
                    className="inline-flex rounded-full border border-current/20 px-3 py-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                    href={href}
                  >
                    {entry.mediaKind === "pdf"
                      ? labels.platformMediaDownloadPdf
                      : labels.platformMediaDownload}
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="p-2.5 text-[11.5px] leading-4">
                <p className="font-semibold">{fileLabel}</p>
                <p className="mt-1">{statusLabel}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
