# EVO Platform ТЗ — журнал валидации

Дата проверки: 30.07.2026

Timezone: `Asia/Bishkek`

Base commit до docs-only amendment:
`26115344909261a39bbe591f3b835cda4b7e5068`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: docs-only amendment фиксирует greenfield Supabase-native
Platform, существующий unified frontend как единственный UI-контракт, отсутствие
автоматического импорта legacy SQLite/root-auth и ускоренный thin messaging
slice, а также добавляет business-workflow lane OP/OZO, country overlays,
Student Profile, checklists/templates/contract drafts, decision backlog и
approved knowledge/prompt lifecycle. Product/runtime code, remote apply и
production mutation в этот блок не входят.

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
- DOCX structure: `597` paragraphs, `31` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- две последовательные сборки DOCX побайтно совпали;
- LibreOffice → PDF → Poppler PNG: `67` страниц;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=231 traceability=231 pages=67 a11y=0/0/0`.

Machine-readable evidence находится во временном каталоге:
`/private/tmp/evo-platform-tz-render-bw0.qKfkIs`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-67.png`.

Временные PDF/PNG не коммитятся. Markdown, generator, verifier и закреплённая
зависимость позволяют воспроизвести evidence.

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `141144` bytes | `9d46f28ebc8c4ae82eff30c13539df4a7df9cc5e84d86e773218ddeeeafd8776` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1784739` bytes | `621e10d0f00425532a8439e14f0c9b4516d27d85c1a04c32bc09b6d6c09fe0d6` |
| `scripts/generate-evo-platform-tz.py` | `39198` bytes | `ebd0d431ca456fc42492d3e5ab815bde4bc980d295f8db01ffa7ced63b9eb14f` |
| `scripts/verify-evo-platform-tz.py` | `15754` bytes | `b4228980f03a9add719fd0c2c22dc09917c36121774d3fb6160b14c365c5fd40` |

`validation.json` подтверждает одинаковый DOCX SHA-256 для первой и второй
сборки.

## 3. Автоматические проверки

Verifier проверяет:

- полноту и уникальность FR/INT/DATA/SEC/NFR/ACC identifiers;
- точное соответствие `231` requirements и `231` provenance rows;
- наличие всех `13` source codes;
- локальные изображения, alt text и hyperlinks;
- отсутствие незаполненных шаблонных полей;
- deterministic DOCX rebuild;
- открытие DOCX библиотекой `python-docx`;
- реальный PDF render и отдельный PNG каждой страницы;
- accessibility findings.

После render дополнительно выполнено сравнение количества каждого
FR/INT/DATA/SEC/NFR/ACC ID между Markdown и PDF text layer. Diff пустой:
визуальный документ содержит все ID с тем же количеством вхождений.

## 4. Ручная визуальная проверка

Все страницы `1–67` проверены в PNG финального fixed render:

- cover, headers, footers и последовательность page numbers корректны;
- страница `2` содержит намеренный Word TOC placeholder до обновления field в
  Word;
- все таблицы помещаются в printable area, строки и повторяемые headers читаемы;
- все шесть UI screenshots пропорциональны и не искажены;
- страницы с длинной provenance-таблицей дополнительно просмотрены отдельно в
  original resolution;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены.

Во время первой проверки был найден реальный pagination defect: LibreOffice
терял FR-076–FR-082, когда таблица раздела 13.8 начиналась в последних строках
предыдущей страницы. После первого review merge-controller дополнительно
обнаружил визуальное обрезание continuation pages: таблица 13.6 теряла видимые
префиксы `FR-`, а некоторые screenshot/heading pages начинались выше printable
area. Generator исправлен безопасными явными page breaks и достаточным
heading spacing; переполнявшиеся разделы 13.6/13.7, 27.x и 28–32 разделены без
изменения содержания.

Финальный повторный render подтвердил FR-001–FR-110 и все остальные ID.
Дополнительно PDF bbox geometry проверена для всех страниц: на страницах 2–67
присутствует точный running header, нет текста левее `55 pt`, и ниже `730 pt`
находится только ожидаемый footer. Страницы 1–67 просмотрены в фиксированных
contact sheets, сохраняющих белые поля и границы каждой страницы; страница 8 и
provenance continuation page 64 дополнительно проверены в original resolution.
Workflow tables 29–30 и BW execution lane 39–40 также проверены на читаемость.
Обрезания, наложения, пропавших строк и сломанных glyphs не обнаружено.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность текущего ТЗ и plan amendment.
После merge она фиксирует BW0 business-workflow contract. P3 thin
Supabase-native messaging slice остаётся первым implementation block за
существующим root frontend; BW1 начинается только после P3C.

Она не доказывает:

- подключение текущего P2 foundation к frontend;
- Supabase SSR auth/RBAC или repository adapters;
- live amoCRM, WAHA, AI или Storage provider behavior;
- production deployment/cutover;
- real receive → identity link → persistence → draft → manual send → ACK/audit;
- bounded production reconciliation window или retirement legacy services.

Для этого docs-only блока `real-provider-proof: not-required`. Реальные
provider/release gates остаются `BLOCKED` или `PENDING` до credentials,
sanitized test identity/number, production authority и фактического controlled
evidence.
