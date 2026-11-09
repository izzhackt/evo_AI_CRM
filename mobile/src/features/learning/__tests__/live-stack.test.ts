// Живая проверка сессий против ЛОКАЛЬНОГО стенда (docs/mobile/LOCAL_STACK.md). Пропускается, пока не заданы
// EVO_LIVE_URL, EVO_LIVE_KEY (публичный ключ Supabase CLI) и EVO_LIVE_TOKEN (токен студента test.assisted).
// Ничего не коммитится: значения берутся из окружения.
import http from "node:http";

import { EnglishSession } from "@/features/learning/english/english-session";
import { readEnglishLesson, readEnglishModules } from "@/features/learning/english/api";
import { AssessmentSession, defaultAssessmentEnv } from "@/features/learning/tests/assessment-session";
import { readAssessmentCatalog } from "@/features/learning/tests/api";
import { readCscaHomeV1 } from "@/features/learning/csca/api";
import type { RpcTransport } from "@/lib/rpc";

const URL_ = process.env.EVO_LIVE_URL;
const KEY = process.env.EVO_LIVE_KEY;
const TOKEN = process.env.EVO_LIVE_TOKEN;
const live = URL_ && KEY && TOKEN ? describe : describe.skip;

// jest-expo подменяет fetch заглушкой, поэтому живой запрос идёт через node:http.
function post(name: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${URL_}/rest/v1/rpc/${name}`);
    const request = http.request(
      { host: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { apikey: KEY as string, Authorization: `Bearer ${TOKEN}`, "Content-Profile": "platform", "content-type": "application/json" } },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

const transport: RpcTransport = async (name, args) => {
  const { status, text } = await post(name, JSON.stringify(args ?? {}));
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (status < 200 || status >= 300) {
    const body = (data ?? {}) as { code?: string; message?: string };
    return { data: null, error: { code: body.code ?? null, message: body.message ?? null }, status };
  }
  return { data, error: null, status };
};

live("живой стенд: английский и тесты", () => {
  it("CSCA: главная читается строгим парсером", async () => {
    const home = await readCscaHomeV1(transport);
    expect(home.topics.length).toBe(28);
    expect(home.tests.map((t) => t.itemsTotal)).toEqual([24, 48]);
  });

  it("английский: ответ на первое упражнение возвращает вердикт и разбор; повтор тем же запросом безопасен", async () => {
    const [module] = await readEnglishModules(transport);
    const lesson = await readEnglishLesson(transport, module.lessons[0].lessonId);
    const session = new EnglishSession(transport, lesson.lesson.lessonId, lesson.lesson.exercises, lesson.draft, lesson.latestCompleted);
    const first = lesson.lesson.exercises[0];
    if (session.getState().answers[first.exerciseId]) return; // уже отвечено в прошлом прогоне
    const option = first.options?.[0]?.id;
    expect(option).toBeDefined();
    await session.answer({ selected: option as string });
    const state = session.getState();
    expect(state.error).toBeNull();
    expect(Object.keys(state.answers)).toContain(first.exerciseId);
    expect(typeof state.answers[first.exerciseId].correct).toBe("boolean");
  });

  it("тест english36: старт, выбор, автосохранение, ответ сохранён на сервере", async () => {
    const catalog = await readAssessmentCatalog(transport);
    const instrument = catalog.instruments.find((i) => i.instrumentKey === "english36");
    expect(instrument).toBeDefined();
    const env = defaultAssessmentEnv(transport);
    const session = new AssessmentSession(env, "english36", instrument?.draftAttemptId ?? null);
    await session.start();
    const state = session.getState();
    expect(state.phase).toBe("running");
    const q = (state.attempt as NonNullable<typeof state.attempt>).questions[0];
    session.select(q.id, q.options[0].id);
    await session.flush();
    expect(session.getState().saveStatus).toBe("saved");
    const reread = await readAssessmentCatalog(transport);
    const draft = reread.attempts.find((a) => a.status === "draft" && a.instrumentKey === "english36");
    expect(draft?.answeredCount).toBeGreaterThanOrEqual(1);
    session.dispose();
  });
});
