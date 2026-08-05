# EVO Platform ТЗ — журнал валидации

Дата проверки: 05.08.2026

Timezone: `Asia/Almaty`

Базовый `origin/main`: `4567ef5067c523604bee73e8730f1b54ac23487d`

Block-ID: `EVO-BW8-BOUNDARY-CORRECTION-P4B-RESTORE-2026-08-05`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

## 1. Проверенная граница

PR #119 остаётся историческим решением, но его попытка включить в EVO Platform
чтение документов, извлечение фактов, автозаполнение Student Profile и экспорт
заполненных форм отменена текущим superseding amendment. PR #124, #122 и #120
последовательно отменены через PR #125, #126 и #127. Их итоговый `main`
`4567ef5067c523604bee73e8730f1b54ac23487d` имеет дерево до PR #120, migrations
`001–058`; exact-main CI run `30989252650` завершён успешно.

Автоматизация чтения и заполнения документов является отдельной системой вне
`evo_AI_CRM`. Между ней и EVO Platform нет автоматического обмена данными,
общей БД, общей auth-сессии или runtime dependency. Будущая интеграция требует
отдельного plan amendment, data mapping, privacy/consent решения, авторизации,
валидации и acceptance evidence.

EVO Platform сохраняет обычный документный lifecycle: private upload/download,
версионирование, checklist, review/rework, integrity/malware policy и audit.
Следующий Platform implementation gate снова P4B: immutable выбор одобренной
версии P4A amoCRM discovery. Ожидаемый следующий номер migration — `059`, но он
не резервируется и должен быть подтверждён на свежем `main` перед реализацией.

Этот amendment изменяет только документацию, детерминированный DOCX и его
верификатор. Он не меняет приложение, runtime, migrations, Supabase, amoCRM,
WAHA, AI provider, production или реальные данные.

## 2. Воспроизводимая сборка

DOCX собирается только из канонического Markdown:

```bash
python scripts/generate-evo-platform-tz.py
```

Полная повторная сборка, структурная проверка, accessibility audit и реальный
LibreOffice/Poppler render выполняются командой:

```bash
render_dir="$(mktemp -d /private/tmp/evo-platform-tz-boundary.XXXXXX)"
python scripts/verify-evo-platform-tz.py --render-dir "$render_dir"
```

Закреплённая document-зависимость: `python-docx==1.2.0` в
`scripts/requirements-evo-platform-tz.txt`.

Финальный автоматический результат:

- Python: `3.12.13`;
- `python-docx`: `1.2.0`;
- source SHA-256:
  `85a8843b24e6786d533b8804e11767afc799f0ab6987e69f7d5fee0533492fd6`;
- DOCX SHA-256:
  `81665effd4b2b2547ee169aaed996d72f36125005c482909950955c11048a212`;
- две последовательные сборки побайтно совпали;
- requirements: `231`;
- traceability rows: `231`;
- source codes: `14`;
- design-evidence images: `6`;
- official external links: `8`;
- DOCX structure: `602` paragraphs, `31` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- accessibility audit: `0 high / 0 medium / 0 low`;
- LibreOffice → PDF → Poppler PNG: `68` страниц и `68` PNG.

Requirement coverage:

| Семейство | Количество |
|---|---:|
| `FR` | 110 |
| `INT` | 20 |
| `DATA` | 18 |
| `SEC` | 20 |
| `NFR` | 18 |
| `ACC` | 25 |
| `DEC` | 20 |
| Всего | 231 |

Удалённые PR119-only семейства отсутствуют в активном ТЗ:
`FR-111..119`, `INT-021..024`, `DATA-019..024`, `SEC-021..026`,
`NFR-019..022`, `ACC-026..034`.

## 3. Визуальная проверка

Все страницы `1–68` проверены по PNG из реального LibreOffice render в
оригинальном разрешении. Cover, headers, footers, нумерация, таблицы,
traceability, screenshots и signoff pages отображаются полностью. Страница `2`
содержит намеренный Word TOC placeholder, который обновляется при открытии в
Word.

Из-за визуального масштабирования при пакетном просмотре страницы `26`, `40`,
`52`, `54`, `62`, `64` и `66` были повторно открыты по одной в оригинальном
разрешении. Фактических обрезаний или наложений не обнаружено. Clipping,
overflow, пропавший content, повреждённые glyphs и raster corruption отсутствуют.

Итог ручной проверки: `PASS`.

## 4. Traceability и authority

- `docs/specs/EVO_PLATFORM_TZ.md` — единственный канонический источник DOCX;
- `docs/adr/0017-separate-student-profile-document-automation-from-evo-platform.md`
  supersede-ит PR119/BW8 boundary;
- `docs/PLAN_CHANGES.md` сохраняет append-only историю и новую коррекцию;
- оригинальный `TZ_Platforma_avtomatizacii_OZO.docx` остаётся только контекстом,
  а не authority;
- owner roles указываются должностями, не персональными ФИО;
- требования и traceability имеют взаимно однозначное покрытие `231 / 231`.

## 5. Граница доказательства

Для этого docs-only блока `real-provider-proof: not-required`.

Проверка доказывает только актуальность boundary, целостность,
воспроизводимость, traceability, структурную доступность и визуальную
корректность ТЗ версии `2.1`. Она не доказывает:

- P4B implementation, migration `059` или managed Supabase behavior;
- live RLS/Auth/Storage, backup/restore или production deployment;
- live amoCRM discovery, account mappings, OAuth, webhook или provider writes;
- live WAHA, AI draft, manual send или ACK/audit;
- controlled real E2E, reconciliation window, cutover или rollback;
- какую-либо интеграцию с отдельной системой обработки документов.

Эти gates остаются `PENDING` или `BLOCKED` до отдельных reviewed blocks,
разрешённого provider access, credentials, sanitized test identity/number,
production authority и фактического controlled evidence.
