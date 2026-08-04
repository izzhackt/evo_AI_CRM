# EVO Platform ТЗ — журнал валидации

Дата проверки: 04.08.2026

Timezone: `Asia/Almaty`

Base commit до docs-only amendment:
`121db548b252eff9e4b79f62297aa27fe39e5c40`

Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`

Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

Контекст проверки: PR #117 с P4A amoCRM discovery contract слит в `main` как
`121db548b252eff9e4b79f62297aa27fe39e5c40`; exact-main CI run
`30958119076` завершил `Main CRM`, `EVO Inbox` и `EVO Lead Agent` со статусом
`success`, а docs-only `Changed range` ожидаемо был `skipped`. Текущий
docs-only amendment вводит P4B как отдельный gate выбора и одобрения одной
неизменяемой версии P4A discovery для messaging-сценария существующего
`/whatsapp` UI contract. Текущая проекция выводится детерминированно из
append-only событий `approved` и `revoked`; изменяемый флаг current запрещён.
Одобрение и отзыв доступны только Admin той же организации после live-authority
проверки. Реализация ожидается отдельным implementation PR и не входит в этот
amendment.

Этот amendment не содержит product/runtime code или migration, не обращается к
amoCRM, Supabase, WAHA или AI provider, не применяет remote schema и не мутирует
production. Он не разрешает provider writes, OAuth, identity sync, webhooks,
jobs, reconciliation или новый UI. Legacy SQLite/custom-auth остаются отдельной
системой и не становятся data plane EVO Platform.

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
- DOCX structure: `600` paragraphs, `31` tables, `7` inline shapes,
  `7` drawings с alt text, `8` external hyperlinks;
- две последовательные сборки DOCX побайтно совпали;
- LibreOffice → PDF → Poppler PNG: `68` страниц;
- accessibility audit: `0 high / 0 medium / 0 low`;
- итог:
  `PASS requirements=231 traceability=231 pages=68 a11y=0/0/0`.

Machine-readable evidence финального clean rerun находится во временном
каталоге:
`/private/tmp/evo-platform-tz-p4b-final.239UQq`:

- `validation.json`;
- `accessibility-report.json`;
- `EVO_PLATFORM_TZ.pdf`;
- `page-01.png` … `page-68.png`.

Packaged document renderer дополнительно создал отдельный визуальный набор в
`/private/tmp/evo-platform-tz-p4b-inspect.AKl94d`. Все `68` страниц этого
render просмотрены в оригинальном разрешении, включая итоговый contact sheet
страниц `65–68`.

Временные PDF/PNG, contact sheets и вспомогательные материалы визуальной
проверки не коммитятся. Markdown, generator, verifier и закреплённая зависимость
позволяют воспроизвести evidence.

## 2. Контрольные суммы и размеры

| Файл | Размер | SHA-256 |
|---|---:|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `144013` bytes | `fc329212518b02f5b043d6786f8550175bbe1f9cda21ce6b3b65b18004813119` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `1786137` bytes | `18cbe21ca29e37638e84303dbabdfc477b0d9adab501ec507b74f427665d5a51` |
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

Все страницы `1–68` проверены по PNG packaged LibreOffice render в оригинальном
разрешении:

- cover, headers, footers и последовательность page numbers корректны;
- страница `2` содержит намеренный Word TOC placeholder до обновления field в
  Word;
- все таблицы помещаются в printable area, строки и повторяемые headers читаемы;
- все шесть UI screenshots пропорциональны и не искажены;
- длинные provenance tables и signoff pages отображаются полностью;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены.

Страницы с version/base/checkpoint и новым P4B contract дополнительно проверены;
особо просмотрены страницы `1–2`, `38–41` и финальные `65–68`. Обрезания,
наложения, пропавших строк и сломанных glyphs нет.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает целостность, воспроизводимость, traceability,
структурную доступность и визуальную корректность ТЗ версии `1.9` и текущего
docs-only P4B amendment. После merge она разрешает только отдельную реализацию
P4B selection/approval ledger с новым exact-head review и merge-controller gate.

Она не доказывает:

- выполнение или merge P4B implementation diff и ожидаемой migration `059`;
- managed Supabase behavior, RLS либо отдельный backup/restore proof;
- live amoCRM discovery, account mappings, OAuth или provider writes;
- live WAHA, AI или Storage provider behavior;
- production deployment/cutover;
- real receive → identity link → persistence → draft → manual send → ACK/audit;
- bounded production reconciliation window или retirement legacy services.

Для этого docs-only блока `real-provider-proof: not-required`. Реальные
provider/release gates остаются `BLOCKED` или `PENDING` до разрешённого source
access, credentials, sanitized test identity/number, production authority и
фактического controlled evidence.
