import { PlatformStudentHandoffRepositoryError } from "../platform-student-handoff.ts";

/** Sales workflow is required for a lead, but optional on an authorized case. */
export async function loadProfileSalesContext<Gate, Handoff>(
  mode: "lead" | "case",
  readers: Readonly<{
    readGate: () => Promise<Gate>;
    readHandoff: () => Promise<Handoff>;
  }>,
): Promise<Readonly<{ gate: Gate; handoff: Handoff }> | null> {
  if (mode === "case") {
    let handoff: Handoff;
    try {
      handoff = await readers.readHandoff();
    } catch (error) {
      if (error instanceof PlatformStudentHandoffRepositoryError && error.reason === "forbidden") {
        return null;
      }
      throw error;
    }
    return { gate: await readers.readGate(), handoff };
  }
  const [gate, handoff] = await Promise.all([readers.readGate(), readers.readHandoff()]);
  return { gate, handoff };
}

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
