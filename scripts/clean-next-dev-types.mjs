import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(modulePath), "..");

export async function cleanNextDevTypes(repositoryRoot = defaultRepositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new TypeError("A repository root is required to clean Next.js development types.");
  }

  const nextRoot = resolve(repositoryRoot, ".next");
  const generatedTypes = resolve(nextRoot, "dev", "types");
  const expectedRelativePath = join("dev", "types");

  if (relative(nextRoot, generatedTypes) !== expectedRelativePath) {
    throw new Error("Refusing to clean a path outside .next/dev/types.");
  }

  await rm(generatedTypes, { recursive: true, force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  await cleanNextDevTypes();
}
