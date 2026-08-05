# EVO Platform ТЗ — журнал валидации

Дата проверки: 05.08.2026

Timezone: `Asia/Almaty`

Base commit до docs-only amendment:
`10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: PR #118 уже слил P4B docs-only contract в `main` на exact
checkpoint `10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`; exact-main CI run
`30963131242` зелёный. P4B implementation
приостановлен до shared implementation PR/migration. Текущий docs-only
amendment вводит BW8 как отдельный sequential gate student document
intelligence: private intake, real scanner, durable extraction candidates,
human confirmation, expanded typed profile и versioned DOCX/PDF drafts через
существующий `/documents` UI contract.

Amendment не содержит product/runtime implementation или migration, не
обращается к Supabase/Drive/OpenAI/scanner/converter, не читает real student
files, не применяет remote schema и не мутирует production. Он не разрешает
real-student provider processing до Product/Legal/Data decision и не меняет
amoCRM sales ownership, managed-environment или release gates.

## 1. Воспроизводимая сборка

DOCX собирается только из канонического Markdown:

```bash
/Users/iskhak.tazhibaev/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/generate-evo-platform-tz.py
```

Полная повторная сборка, структура, traceability, accessibility и реальный
LibreOffice/Poppler render проверены командой:

```bash
render_dir="$(mktemp -d /private/tmp/evo-platform-tz-bw8-verify.XXXXXX)"
/Users/iskhak.tazhibaev/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/verify-evo-platform-tz.py --render-dir "$render_dir"
```

Закреплённая document-зависимость:
`python-docx==1.2.0` в `scripts/requirements-evo-platform-tz.txt`.

Финальный clean прогон:

- Python: `3.12.13`;
- `python-docx`: `1.2.0`;
- requirements: `269`;
- поэлементные traceability rows: `269`;
- source codes: `14`;
- design-evidence images: `6`;
- official external links: `8`;
- DOCX structure: `610` paragraphs, `32` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- source SHA-256:
  `71c4ad3ea892517cc97c9c3cb4fd733b46a177a69341c641c891248d06e9c47d`;
- DOCX SHA-256:
  `3c12363140909beab2594cfc6c1c9c792457c0b07d38687c4b63dd12dcb00a24`;
- две последовательные сборки DOCX побайтно совпали;
- LibreOffice -> PDF -> Poppler PNG: `73` страницы;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=269 traceability=269 pages=73 a11y=0/0/0`.

Machine-readable evidence clean rerun находится во временном каталоге:
`/private/tmp/evo-platform-tz-bw8-verify.syOcSG`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` ... `page-73.png`.

Render artifacts намеренно не коммитятся.

## 2. Что проверяет verifier

- exact coverage всех `FR/INT/DATA/SEC/NFR/ACC/DEC` IDs;
- ровно одна traceability row для каждого requirement;
- source catalog без неизвестных или неиспользуемых codes;
- deterministic DOCX generation через две независимые сборки;
- pinned dependency и metadata;
- Word headings, tables, relationships, hyperlinks и drawings;
- alt text для drawings;
- реальные LibreOffice PDF и Poppler PNG для каждой страницы;
- accessibility findings с fail на любом high/medium/low issue.

`scripts/verify-evo-platform-tz.py` обновлён только как document-validation
tool: ожидаемые пределы теперь FR-119, INT-024, DATA-024, SEC-026, NFR-022 и
ACC-034. Это не runtime/application implementation.

## 3. Traceability и смысловая проверка

- новые FR-111-FR-119 фиксируют accepted `/documents` workbench, exact private
  intake/finalize, real scanner, typed evidence candidates, human revision-aware
  decisions, expanded form fields, deterministic projection/export и 14-item
  China overlay;
- INT-021-INT-024 фиксируют Drive, OpenAI structured extraction,
  real-student policy gate и private DOCX-to-PDF conversion;
- DATA-019-DATA-024 отделяют persisted run/fact/decision/profile/export/live
  projection от provider output и запрещают PII в logs/artifacts;
- SEC-021-SEC-026 фиксируют real scan, case/object scope, server-only adapters,
  minimized evidence, sanitized immutable template и retention boundary;
- NFR-019-NFR-022 фиксируют reconnectable persisted live state, durable jobs,
  export determinism и usable accessible document workbench;
- ACC-026-ACC-034 дают проверяемый complete BW8 exit без подмены local,
  provider, managed или production proof;
- P4B contract и P4A evidence остаются immutable, но BW8A теперь rechecks
  expected next-free migration 059; paused P4B rechecks the then-next free
  migration after BW8.

Проверено, что AI/OCR output везде является candidate evidence и не получает
direct canonical write. Real student provider use везде blocked до existing
Legal/Data gate DEC-012 и отдельного Product/Data approval. Video resume честно
зафиксирован checklist/evidence-only, потому что P2H поддерживает только
PDF/JPEG/PNG до 25 MiB.

## 4. Визуальная проверка

Все страницы `1-73` проверены по real LibreOffice/Poppler PNG. Для покрытия
каждой страницы созданы девять временных `3x3` contact sheets; дополнительно в
original resolution просмотрены новые/изменённые pages `29-36`, execution
pages `43-44` и финальные traceability/signoff pages `72-73`.

Проверено:

- cover, version `2.0`, base checkpoint, headers, footers и page numbers;
- намеренный Word TOC placeholder на page 2;
- новые Student document intelligence, integrations, data, security, NFR и
  acceptance tables полностью помещаются в printable area;
- перенос длинных mixed RU/EN identifiers и URLs не ломает columns;
- BW8/P4B execution boundary читаем и не обрезан;
- все шесть UI screenshots пропорциональны и не искажены;
- provenance/traceability tables и signoff отображаются полностью;
- clipping, overlap, missing rows, broken glyphs, raster corruption и
  illegible content не обнаружены.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность ТЗ версии `2.0` и текущего
docs-only BW8 amendment. После controller merge она разрешает только отдельные
sequential BW8A-BW8E implementation PRs с новым exact-head review/controller
gate для каждого блока.

Она не доказывает:

- migration 059, RLS/extraction/profile/export implementation или workbench UI;
- real private upload, scanner, PGMQ worker, Drive/OpenAI call или converter;
- approval для отправки real student files external extraction provider;
- managed Supabase, staging, backup/restore или production behavior;
- live amoCRM/WAHA/ACK behavior либо P4B implementation;
- production deployment/cutover или customer delivery.

Для docs-only amendment `real-provider-proof: not-required`. Provider,
real-student, managed/staging и release evidence остаются `BLOCKED`/`PENDING`
до соответствующей авторизации и фактического controlled exercise.
