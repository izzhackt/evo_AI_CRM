/**
 * Замер A0 (docs/PLAN_CHANGES.md 19.10.2026): одна строка `evo_timing` на запрос.
 * Ставится один раз при старте Node.js-сервера; в Edge-среде ничего не делает.
 * Сбой установки не должен мешать серверу: замер — наблюдение, не часть ответа.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { installRequestTiming } = await import("./lib/server/request-timing-node.ts");
    installRequestTiming();
  } catch (error) {
    console.error(
      JSON.stringify({ event: "evo_timing_install_failed", service: "evo-crm", reason: error instanceof Error ? error.name : "unknown" }),
    );
  }
}
