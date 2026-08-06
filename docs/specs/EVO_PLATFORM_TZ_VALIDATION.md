# EVO Platform ТЗ — журнал валидации

Дата проверки: 06.08.2026

Timezone: `Asia/Almaty`

Базовый `origin/main`: `4d28b7f49d791a78dc387c6f6a16681dd3cf3df8`

Block-ID: `EVO-P5-AMO-DEFERRAL-SCOPE-AMENDMENT-2026-08-06`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

## 1. Проверенная граница

P4/P4B сохранён и отложен до отдельного owner decision. Незавершённая
реализация находится на remote branch
`izzhackt/evo-platform-p4b-mapping-approval` в checkpoint
`e53ba94954f147b295f596421a255591fa343ce8`; implementation PR отсутствует.
Focused repository checks прошли, но full local Supabase gate завершился
fail-closed в real Auth/PostgREST hook до Playwright. Этот запуск является
`failed/non-evidence` и не доказывает mapping approval или live amoCRM.

Текущий порядок исполнения: `P5 -> P6 -> P7 -> P8 -> P10`. P5–P8 могут
реализовывать только amoCRM-independent capability. AmoCRM identity resolution,
canonical sales stage/responsible Sales, mapping approval, contract-stage
handoff и amoCRM segment исходного E2E остаются fail-closed и `DEFERRED` вместе
с P4. Mock, SQLite shim, hardcoded amo mapping, fake provider и silent fallback
запрещены.

P9 удалён из текущего execution scope. Lead Agent, legacy webhook/session и
rollback path остаются deployed/frozen; их deactivation, retirement или deletion
не выполняются. P8 принимает только реально исполнимый P5–P7 controlled path,
а P10 аудирует только авторизованный scope и не объявляет полный исходный
Platform target завершённым.

Автоматизация чтения/извлечения данных из документов и автозаполнения Student
Profile остаётся отдельной системой вне `evo_AI_CRM` без подразумеваемого обмена
данными или runtime dependency.

Этот amendment изменяет только authority-документацию и детерминированный DOCX.
Он не меняет приложение, migrations, Supabase runtime, amoCRM, WAHA, AI
provider, production или реальные данные.

## 2. Воспроизводимая сборка

DOCX собирается только из канонического Markdown:

```bash
python scripts/generate-evo-platform-tz.py
```

Полная повторная сборка, структурная проверка, accessibility audit и реальный
LibreOffice/Poppler render выполняются командой:

```bash
render_dir="$(mktemp -d /private/tmp/evo-platform-tz-p5-final.XXXXXX)"
python scripts/verify-evo-platform-tz.py --render-dir "$render_dir"
```

Закреплённая document-зависимость: `python-docx==1.2.0` в
`scripts/requirements-evo-platform-tz.txt`.

Финальный автоматический результат:

- Python: `3.12.13`;
- `python-docx`: `1.2.0`;
- source SHA-256:
  `de506d0dc7aa5a2ecefc4f3df93d73524697f704290fcef13ea60904b20eaa33`;
- DOCX SHA-256:
  `a2b235cc360c88f1259e9d1943f2291f5b01e100956fdcba7b8c2043b1995e72`;
- две независимые сборки DOCX: bit-for-bit одинаковы;
- requirements: `231`;
- traceability rows: `231`;
- source codes: `14`;
- paragraphs: `592`;
- tables: `31`;
- inline shapes: `7` (`6` design screenshots + `1` logo);
- drawing objects with alt text: `7`;
- external hyperlinks: `8`;
- accessibility findings: `high=0`, `medium=0`, `low=0`;
- render: `68` PDF/PNG pages.

Автоматический итог verifier: `PASS requirements=231 traceability=231 pages=68
a11y=0/0/0`.

## 3. Визуальная проверка

Все `68 / 68` страницы финального render просмотрены вручную. Проверены обложка,
TOC placeholder, длинные таблицы, callout-блоки, screenshots, traceability и
signoff. Страница `2` содержит намеренный Word TOC placeholder, который
обновляется при открытии в Word.

Из-за масштабирования пакетного предпросмотра страницы `26`, `40`, `52`, `54`,
`62`, `64` и `66` перепроверены в исходном разрешении. Для continuation pages
traceability-таблицы дополнительно выполнены PDF text extraction и OCR-проверка:
полные ID/source prefixes присутствуют в финальных пикселях и PDF text layer.
Clipping, overflow, пропавший content, повреждённые glyphs и raster corruption
не обнаружены.

Итог ручной проверки: `PASS`.

## 4. Traceability и authority

- `docs/specs/EVO_PLATFORM_TZ.md` — единственный канонический источник DOCX;
- ADR 0018 задаёт текущую execution-order/retained-service boundary;
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
корректность ТЗ версии `2.2`. Она не доказывает:

- успешный P4B Auth/PostgREST/Playwright gate или live amoCRM mapping;
- live RLS/Auth/Storage, backup/restore или production deployment;
- live WAHA receive/send, AI draft, manual send или ACK/audit;
- controlled real P5–P8 evidence window, cutover или rollback;
- amoCRM identity/stage/handoff segment исходного full E2E;
- какую-либо интеграцию с отдельной системой обработки документов;
- право deactivation/retirement/deletion Lead Agent или legacy path.

Эти внешние gates остаются `DEFERRED`, `PENDING` или `BLOCKED` до
соответствующего reviewed block, разрешённого provider access, credentials,
sanitized test identity/number, production authority и фактического controlled
evidence.
