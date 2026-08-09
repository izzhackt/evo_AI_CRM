# EVO Platform ТЗ — журнал валидации

Дата проверки: 09.08.2026

Timezone: `Asia/Bishkek`

Базовый `origin/main`: `8dbc99c578a9bad0750a04cb322f26a2fe68b1c0`

Exact-main CI: `31310795550` — все четыре job зелёные.

Миграции на базовом main: `001–059`.

Block-ID: `EVO-MVP-AUTONOMOUS-INBOUND-PLAN-2026-08-09`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

## 1. Проверенная граница

Версия `2.3` сохраняет greenfield Supabase-native Platform и принятый Claude
Design frontend как единственный UI-контракт. Legacy/root SQLite CRM остаётся
отдельной системой: её данные не импортируются, root auth не переносится,
SQLite shim, dual-read/dual-write, parallel frontend и silent fallback
запрещены.

P5A receive-only WAHA ingress уже merged. P5B остаётся отдельным
disabled-by-default receive/project worker: verified inbound событие проецируется
в существующие Supabase conversations/messages, а raw WAHA identifiers остаются
private. P5B не выполняет provider send и не является autonomous-reply lane.
Перед продолжением P5B media-only inbound должен сохраняться, становиться
operator-visible и создавать handoff, а не завершаться как terminal no-op.

Следующие P5 блоки последовательно добавляют available WAHA history, private
media, ACK/unknown, Supabase Realtime с reconnect/catch-up, Platform memory,
approved pgvector retrieval и real Gemini structured proposal. Owner разрешил
автономный ответ только как recent inbound reply внутри rolling 24-hour service
window. Gemini не вызывает WAHA и не получает право send: deterministic server
policy повторно проверяет organization/session, consent/opt-out, language,
approved evidence, risk/confidence, business hours, cooldown/rate, takeover,
idempotency, WAHA `WORKING`, kill switch и policy version. Любой failed gate
создаёт durable human handoff без provider send. Cold outbound, broadcast,
campaign, follow-up/re-engagement и out-of-window free-form исключены.

P4B mapping activation и amoCRM writes сохранены и отложены на branch
`izzhackt/evo-platform-p4b-mapping-approval` в checkpoint
`e53ba94954f147b295f596421a255591fa343ce8`. Его failed Auth/PostgREST run —
`failed/non-evidence`. Отдельный bounded P4R может читать account-specific
contact, lead, responsible Sales, sales stage, tasks и call/chat-record
references. Он не создаёт и не изменяет amoCRM records, не активирует mapping и
не выводит canonical handoff.

P9 удалён из execution scope. EVO Lead Agent, legacy webhook/session и rollback
path остаются deployed/frozen; их deactivation, retirement или deletion не
выполняются. P8 принимает только реально доказанный controlled path, а P10
аудирует verified, blocked и deferred отдельно и не объявляет полный исходный
Platform target завершённым.

Автоматизация Student Profile document reading/autofill остаётся отдельной
системой вне `evo_AI_CRM` без подразумеваемого runtime или data exchange.

Этот amendment меняет только authority-документацию, исследования, verifier и
детерминированный DOCX. Он не меняет приложение, migrations, Supabase runtime,
amoCRM, WAHA, Gemini, production или реальные данные.

## 2. Воспроизводимая сборка

DOCX собирается только из канонического Markdown. Использован bundled Python:

```bash
/Users/iskhak.tazhibaev/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/generate-evo-platform-tz.py
```

Полная повторная сборка, структурная проверка, accessibility audit и реальный
LibreOffice/Poppler render выполнены командой:

```bash
render_dir="$(mktemp -d /private/tmp/evo-platform-tz-v2.3-final.XXXXXX)"
/Users/iskhak.tazhibaev/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/verify-evo-platform-tz.py --render-dir "$render_dir"
```

Закреплённая document-зависимость: `python-docx==1.2.0` в
`scripts/requirements-evo-platform-tz.txt`.

Финальный автоматический результат:

- Python: `3.12.13`;
- `python-docx`: `1.2.0`;
- source SHA-256:
  `06051a9a10202d24198aedac0f1a22437458514bd1c00dad3b8dfb387aec067a`;
- DOCX SHA-256:
  `3d70b790239f393bc4c55cda9f949ff1e241b706c78465697f3a86257f3fca99`;
- две независимые сборки DOCX: bit-for-bit одинаковы;
- requirements: `231`;
- traceability rows: `231`;
- source codes: `14`;
- paragraphs: `604`;
- tables: `31`;
- inline shapes: `7` (`6` design screenshots + `1` logo);
- drawing objects with alt text: `7`;
- external hyperlinks: `17`;
- accessibility findings: `high=0`, `medium=0`, `low=0`;
- render: `70` PDF/PNG pages.

Автоматический итог verifier: `PASS requirements=231 traceability=231 pages=70
a11y=0/0/0`.

Отдельный render через bundled Documents runtime также успешно создал `70` PNG
страниц и единый PDF. Оба render-набора были временными локальными artifacts и
не коммитились.

## 3. Визуальная проверка

Все `70 / 70` страниц финального render просмотрены вручную. Проверены обложка,
TOC placeholder, длинные таблицы, callout-блоки, screenshots, traceability и
signoff. Страница `2` содержит намеренный Word TOC placeholder, который
обновляется при открытии в Word.

Clipping, overflow, пропавший content, повреждённые glyphs и raster corruption
не обнаружены. Таблицы не выходят за поля, headings и footer/page numbering
последовательны, все screenshots читаемы и имеют поясняющий caption.

Итог ручной проверки: `PASS`.

## 4. Traceability и authority

- `docs/specs/EVO_PLATFORM_TZ.md` — единственный канонический источник DOCX;
- ADR 0019 задаёт guarded autonomous inbound reply, read-mostly amoCRM и
  retained-service boundary;
- ADR 0018 сохраняет историческую execution-order/retained-service boundary там,
  где её не supersede ADR 0019;
- `docs/PLAN_CHANGES.md` сохраняет append-only историю решения;
- ADR 0017 сохраняет отдельную boundary Student Profile document automation;
- оригинальный `TZ_Platforma_avtomatizacii_OZO.docx` остаётся контекстом, а не
  authority;
- owner roles указываются должностями, не персональными ФИО;
- требования и traceability имеют взаимно однозначное покрытие `231 / 231`.

## 5. Граница доказательства

Для этого docs-only блока `real-provider-proof: not-required`.

Проверка доказывает только актуальность execution contract, целостность,
воспроизводимость, traceability, структурную доступность и визуальную
корректность ТЗ версии `2.3`. Она не доказывает:

- live amoCRM OAuth, account mappings, P4R reads, P4B activation или writes;
- live WAHA history/backfill, media, ACK, Realtime, receive или send;
- live Gemini structured proposal, pgvector retrieval или autonomous reply;
- live RLS/Auth/Storage, backup/restore или production deployment;
- controlled real P5–P8 evidence window, cutover или rollback;
- amoCRM contract-stage/handoff segment исходного full E2E;
- какую-либо интеграцию с отдельной системой обработки документов;
- право deactivation/retirement/deletion Lead Agent или legacy path.

Эти внешние gates остаются `DEFERRED`, `PENDING` или `BLOCKED` до
соответствующего reviewed implementation block, разрешённого provider access,
credentials, sanitized test identity/number, production authority и
фактического controlled evidence.
