import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// A1 (аудит 10.10.2026): вкладка, пережившая выпуск, зовёт server action,
// которого новая сборка не знает. Next 16 отвечает 404 с
// `x-nextjs-action-not-found: 1`, клиент бросает UnrecognizedActionError.
// Здесь — настоящий класс и настоящая проверка Next: `next/navigation`
// реэкспортирует `unstable_isUnrecognizedActionError` ровно из этого модуля,
// а полный клиентский модуль навигации под --conditions=react-server не грузится.

const require = createRequire(import.meta.url);
const UNRECOGNIZED_ACTION_MODULE = require.resolve("next/dist/client/components/unrecognized-action-error.js");
const { UnrecognizedActionError } = require(UNRECOGNIZED_ACTION_MODULE);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && context.parentURL?.includes("/src/lib/stale-deployment.ts")) {
      return { shortCircuit: true, url: pathToFileURL(UNRECOGNIZED_ACTION_MODULE).href };
    }
    return nextResolve(specifier, context);
  },
});

const portalI18n = await import("../src/lib/portal/i18n.ts");

let fresh = 0;
/** Флаг живёт на страницу; каждому случаю — свой экземпляр модуля. */
function freshStore() {
  fresh += 1;
  return import(`../src/lib/stale-deployment.ts?case=${fresh}`);
}

function staleActionError() {
  return new UnrecognizedActionError('Server Action "40878e781e" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
}

test("the helper recognises Next's unrecognized-action error and its 404 shape, nothing else", async () => {
  const { isStaleDeploymentError, ACTION_NOT_FOUND_HEADER } = await freshStore();
  assert.equal(ACTION_NOT_FOUND_HEADER, "x-nextjs-action-not-found");

  assert.equal(isStaleDeploymentError(staleActionError()), true, "the real UnrecognizedActionError");
  const copy = Object.assign(new Error('Server Action "40814a236a" was not found on the server.'), { name: "UnrecognizedActionError" });
  assert.equal(isStaleDeploymentError(copy), true, "the same class from a second module copy");
  assert.equal(isStaleDeploymentError(new Error('Server Action "40814a236a" was not found on the server. \nRead more: …')), true);
  assert.equal(isStaleDeploymentError(new Response("", { status: 404, headers: { [ACTION_NOT_FOUND_HEADER]: "1" } })), true);

  // Сбой сети, обычный 404, ответ сервера с ошибкой и прочее — не новая версия.
  assert.equal(isStaleDeploymentError(new TypeError("Failed to fetch")), false);
  assert.equal(isStaleDeploymentError(new Response("", { status: 404 })), false);
  assert.equal(isStaleDeploymentError(new Response("", { status: 500, headers: { [ACTION_NOT_FOUND_HEADER]: "1" } })), false);
  assert.equal(isStaleDeploymentError(new Error("An error occurred in the Server Components render.")), false);
  assert.equal(isStaleDeploymentError(new Error('Prefix Server Action "x" was not found on the server')), false);
  for (const value of [null, undefined, "UnrecognizedActionError", 404, {}]) assert.equal(isStaleDeploymentError(value), false);
});

test("one page-wide flag: first detection marks the page, inline prompts silence the shell notice", async () => {
  const store = await freshStore();
  const seen = [];
  const unsubscribe = store.subscribeStaleDeployment(() => seen.push([store.isStaleDeployment(), store.shouldShowStaleDeploymentNotice()]));

  assert.equal(store.noteStaleDeployment(new TypeError("Failed to fetch")), false);
  assert.equal(store.isStaleDeployment(), false);
  assert.equal(store.shouldShowStaleDeploymentNotice(), false);

  assert.equal(store.noteStaleDeployment(staleActionError()), true);
  assert.equal(store.noteStaleDeployment(staleActionError()), true, "a second detection is still recognised");
  assert.deepEqual(seen, [[true, true]], "marking is idempotent: listeners hear it once");

  const releaseA = store.holdInlineStalePrompt();
  const releaseB = store.holdInlineStalePrompt();
  assert.equal(store.shouldShowStaleDeploymentNotice(), false);
  releaseA(); releaseA();
  assert.equal(store.shouldShowStaleDeploymentNotice(), false, "a double release does not over-release");
  releaseB();
  assert.equal(store.shouldShowStaleDeploymentNotice(), true);
  unsubscribe();
});

// ---------------------------------------------------------------------------
// Production client components with their import boundaries replaced and a
// minimal hook runtime: effects, re-renders and cleanup run like React's, so
// the pollers' own interval/listener code is exercised (no DOM, no backend).

function depsEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

function createRuntime() {
  let slots = [];
  let cursor = 0;
  let pending = [];
  let dirty = false;
  let tree = null;
  let renderComponent = null;
  const transitions = [];
  const memo = (factory, deps) => {
    const i = cursor++;
    if (slots[i] && depsEqual(slots[i].deps, deps)) return slots[i].value;
    slots[i] = { value: factory(), deps };
    return slots[i].value;
  };
  const effectHook = (effect, deps) => {
    const i = cursor++;
    const slot = slots[i];
    if (slot && deps && depsEqual(slot.deps, deps)) return;
    if (!slot) slots[i] = { deps: undefined, cleanup: undefined };
    pending.push({ i, effect, deps });
  };
  const React = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      const slot = slots[i];
      return [slot.value, (next) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(current) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current };
      return slots[i];
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useId: () => ":stale:",
    useEffect: effectHook,
    useLayoutEffect: effectHook,
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { unsubscribe: subscribe(() => { dirty = true; }) };
      return getSnapshot();
    },
    useTransition: () => [false, (callback) => { transitions.push(Promise.resolve().then(callback)); }],
    startTransition: (callback) => callback(),
  };
  function commit() {
    for (let round = 0; round < 25; round += 1) {
      dirty = false;
      cursor = 0;
      pending = [];
      tree = renderComponent();
      for (const { i, effect, deps } of pending) {
        slots[i].cleanup?.();
        slots[i] = { deps, cleanup: effect() ?? undefined };
      }
      if (!dirty) return;
    }
    throw new Error("render loop did not settle");
  }
  return {
    React,
    transitions,
    render(Component, props) { renderComponent = () => Component(props); commit(); return () => tree; },
    /** Lets awaited actions settle, then re-renders while state changed. */
    async flush() {
      for (let round = 0; round < 5; round += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (dirty) commit();
      }
    },
    commitIfDirty() { if (dirty) commit(); },
    unmount() {
      for (const slot of slots) { slot?.cleanup?.(); slot?.unsubscribe?.(); }
      slots = [];
    },
  };
}

function fakeBrowser() {
  const intervals = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const reloads = [];
  let nextId = 1;
  const target = (name) => ({
    addEventListener(type, handler) { const set = listeners[name].get(type) ?? new Set(); set.add(handler); listeners[name].set(type, set); },
    removeEventListener(type, handler) { listeners[name].get(type)?.delete(handler); },
  });
  const window = {
    ...target("window"),
    setInterval(handler, ms) { const id = nextId++; intervals.set(id, { handler, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    location: { reload: () => reloads.push("reload") },
    matchMedia: () => ({ matches: false }),
    innerWidth: 1280,
    innerHeight: 800,
  };
  const document = { ...target("document"), visibilityState: "visible" };
  return {
    window,
    document,
    intervals,
    reloads,
    listenerCount: () => [...listeners.window.values(), ...listeners.document.values()].reduce((sum, set) => sum + set.size, 0),
    /** Every way a poller can wake up: its interval, focus, visibility and network return. */
    wakeAll() {
      for (const { handler } of [...intervals.values()]) handler();
      for (const type of ["focus", "online"]) for (const handler of [...(listeners.window.get(type) ?? [])]) handler();
      for (const handler of [...(listeners.document.get("visibilitychange") ?? [])]) handler();
    },
    install() {
      const previous = { window: globalThis.window, document: globalThis.document };
      globalThis.window = window;
      globalThis.document = document;
      return () => { globalThis.window = previous.window; globalThis.document = previous.document; };
    },
  };
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function compile(path, boundary) {
  const code = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    const replaced = boundary(id);
    if (replaced !== undefined) return replaced;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    throw new Error(`unexpected import ${id} in ${path}`);
  }, compiled, compiled.exports);
  return compiled.exports;
}

function findAll(node, predicate, found = []) {
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, found); return found; }
  if (!node || typeof node !== "object" || !("props" in node)) return found;
  if (predicate(node)) found.push(node);
  findAll(node.props.children, predicate, found);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

/** The shared hooks module as production compiles it, bound to one runtime and one store. */
function sharedFor(runtime, store) {
  const hooks = compile("src/lib/use-stale-deployment.ts", (id) => {
    if (id === "react") return runtime.React;
    if (id === "./stale-deployment.ts") return store;
    return undefined;
  });
  return (id) => {
    if (id === "react") return runtime.React;
    if (id === "@/lib/stale-deployment") return store;
    if (id === "@/lib/use-stale-deployment") return hooks;
    return undefined;
  };
}

/** The shared helper and hooks on one runtime and one fresh store (one page). */
async function staleModules(runtime) {
  const store = await freshStore();
  return { store, shared: sharedFor(runtime, store) };
}

function staffNotifications(runtime, shared, action) {
  const notice = compile("src/components/v3/StaleDeploymentNotice.tsx", shared);
  const component = compile("src/components/v3/StaffNotifications.tsx", (id) => shared(id) ?? ({
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/components/icons": { Icon: () => null },
    "@/components/v3/board/menu-position": { placeMenu: () => ({ top: 0, left: 0, maxHeight: 400 }) },
    "@/lib/v3/staff-notification-actions": {
      loadStaffNotificationsAction: action,
      markAllStaffNotificationsReadAction: async () => ({ ok: true }),
      markStaffNotificationReadAction: async () => ({ ok: true }),
    },
    "@/lib/platform-task-deadline": { dayInOrganizationTimezone: () => "2026-10-10", projectPlatformTaskDeadline: () => ({ day: null, overdue: false }) },
    "@/components/v3/staff-notification-copy": { caseMessageNotificationCopy: () => "Сообщение по делу" },
    "@/components/v3/StaleDeploymentNotice": notice,
  })[id]);
  return { ...component, notice };
}

const PAGE = {
  items: [{ id: "n1", kind: "chat_mention", actorDisplayName: null, createdAt: "2026-10-09T04:35:00Z", readAt: null, href: "/v3/chat" }],
  unreadCount: "1",
  nextCursor: null,
};

test("StaffNotifications stops polling at the first unrecognized action and offers a reload instead of «Нет связи»", async () => {
  const browser = fakeBrowser();
  const restore = browser.install();
  const runtime = createRuntime();
  const noticeRuntime = createRuntime();
  try {
    const { store, shared } = await staleModules(runtime);
    // The notice lives in the shell next to the bell: same page store, own component state.
    const noticeShared = sharedFor(noticeRuntime, store);
    const { notice } = staffNotifications(noticeRuntime, noticeShared, null);
    let calls = 0;
    const action = async () => { calls += 1; throw staleActionError(); };
    const { StaffNotifications } = staffNotifications(runtime, shared, action);
    const view = runtime.render(StaffNotifications, { initialPage: PAGE, onCountChange() {}, triggerProps: {} });
    const shell = noticeRuntime.render(notice.StaleDeploymentNotice, {});

    assert.deepEqual([...browser.intervals.values()].map(({ ms }) => ms), [60000], "the 60 s poller is running");
    assert.equal(browser.listenerCount(), 2, "focus + visibilitychange");
    assert.equal(findAll(shell(), (node) => node.props?.["data-testid"] === "v3-stale-deployment").length, 0, "no prompt before a release");

    browser.wakeAll();
    await runtime.flush();
    noticeRuntime.commitIfDirty();
    assert.equal(calls, 1, "exactly one request reached the new build");
    assert.equal(store.isStaleDeployment(), true);
    assert.equal(browser.intervals.size, 0, "the interval is cleared");
    assert.equal(browser.listenerCount(), 0, "focus/visibility listeners are removed");

    for (let i = 0; i < 5; i += 1) browser.wakeAll();
    await runtime.flush();
    assert.equal(calls, 1, "no more requests after detection");

    // The shell prompt is visible and reloads the page.
    const toast = findAll(shell(), (node) => node.props?.["data-testid"] === "v3-stale-deployment");
    assert.equal(toast.length, 1);
    assert.match(textOf(toast), /Вышла новая версия — обновите страницу/u);
    assert.match(textOf(findAll(shell(), (node) => node.props?.role === "status")), /Вышла новая версия — обновите страницу\./u);
    findAll(toast, (node) => node.type === "button")[0].props.onClick();
    assert.deepEqual(browser.reloads, ["reload"]);

    // Opening the bell does not call the dead action; the panel says the same, not «Нет связи».
    findAll(view(), (node) => node.props?.["aria-controls"] === ":stale:")[0].props.onClick();
    await runtime.flush();
    noticeRuntime.commitIfDirty();
    assert.equal(calls, 1, "opening the panel does not call the action again");
    const panel = findAll(view(), (node) => node.props?.["aria-label"] === "Уведомления сотрудников")[0];
    assert.ok(panel, "the panel is open");
    assert.match(textOf(panel), /Вышла новая версия — обновите страницу/u);
    assert.doesNotMatch(textOf(panel), /Нет связи/u);
    assert.equal(findAll(panel, (node) => node.props?.role === "alert").length, 0);
    assert.equal(panel.props["aria-busy"], false);
    const rows = findAll(panel, (node) => node.type === "button" && /Не прочитано/u.test(textOf(node)));
    assert.ok(rows.length > 0 && rows.every((row) => row.props.disabled === true), "rows cannot fire the dead mark-read action");
    assert.equal(findAll(shell(), (node) => node.props?.["data-testid"] === "v3-stale-deployment").length, 0, "one prompt at a time: the shell line yields to the open panel");
  } finally {
    runtime.unmount();
    noticeRuntime.unmount();
    restore();
  }
});

test("StaffNotifications keeps polling and keeps «Нет связи» for an ordinary network failure", async () => {
  const browser = fakeBrowser();
  const restore = browser.install();
  const runtime = createRuntime();
  try {
    const { store, shared } = await staleModules(runtime);
    let calls = 0;
    const { StaffNotifications } = staffNotifications(runtime, shared, async () => { calls += 1; throw new TypeError("Failed to fetch"); });
    const view = runtime.render(StaffNotifications, { initialPage: PAGE, onCountChange() {}, triggerProps: {} });
    browser.wakeAll();
    await runtime.flush();
    assert.equal(store.isStaleDeployment(), false);
    assert.equal(browser.intervals.size, 1, "polling continues");
    browser.wakeAll();
    await runtime.flush();
    assert.ok(calls >= 2, "the next wake-up tries again");
    findAll(view(), (node) => node.props?.["aria-controls"] === ":stale:")[0].props.onClick();
    await runtime.flush();
    const panel = findAll(view(), (node) => node.props?.["aria-label"] === "Уведомления сотрудников")[0];
    assert.match(textOf(panel), /Нет связи\. Повторите загрузку уведомлений\./u);
  } finally {
    runtime.unmount();
    restore();
  }
});

test("the student portal notification poller stops on a stale action and the shell asks to reload in RU and KY", async () => {
  const browser = fakeBrowser();
  const restore = browser.install();
  const runtime = createRuntime();
  const noticeRuntime = createRuntime();
  try {
    const { store, shared } = await staleModules(runtime);
    let calls = 0;
    const refreshes = [];
    const { PortalNotificationUpdates } = compile("src/components/portal/PortalNotificationUpdates.tsx", (id) => shared(id) ?? ({
      "next/link": { default: () => null },
      "next/navigation": { usePathname: () => "/portal/documents", useRouter: () => ({ refresh: () => refreshes.push("refresh") }) },
      "@/lib/portal/i18n": portalI18n,
      "@/lib/student-portal-notification-updates": { loadStudentPortalNotificationState: async () => { calls += 1; throw staleActionError(); } },
    })[id]);
    const view = runtime.render(PortalNotificationUpdates, { locale: "ru" });
    await runtime.flush();
    assert.equal(calls, 1, "the entry read hit the new build once");
    assert.equal(store.isStaleDeployment(), true);
    assert.equal(browser.intervals.size, 0, "the 30 s poller is cleared");
    assert.equal(browser.listenerCount(), 0, "visibility/focus/online listeners are removed");
    for (let i = 0; i < 5; i += 1) browser.wakeAll();
    await runtime.flush();
    assert.equal(calls, 1, "no more requests after detection");
    assert.deepEqual(refreshes, []);
    assert.equal(textOf(view()).includes(portalI18n.getPortalStrings("shell", "ru").notificationsFailed), false);

    const noticeShared = sharedFor(noticeRuntime, store);
    const { PortalStaleDeploymentNotice } = compile("src/components/portal/PortalStaleDeploymentNotice.tsx", noticeShared);
    for (const [locale, expected] of [["ru", /Вышла новая версия — обновите страницу\.Обновить страницу/u], ["ky", /Жаңы версия чыкты — баракты жаңыртыңыз\.Баракты жаңыртуу/u]]) {
      const shell = noticeRuntime.render(PortalStaleDeploymentNotice, { strings: portalI18n.getPortalStrings("shell", locale) });
      const card = findAll(shell(), (node) => node.props?.["data-testid"] === "portal-stale-deployment");
      assert.match(textOf(card), expected);
      findAll(card, (node) => node.type === "button")[0].props.onClick();
    }
    assert.deepEqual(browser.reloads, ["reload", "reload"]);
  } finally {
    runtime.unmount();
    noticeRuntime.unmount();
    restore();
  }
});

function messagesThread(runtime, shared, actions) {
  return compile("src/components/portal/messages/MessagesThread.tsx", (id) => shared(id) ?? ({
    "@/lib/portal/messages": {
      PORTAL_CASE_MESSAGE_BODY_LIMIT: 2000,
      mergePortalCaseMessages: (existing, incoming) => [...existing, ...incoming],
    },
    "@/lib/portal/messages-actions": actions,
    "@/lib/portal/i18n": portalI18n,
  })[id]);
}

const THREAD = { messages: [], awaitState: "needs_reply", hasMore: false, cursor: null };

test("the portal case chat stops polling on a stale action and keeps the student's draft", async () => {
  const browser = fakeBrowser();
  const restore = browser.install();
  const runtime = createRuntime();
  try {
    const { store, shared } = await staleModules(runtime);
    const calls = { load: 0, send: 0 };
    const { MessagesThread } = messagesThread(runtime, shared, {
      loadPortalCaseMessagesAction: async () => { calls.load += 1; return { ok: true, page: THREAD }; },
      sendPortalCaseMessageAction: async () => { calls.send += 1; throw staleActionError(); },
    });
    const strings = portalI18n.getPortalStrings("messages", "ru");
    const view = runtime.render(MessagesThread, { initialPage: THREAD, strings, locale: "ru" });
    assert.equal(browser.intervals.size, 1, "the 30 s poller is running");

    findAll(view(), (node) => node.type === "textarea")[0].props.onChange({ target: { value: "Документы отправил" } });
    runtime.commitIfDirty();
    findAll(view(), (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
    await Promise.all(runtime.transitions); // a rejection here would reach the error boundary and drop the draft
    await runtime.flush();

    assert.equal(calls.send, 1);
    assert.equal(store.isStaleDeployment(), true);
    assert.equal(findAll(view(), (node) => node.type === "textarea")[0].props.value, "Документы отправил", "the draft stays on screen");
    assert.equal(textOf(view()).includes(strings.sendError), false);
    const submit = findAll(view(), (node) => node.type === "button" && node.props.type === "submit")[0];
    assert.equal(submit.props.disabled, true, "the dead send action cannot be fired again");
    assert.equal(browser.intervals.size, 0, "polling stopped");
    assert.equal(browser.listenerCount(), 0);
    const before = calls.load;
    for (let i = 0; i < 5; i += 1) browser.wakeAll();
    await runtime.flush();
    assert.equal(calls.load, before, "no more refresh requests");
  } finally {
    runtime.unmount();
    restore();
  }
});

test("the portal case chat refresh poller stops at the first stale refresh without showing a refresh error", async () => {
  const browser = fakeBrowser();
  const restore = browser.install();
  const runtime = createRuntime();
  try {
    const { shared } = await staleModules(runtime);
    let calls = 0;
    const { MessagesThread } = messagesThread(runtime, shared, {
      loadPortalCaseMessagesAction: async () => { calls += 1; throw staleActionError(); },
      sendPortalCaseMessageAction: async () => ({ ok: true }),
    });
    const strings = portalI18n.getPortalStrings("messages", "ru");
    const view = runtime.render(MessagesThread, { initialPage: THREAD, strings, locale: "ru" });
    browser.wakeAll();
    await runtime.flush();
    for (let i = 0; i < 5; i += 1) browser.wakeAll();
    await runtime.flush();
    assert.equal(calls, 1);
    assert.equal(browser.intervals.size, 0);
    assert.equal(textOf(view()).includes(strings.refreshError), false);
  } finally {
    runtime.unmount();
    restore();
  }
});

test("error boundaries reload instead of reset() for a stale action and keep reset() otherwise", async () => {
  for (const path of ["src/app/(v3)/error.tsx", "src/app/(portal)/portal/error.tsx", "src/app/(portal)/portal/tests/error.tsx", "src/app/apply/error.tsx"]) {
    const browser = fakeBrowser();
    const restore = browser.install();
    const runtime = createRuntime();
    try {
      const { store, shared } = await staleModules(runtime);
      const Boundary = compile(path, (id) => shared(id) ?? ({
        "next/link": { default: () => null },
        "@/lib/v3/wording": { chromeWords: { error: { eyebrow: "e", title: "t", staffText: "s", retry: "Попробовать снова", staffAction: "a", staleEyebrow: "Вышла новая версия", staleTitle: "Обновите страницу", staleText: "x", staleAction: "Обновить страницу" } } },
      })[id]).default;
      const resets = [];
      const reset = () => resets.push("reset");

      const ordinary = runtime.render(Boundary, { error: new Error("boom"), reset });
      findAll(ordinary(), (node) => node.type === "button")[0].props.onClick();
      assert.deepEqual([resets, browser.reloads], [["reset"], []], `${path}: ordinary errors keep reset()`);
      assert.equal(store.isStaleDeployment(), false);
      runtime.unmount();

      const staleRuntime = createRuntime();
      const { store: staleStore, shared: staleShared } = await staleModules(staleRuntime);
      const StaleBoundary = compile(path, (id) => staleShared(id) ?? ({
        "next/link": { default: () => null },
        "@/lib/v3/wording": { chromeWords: { error: { eyebrow: "e", title: "t", staffText: "s", retry: "Попробовать снова", staffAction: "a", staleEyebrow: "Вышла новая версия", staleTitle: "Обновите страницу", staleText: "x", staleAction: "Обновить страницу" } } },
      })[id]).default;
      const stale = staleRuntime.render(StaleBoundary, { error: staleActionError(), reset });
      assert.match(textOf(stale()), /Вышла новая версия/u, path);
      const button = findAll(stale(), (node) => node.type === "button")[0];
      assert.match(textOf(button), /Обновить страницу/u, path);
      button.props.onClick();
      assert.deepEqual([resets, browser.reloads], [["reset"], ["reload"]], `${path}: a stale action reloads`);
      if (!path.startsWith("src/app/apply/")) {
        assert.equal(staleStore.isStaleDeployment(), true, `${path}: shell pollers are told to stop`);
        assert.equal(staleStore.shouldShowStaleDeploymentNotice(), false, `${path}: the shell line yields to the boundary's own prompt`);
      }
      staleRuntime.unmount();
      if (!path.startsWith("src/app/apply/")) assert.equal(staleStore.shouldShowStaleDeploymentNotice(), true, `${path}: unmounting releases the inline prompt`);
    } finally {
      runtime.unmount();
      restore();
    }
  }
});

test("next.config hides the X-Powered-By header (A4)", () => {
  assert.match(source("next.config.ts"), /^\s*poweredByHeader: false,$/mu);
});
