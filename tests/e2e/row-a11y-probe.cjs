"use strict";

/**
 * Дерево доступности Chromium (CDP `Accessibility.getFullAXTree`) для строк таблицы «Нового вида». Проверяется то,
 * что axe в этой связке не ловит:
 *  - строка (`role=row`) не принимает фокус: с клавиатуры запись открывает кнопка или ссылка внутри строки;
 *  - каждый фокусируемый элемент внутри строки имеет роль и непустое имя (WCAG 4.1.2).
 * Возвращает список нарушений (пустой — всё в порядке). Скрытые копии (карточки телефона при таблице) в дерево не попадают.
 */
async function rowA11yProblems(page) {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const parent = new Map();
    for (const node of nodes) for (const child of node.childIds ?? []) parent.set(child, node.nodeId);
    const prop = (node, name) => node.properties?.find((entry) => entry.name === name)?.value?.value;
    const insideRow = (node) => {
      for (let id = parent.get(node.nodeId); id; id = parent.get(id)) if (byId.get(id)?.role?.value === "row") return true;
      return false;
    };
    const problems = [];
    let rows = 0;
    let controls = 0;
    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value;
      const name = (node.name?.value ?? "").trim();
      if (role === "row") {
        rows += 1;
        if (prop(node, "focusable")) problems.push({ problem: "row takes focus", name });
      } else if (prop(node, "focusable") && insideRow(node)) {
        controls += 1;
        if (!role || role === "none" || role === "generic") problems.push({ problem: "focusable element in a row has no role", name });
        if (!name) problems.push({ problem: "focusable element in a row has no name", role });
      }
    }
    return { problems, rows, controls };
  } finally {
    await client.detach();
  }
}

module.exports = { rowA11yProblems };
