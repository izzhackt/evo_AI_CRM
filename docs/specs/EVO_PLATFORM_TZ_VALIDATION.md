# EVO Platform ТЗ — журнал валидации

Дата проверки: 03.08.2026

Timezone: `Asia/Almaty`

Base commit до docs-only amendment:
`db8f3c75c898d5b68b0080099583d4eeea9931d2`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: docs-only plan amendment фиксирует результат независимого
controller-аудита PR #108. Реализация была закрыта без merge: её plan-order был
неправильным, а свежий real local reset из физического worktree завершился с
ненулевым кодом. P2R2 становится единственным активным repair gate: server auth
обязан проверять точный access token, возвращённый login, через
`getClaims(accessToken)`, затем live authority/RLS; deadline helper обязан
работать одинаково из logical и physical paths и передавать реальный exit code;
полный local Auth/PostgREST/RLS/browser/Storage/PGMQ gate обязан завершиться
нулём с exact-project cleanup. BW5 временно приостановлен до merge P2R2 и
зелёного exact-main CI.

Этот amendment не содержит product/runtime code или migration, не запускает
Supabase/Notion/college provider, не применяет remote schema и не мутирует
production. Он разрешает только отдельный P2R2 implementation PR с новым
exact-head review и controller gate; P2R2 сам не доказывает managed Supabase,
provider behavior, backup/restore или production.

## 1. Воспроизводимая сборка

DOCX собирается только из канонического Markdown:

```bash
python scripts/generate-evo-platform-tz.py
```

Полная сборка, повторная сборка, структура, accessibility и реальный
LibreOffice/Poppler render проверяются командой:

```bash
render_dir="$(mktemp -d /private/tmp/evo-platform-tz-render.XXXXXX)"
python scripts/verify-evo-platform-tz.py --render-dir "$render_dir"
```

Закреплённая document-зависимость:
`python-docx==1.2.0` в `scripts/requirements-evo-platform-tz.txt`.

Финальный прогон:

- Python: `3.12.13`;
- `python-docx`: `1.2.0`;
- requirements: `231`;
- поэлементные traceability rows: `231`;
- source codes: `14`;
- design-evidence images: `6`;
- official external links: `8`;
- DOCX structure: `598` paragraphs, `31` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- две последовательные сборки DOCX побайтно совпали;
- LibreOffice → PDF → Poppler PNG: `68` страниц;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=231 traceability=231 pages=68 a11y=0/0/0`.

Machine-readable evidence финального clean rerun находится во временном
каталоге:
`/private/tmp/evo-platform-tz-render-p2r2-final.vlyKMO`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-68.png`.

Временные PDF/PNG и contact sheets не коммитятся. Markdown, generator,
verifier и закреплённая зависимость позволяют воспроизвести evidence.
Все `68` PNG финального clean rerun побайтно совпали с полностью просмотренным
render (`0` mismatches).

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `143487` bytes | `0f18e9c502cbe36a2fc2b7ea4587dbdc30a6cad60d3faa06ab93e064d8513f09` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1785817` bytes | `6b2d6a5e52c9662132b2d164df7b49deaf61e845bfdd418b4e749288ea3dceab` |
| `scripts/generate-evo-platform-tz.py` | `39198` bytes | `ebd0d431ca456fc42492d3e5ab815bde4bc980d295f8db01ffa7ced63b9eb14f` |
| `scripts/verify-evo-platform-tz.py` | `15754` bytes | `b4228980f03a9add719fd0c2c22dc09917c36121774d3fb6160b14c365c5fd40` |
| `scripts/requirements-evo-platform-tz.txt` | `152` bytes | `b93132cee8981930f04871f997ac539e7b718a3ca95d97c8536651e374fa4677` |

`validation.json` подтверждает одинаковый DOCX SHA-256 для первой и второй
сборки.

## 3. Автоматические проверки

Verifier проверяет:

- полноту и уникальность FR/INT/DATA/SEC/NFR/ACC identifiers;
- точное соответствие `231` requirements и `231` provenance rows;
- наличие всех `14` source codes;
- локальные изображения, alt text и hyperlinks;
- отсутствие незаполненных шаблонных полей;
- deterministic DOCX rebuild;
- открытие DOCX библиотекой `python-docx`;
- реальный PDF render и отдельный PNG каждой страницы;
- accessibility findings.

Финальная machine-readable проверка завершилась `PASS`; source и две
последовательные DOCX-сборки имеют зафиксированные выше SHA-256.

## 4. Ручная визуальная проверка

Все страницы `1–68` проверены в PNG через `9` bordered 2×4 contact sheets,
сохраняющих серое внешнее поле и все четыре края каждой
страницы:

- cover, headers, footers и последовательность page numbers корректны;
- страница `2` содержит намеренный Word TOC placeholder до обновления field в
  Word;
- все таблицы помещаются в printable area, строки и повторяемые headers читаемы;
- все шесть UI screenshots пропорциональны и не искажены;
- длинные provenance tables и signoff pages отображаются полностью;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены.

Страницы `1`, `38`, `39` и `40`, содержащие version/base/checkpoint, новый P2R2
contract и paused BW5 status, дополнительно просмотрены по отдельным
полноразмерным PNG. Страницы `65–68` отдельно закрыты финальным contact sheet.
Обрезания, наложения, пропавших строк и сломанных glyphs нет.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность текущего ТЗ и docs-only
plan amendment. После merge она фиксирует P2R2 как единственный активный repair
gate и разрешает только отдельную реализацию P2R2 с новым exact-head review и
merge-controller gate. BW5 остаётся paused до merge P2R2 и зелёного exact-main
CI.

Она не доказывает:

- выполнение или merge P2R2 либо BW5 implementation diff;
- успешный real local Supabase reset из physical worktree;
- реальный Notion или college dataset import;
- managed Supabase behavior и отдельный backup/restore proof;
- live amoCRM, WAHA, AI или Storage provider behavior;
- production deployment/cutover;
- real receive → identity link → persistence → draft → manual send → ACK/audit;
- bounded production reconciliation window или retirement legacy services.

Для этого docs-only блока `real-provider-proof: not-required`. Реальные
provider/release gates остаются `BLOCKED` или `PENDING` до разрешённого source
access, credentials, sanitized test identity/number, production authority и
фактического controlled evidence.
