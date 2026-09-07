import type { ProfileNotesSnapshot } from "./types";
import type {
  PlatformCaseNotePage,
  PlatformCaseNoteSubject,
} from "@/lib/platform-case-notes";

/**
 * Strip repository-only identities before note rows cross the client boundary.
 * The route subject remains because the create-note form must submit the exact
 * lead or student case already visible in the profile URL.
 */
export function toProfileNotesSnapshot(
  subject: PlatformCaseNoteSubject,
  page: PlatformCaseNotePage,
): ProfileNotesSnapshot {
  return Object.freeze({
    subject,
    rows: Object.freeze(
      page.rows.map(({ body, authorDisplayName, createdAt }) =>
        Object.freeze({ body, authorDisplayName, createdAt }),
      ),
    ),
  });
}
