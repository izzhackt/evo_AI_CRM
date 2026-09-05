export type V3ProfileRouteLoadMode<DirectoryParams, Target> =
  | Readonly<{ kind: "directory"; params: DirectoryParams }>
  | Readonly<{ kind: "target"; target: Target }>
  | Readonly<{ kind: "invalid" }>;

export async function loadV3ProfileRoute<DirectoryParams, Target, Directory, View>(
  mode: V3ProfileRouteLoadMode<DirectoryParams, Target>,
  readers: Readonly<{
    readDirectory: (params: DirectoryParams) => Promise<Directory>;
    readTarget: (target: Target) => Promise<View>;
  }>,
): Promise<Readonly<{ directory: Directory | null; view: View | null }>> {
  if (mode.kind === "directory") {
    return Object.freeze({
      directory: await readers.readDirectory(mode.params),
      view: null,
    });
  }
  if (mode.kind === "target") {
    return Object.freeze({
      directory: null,
      view: await readers.readTarget(mode.target),
    });
  }
  return Object.freeze({ directory: null, view: null });
}
