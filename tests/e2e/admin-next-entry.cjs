"use strict";

/**
 * Браузерная точка входа стенда `admin-next-static-render.cjs`: настоящие компоненты «Нового вида» («Настройки», «Маркетинг», «Финансы», «ИИ-агент»)
 * внутри настоящей оболочки (`AppShell`) на свойствах, которые отдаёт НАСТОЯЩАЯ страница на синтетике (`admin-next-pages.cjs capture`).
 * Адрес стенда — состояние: `router.push` записывается и, если для адреса есть ответ сервера (`fx.routes`), через 60 мс подменяет свойства (так
 * открывается запрос на удаление). Серверные действия подменены (`window.__harness.calls` пишет вызов и поля формы). Прежний вид («до») — настоящая
 * разметка прежней страницы, отданная сервером (`fx.legacyHtml`) внутри той же оболочки.
 */
const CLIENT_ENTRY = String.raw`
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { SettingsNextPage } = require("@/components/v3/settings-next/SettingsNextPage");
const { MarketingNextPage } = require("@/components/v3/marketing-next/MarketingNextPage");
const { FinanceNextPage } = require("@/components/v3/finance-next/FinanceNextPage");
const { AiAgentNextPage } = require("@/components/v3/ai-agent-next/AiAgentNextPage");
const h = React.createElement;
const fx = JSON.parse(document.getElementById("fixture").textContent);
window.__harness = { pushes: [], replaces: [], calls: [], errors: [], history: [fx.search], delay: 60, token: 0, moreRows: fx.moreRows || [] };
// Страница стенда открыта по протоколу file, а history.replaceState с адресом /v3/… там запрещён: записываем вызов (как router.replace), адрес не меняем.
window.history.replaceState = (_state, _title, url) => { window.__harness.replaces.push(String(url)); };
const SCREENS = { settings: SettingsNextPage, marketing: MarketingNextPage, finance: FinanceNextPage, ai: AiAgentNextPage };

function App() {
  const [view, setView] = React.useState({ props: fx.props, search: fx.search });
  const router = React.useMemo(() => ({
    push(href) {
      window.__harness.pushes.push(href);
      const next = fx.routes[href];
      const token = (window.__harness.token += 1);
      if (!next) return;
      setTimeout(() => { if (token === window.__harness.token) setView({ props: next.props, search: next.search }); }, window.__harness.delay);
    },
    replace(href) { window.__harness.replaces.push(href); }, back() {}, forward() {}, refresh() { window.__harness.calls.push("refresh"); }, prefetch() {}, hmrRefresh() {},
  }), []);
  const Screen = SCREENS[fx.screen];
  const body = fx.legacyHtml !== null
    ? h("div", { dangerouslySetInnerHTML: { __html: fx.legacyHtml } })
    : h(Screen, view.props);
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fx.pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(view.search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", fx.legacyHtml !== null ? { className: "v3-world", "data-surface": "staff" } : { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
            h(AppShell, { actor: fx.actor, initialNotifications: null, nextUi: { enabled: fx.legacyHtml === null } }, body))))));
}
createRoot(document.getElementById("root")).render(h(App));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

module.exports = { CLIENT_ENTRY };
