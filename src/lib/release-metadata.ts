const FULL_GIT_SHA = /^[0-9a-f]{40}$/u;
const RELEASE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

export type ReleaseMetadata =
  | {
      status: "available";
      version: string;
      revision: string;
      shortRevision: string;
    }
  | {
      status: "unavailable";
    };

type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;

export function readReleaseMetadata(
  environment: ReleaseEnvironment = process.env,
): ReleaseMetadata {
  const revision = environment.EVO_RELEASE_REVISION?.trim().toLowerCase() ?? "";
  const version = environment.EVO_RELEASE_VERSION?.trim() ?? "";

  if (!FULL_GIT_SHA.test(revision) || !RELEASE_VERSION.test(version)) {
    return { status: "unavailable" };
  }

  return {
    status: "available",
    version,
    revision,
    shortRevision: revision.slice(0, 8),
  };
}

export function formatReleaseLabel(metadata: ReleaseMetadata): string {
  if (metadata.status === "unavailable") return "Release unavailable";
  return `${metadata.version} · ${metadata.shortRevision}`;
}
