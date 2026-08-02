# EVO Platform ТЗ — журнал валидации

Дата проверки: 02.08.2026

Timezone: `Asia/Almaty`

Base commit до docs-only amendment:
`124ed41e1ba7f25d0f1affca336ce222e0a187d4`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: docs-only P2R0 amendment восстанавливает plan freshness
после merged sequence through PR #103, фиксирует завершённые P3A–P3C и BW1–BW4
и вводит узкий последовательный P2R1 gate для надёжности локального Supabase
proof. P2R1 не
расширяет product scope: process-group deadlines, точная очистка только
одноразовых EVO validation resources, transient-only Auth readiness, стабильные
PGMQ leases и next-free forward migration для document lock ordering.
Product/runtime code, новая migration, remote apply, provider invocation,
backup/restore proof и production mutation в P2R0 не входят.

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
- LibreOffice → PDF → Poppler PNG: `67` страниц;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=231 traceability=231 pages=67 a11y=0/0/0`.

Machine-readable evidence находится во временном каталоге:
`/private/tmp/evo-platform-tz-render-p2r0-rereview-final.Q6F9tu`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-67.png`.

Временные PDF/PNG не коммитятся. Markdown, generator, verifier и закреплённая
зависимость позволяют воспроизвести evidence.

Финальный clean rerun завершился `PASS`. Декодированные RGB pixels всех `67`
PNG-страниц совпали с ранее полностью просмотренным render (`0` pixel
mismatches); различия в бинарном PNG-контейнере не используются как визуальный
сигнал. Все страницы повторно проверены в `17` bordered 2×2 contact sheets.

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `141790` bytes | `98ad80f73d48ed07fdaf6c8d820d95541fe2afd01fc96dfd722ea8c8c36953f1` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1785132` bytes | `e59e2fabff92fc7607b2e97632beb3bdafc8e4946604474c6771fa50dc14a784` |
| `scripts/generate-evo-platform-tz.py` | `39198` bytes | `ebd0d431ca456fc42492d3e5ab815bde4bc980d295f8db01ffa7ced63b9eb14f` |
| `scripts/verify-evo-platform-tz.py` | `15754` bytes | `b4228980f03a9add719fd0c2c22dc09917c36121774d3fb6160b14c365c5fd40` |

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
  полном кадре (`detail=high`) и в bordered contact sheets;
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
contact sheets, сохраняющих белые поля и границы каждой страницы; страницы
37–40 с изменённым execution contract, provenance continuation page 64 и
финальная signoff page 67 дополнительно проверены в полном кадре.
P2R1 table 38–39 и BW execution lane 40 также проверены на читаемость.
Обрезания, наложения, пропавших строк и сломанных glyphs не обнаружено.

После controller review отдельно перепроверены отмеченные страницы `24`, `26`,
`50`, `56`, `62`, `64` и `66`. Их исходные PNG и DOCX были корректны и не
изменялись: пропавшие в review цифры и префиксы воспроизводились только в
model-visible preview одиночного PNG при `detail=original`, который кадрировал
левый или верхний край изображения. Тот же PNG при `detail=high`, а также
фиксированный bordered contact sheet с серым внешним полем, показывают страницу
целиком: `FR-029`/`FR-030`, отдельный `FR-058`, заголовки `27.3` и `31`, все
идентификаторы и source prefixes на страницах `62`/`64`/`66` присутствуют и
читаемы. Поэтому одиночный `detail=original` не используется как доказательство
геометрии страницы; для full-page проверки обязательны `detail=high` либо
bordered contact sheet, где видимы все четыре края страницы.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность текущего ТЗ и plan amendment.
После merge она фиксирует P2R0 reliability plan gate: P3A–P3C и BW1–BW4 уже
считаются merged history, P2R1 идёт следующим отдельным implementation block,
а BW5 начинается только после его exact-head review и controller merge.

Она не доказывает:

- выполнение или merge P2R1 implementation diff;
- managed Supabase behavior и отдельный backup/restore proof;
- live amoCRM, WAHA, AI или Storage provider behavior;
- production deployment/cutover;
- real receive → identity link → persistence → draft → manual send → ACK/audit;
- bounded production reconciliation window или retirement legacy services.

Для этого docs-only блока `real-provider-proof: not-required`. Реальные
provider/release gates остаются `BLOCKED` или `PENDING` до credentials,
sanitized test identity/number, production authority и фактического controlled
evidence.
