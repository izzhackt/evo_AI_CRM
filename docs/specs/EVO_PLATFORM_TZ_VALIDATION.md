# EVO Platform ТЗ — журнал валидации

Дата проверки: 03.08.2026

Timezone: `Asia/Almaty`

Base commit до docs-only amendment:
`9ef7a7264c901f9c25e35ccbf106afe00c3c91ad`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: docs-only checkpoint amendment фиксирует merged P2R0/P2R1
через PR #104/#105 и переводит authoritative execution checkpoint на BW5.
BW5 — узкий university/college catalog и reviewable import boundary за
существующим `/applications`: staging/validation не публикуют записи напрямую,
Admin явно approve/reject с reason и audit, а tenant/role/object scope остаётся
fail-closed. Следующий номер migration только ожидается как `056` и обязан быть
повторно проверен на свежем `origin/main` и среди открытых PR перед реализацией.

Этот amendment не содержит product/runtime code или migration, не вызывает
Notion/college provider, не применяет remote schema и не мутирует production.
Реальный import остаётся заблокирован без разрешённого источника; отсутствующие
college records нельзя заменять вымышленными данными.

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

Machine-readable evidence финального clean rerun находится во временном
каталоге:
`/private/tmp/evo-platform-tz-render-bw5-final.IF67i1`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-67.png`.

Временные PDF/PNG и contact sheets не коммитятся. Markdown, generator,
verifier и закреплённая зависимость позволяют воспроизвести evidence.
Все `67` PNG финального clean rerun побайтно совпали с полностью просмотренным
render (`0` mismatches).

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `142226` bytes | `49b6801b7b86d5bc9e144ce6c1c25fcb3ce623c5e7b5e3e3b32bdb85c53085ce` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1785290` bytes | `276e2ab0981811cb1025fe06b257b4e5eb6bb00b09a174e149112a142672a1cc` |
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

Финальная machine-readable проверка завершилась `PASS`; source и две
последовательные DOCX-сборки имеют зафиксированные выше SHA-256.

## 4. Ручная визуальная проверка

Все страницы `1–67` проверены в PNG финального render через `17` bordered 2×2
contact sheets, сохраняющих серое внешнее поле и все четыре края каждой
страницы:

- cover, headers, footers и последовательность page numbers корректны;
- страница `2` содержит намеренный Word TOC placeholder до обновления field в
  Word;
- все таблицы помещаются в printable area, строки и повторяемые headers читаемы;
- все шесть UI screenshots пропорциональны и не искажены;
- длинные provenance tables и signoff pages отображаются полностью;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены.

Страницы `1`, `38`, `39` и `40`, содержащие новый version/base/checkpoint,
merged P2R1 status и активный BW5 contract, дополнительно просмотрены по
отдельным полноразмерным PNG. Страницы `65–67` отдельно закрыты финальным
contact sheet. Обрезания, наложения, пропавших строк и сломанных glyphs нет.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность текущего ТЗ и docs-only
checkpoint amendment. После merge она фиксирует P2R0/P2R1 как merged history и
разрешает только отдельную реализацию BW5 с новым exact-head review и
merge-controller gate.

Она не доказывает:

- выполнение или merge BW5 implementation diff;
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
