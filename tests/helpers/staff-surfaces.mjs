import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two different sets used to share the name `staffSurfaceFiles`, one filtered
 * and one not, so a guard written against one silently skipped files the other
 * covered. They are separate names here and each carries its own floor.
 */

const ROOTS = ["src/app", "src/components"];

/** Every .tsx under the app and component roots, repo-relative and sorted. */
export function allSurfaceFiles() {
  const files = new Set();
  for (const root of ROOTS) {
    const base = new URL(`../../${root}/`, import.meta.url);
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const dir = entry.parentPath ?? entry.path;
      files.add(`${root}/${relative(fileURLToPath(base), join(dir, entry.name))}`);
    }
  }
  return [...files].sort();
}

/**
 * Surfaces the three fixed staff roles actually operate. `portal` is the
 * retired V1 student-facing tree and `transcription` is a provider-side
 * utility; neither is reachable from the staff shell, so design guards that
 * describe the staff product must not be measured against them.
 */
export const NON_STAFF_SEGMENTS = ["portal", "transcription"];

export function staffOperatingSurfaces() {
  return allSurfaceFiles().filter(
    (file) => !NON_STAFF_SEGMENTS.some((segment) => file.includes(segment)),
  );
}

/** Floors, so a broken walk reports as a broken walk rather than a pass. */
export const MIN_ALL_SURFACES = 100;
export const MIN_STAFF_SURFACES = 85;
