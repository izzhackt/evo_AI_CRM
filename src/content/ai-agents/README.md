# Тексты и инструменты агентов

Одна папка на агента (`<key>` из `AI_AGENT_KEYS` в `src/lib/ai-agents/contract.ts`):

```
<key>/
  role.md      frontmatter (key, schedule_prompt) + кто он, цель, тон
  rules.md     регламент: порядок работы, правила и границы
  tools.json   { "tools": ["имя", ...] } — инструменты агента
  examples/    эталонные диалоги (в инструкцию не попадают)
_shared/preamble.md   общая преамбула всех агентов
```

Инструкция агента = `role.md` + `rules.md` (разрез по границе раздела, без потерь).
`prompts.generated.ts` и `tool-grants.generated.ts` собирает
`node scripts/maintenance/build-ai-agent-prompts.mjs` (проверка: `--check`). Руками их не правят.

## Как добавить инструмент

1. Объявите его в `src/lib/ai-agents/contract.ts` (`AI_AGENT_TOOL_NAMES` и `AI_AGENT_TOOLS`)
   и реализуйте функцию в базе.
2. Допишите имя в `tools.json` тех агентов, которым он нужен. Остальные агенты его не увидят:
   MCP-сервер не показывает им инструмент в `tools/list`, а вызов отклоняет кодом `forbidden`.
3. Запустите генератор и закоммитьте результат. `get_my_settings` разрешён всем всегда.

Изменение `tools.json` не меняет текст инструкции и хеш конфигурации агента в Claude.
