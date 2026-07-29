# EVO Platform ТЗ — журнал валидации

Дата проверки: 30.07.2026

Timezone: `Asia/Bishkek`

Base commit до docs-only amendment:
`b10d72863230aba646bcc8f2acafdc76c27b3fe1`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: docs-only amendment фиксирует greenfield Supabase-native
Platform, существующий unified frontend как единственный UI-контракт, отсутствие
автоматического импорта legacy SQLite/root-auth и ускоренный thin messaging
slice. Product/runtime code, remote apply и production mutation в этот блок не
входят.

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
- requirements: `211`;
- поэлементные traceability rows: `211`;
- source codes: `13`;
- design-evidence images: `6`;
- official external links: `8`;
- DOCX structure: `583` paragraphs, `30` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- две последовательные сборки DOCX побайтно совпали;
- LibreOffice → PDF → Poppler PNG: `64` страницы;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=211 traceability=211 pages=64 a11y=0/0/0`.

Machine-readable evidence находится во временном каталоге:
`/private/tmp/evo-platform-tz-render-final.RLiTx4`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-64.png`.

Временные PDF/PNG не коммитятся. Markdown, generator, verifier и закреплённая
зависимость позволяют воспроизвести evidence.

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `133300` bytes | `69fc757ee15f4f55e51f67411938cc9c20c12f6aac0859c20ab55285c9323675` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1780618` bytes | `f3a4e00199731365404c1bacc9f27afdceffe3b9f8cfe76d7fbccb05f8a78de6` |
| `scripts/generate-evo-platform-tz.py` | `39198` bytes | `ebd0d431ca456fc42492d3e5ab815bde4bc980d295f8db01ffa7ced63b9eb14f` |

`validation.json` подтверждает одинаковый DOCX SHA-256 для первой и второй
сборки.

## 3. Автоматические проверки

Verifier проверяет:

- полноту и уникальность FR/INT/DATA/SEC/NFR/ACC identifiers;
- точное соответствие `211` requirements и `211` provenance rows;
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

Все страницы `1–64` проверены в PNG финального fixed render:

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

Финальный повторный render подтвердил FR-001–FR-090 и все остальные ID.
Дополнительно PDF bbox geometry проверена для всех страниц: на страницах 2–64
присутствует точный running header, нет текста левее `55 pt`, и ниже `730 pt`
находится только ожидаемый footer. Проблемные страницы 26–28 и 49–64
просмотрены отдельно в original resolution; остальные страницы проверены в
фиксированных contact sheets, сохраняющих белые поля и границы каждой страницы.
Финальный повторный verifier после последнего generator-comment change создал
побайтно идентичные 64 PNG по сравнению с визуально проверенным render.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность текущего ТЗ и plan amendment.
После merge она разрешает начать P3 thin Supabase-native messaging slice за
существующим root frontend.

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
