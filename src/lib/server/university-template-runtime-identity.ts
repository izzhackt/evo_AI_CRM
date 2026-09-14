import "server-only";

export type UniversityTemplateRuntimeIdentity = Readonly<{
  imageId: string;
  imageSha256: string;
  revision: string;
  digestKind: "Dockerengine-image-id";
}>;

/** The release controller, not the operator env or browser, supplies this tuple. */
export function readUniversityTemplateRuntimeIdentity(): UniversityTemplateRuntimeIdentity {
  const imageId = process.env.EVO_RUNTIME_IMAGE_ID;
  const revision = process.env.EVO_RELEASE_REVISION;
  if (process.platform !== "linux" || typeof imageId !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(imageId) || typeof revision !== "string"
    || !/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error("template_runtime_unavailable");
  }
  return Object.freeze({ imageId, imageSha256: imageId.slice(7), revision, digestKind: "Dockerengine-image-id" });
}
