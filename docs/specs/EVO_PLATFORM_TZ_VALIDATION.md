# EVO Platform ТЗ — журнал валидации

Дата проверки: 26.07.2026
Исходный commit до подготовки ТЗ: `0ecd95d6b248572269bec17d60072a49230e626e`
Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`
Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`

## 1. Воспроизводимая сборка

DOCX собирается только из канонического Markdown командой:

```bash
python scripts/generate-evo-platform-tz.py
```

Зависимость закреплена в `scripts/requirements-evo-platform-tz.txt`:

```text
python-docx==1.2.0
```

Полная проверка из чистого Python-окружения выполнялась так:

```bash
tz_venv="$(mktemp -d /private/tmp/evo-tz-venv.XXXXXX)"
tz_render="$(mktemp -d /private/tmp/evo-platform-tz-repro.XXXXXX)"
python3 -m venv "$tz_venv"
"$tz_venv/bin/python" -m pip install \
  --disable-pip-version-check \
  -r scripts/requirements-evo-platform-tz.txt
"$tz_venv/bin/python" scripts/verify-evo-platform-tz.py \
  --render-dir "$tz_render"
```

Результат чистого прогона:

- Python: `3.13.0`;
- `python-docx`: `1.2.0`;
- требования в основном ТЗ: `211`;
- строки поэлементной provenance-матрицы: `211`;
- официальный каталог source codes: `13`;
- локальные design-evidence изображения: `6`;
- официальные внешние ссылки: `8`;
- DOCX: `541` paragraphs, `27` tables, `7` drawings, `8` external hyperlinks;
- две последовательные сборки DOCX дали одинаковый SHA-256:
  `f4d57be32eba9c95f6ff67238b870a083f1771e200ecf1b75469b9f1acd967ad`;
- рендер LibreOffice → PDF → PNG: `55` страниц;
- автоматический DOCX accessibility audit: `0 high / 0 medium / 0 low`;
- итог: `PASS requirements=211 traceability=211 pages=55 a11y=0/0/0`.

Машиночитаемые evidence-файлы прогона были записаны как
`validation.json` и `accessibility-report.json` в отдельный временный render
directory. Временные PDF/PNG не коммитятся: исходный Markdown, генератор,
верификатор и закреплённая зависимость позволяют воспроизвести их заново.

## 2. Контрольные суммы

На момент финальной проверки:

| Файл | SHA-256 |
|---|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `554e6771a761fc0b4babebc8c2b29d23dea95173e2ccad21ea3ebe0ff9c81c75` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `f4d57be32eba9c95f6ff67238b870a083f1771e200ecf1b75469b9f1acd967ad` |

## 3. Что проверяет автоматический verifier

`scripts/verify-evo-platform-tz.py` fail-closed проверяет:

1. сборку DOCX из текущего Markdown и её bit-for-bit воспроизводимость;
2. полный и непрерывный набор `FR`, `INT`, `DATA`, `SEC`, `NFR`, `ACC`, `DEC`;
3. ровно одну provenance-строку для каждого из 211 ID;
4. отсутствие неизвестных и неиспользуемых source codes;
5. существование всех локальных design-evidence изображений;
6. наличие всех официальных external links;
7. целостность ZIP/XML структуры DOCX;
8. alt text у каждого drawing object;
9. повторяемую строку заголовка и непустые header cells каждой таблицы;
10. непрерывную heading hierarchy;
11. обязательные core properties;
12. реальный LibreOffice render в PDF;
13. реальный Poppler render каждой PDF-страницы в PNG;
14. отсутствие high, medium и low accessibility findings.

## 4. Ручная визуальная проверка

Все страницы `1–55` проверены в PNG при original resolution.

- страницы `1–10` проверены основным reviewer;
- страницы `11–32` проверены основным reviewer и независимым visual reviewer;
- страницы `33–55` проверены основным reviewer и независимым visual reviewer;
- таблицы требований, decisions и provenance не обрезаны;
- переносы текста остаются внутри ячеек;
- headers/footers и номера страниц последовательны;
- все шесть UI screenshots пропорциональны и не искажены;
- clipping, overflow, missing content и illegible rows не обнаружены;
- page 2 содержит обновляемое Word TOC field, поэтому до обновления полей в Word
  показывает placeholder;
- свободное место на pages 38 и 55 намеренное: окончание таблицы и страница
  согласования.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает полноту, воспроизводимость, traceability,
структурную доступность и визуальную целостность ТЗ. Она **не** доказывает live
amoCRM, WAHA, Supabase, AI, telephony, payment или production deployment.

Real-provider E2E не запускался, потому что этот slice создаёт контракт для
будущей реализации. Реализация начинается только после письменного
согласования раздела 32 и закрытия blocking решений раздела 24.
