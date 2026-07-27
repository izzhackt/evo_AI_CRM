# EVO Platform ТЗ — журнал валидации

Дата проверки: 28.07.2026
Основание даты: финальная host-проверка вернула
`Tuesday 2026-07-28 01:28:01 +06 +0600`; явная проверка с
`TZ=Asia/Bishkek` вернула тот же результат. GitHub timestamp создания PR
`2026-07-27T19:24:49Z` обозначает тот же момент в UTC, то есть
`2026-07-28 01:24:49 +06`. Поэтому дата `28.07.2026` не является будущей в
workspace timezone.
Исходный commit до подготовки P0: `a16cd3fb591128b6d28f7f46c432169a0ff28753`
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

Полная проверка из изолированного Python-окружения выполнялась так:

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

Результат финального изолированного прогона:

- Python: `3.13.0`;
- `python-docx`: `1.2.0`;
- требования в основном ТЗ: `211`;
- строки поэлементной provenance-матрицы: `211`;
- официальный каталог source codes: `13`;
- локальные design-evidence изображения: `6`;
- официальные внешние ссылки: `8`;
- DOCX: `533` paragraphs, `27` tables, `7` drawings с alt text,
  `8` external hyperlinks;
- две последовательные сборки DOCX дали одинаковый SHA-256:
  `b0465dfef4d4c86f1b6de84f213fc02e91b883c949522d240203f026025fbf68`;
- рендер LibreOffice → PDF → Poppler PNG при фиксированных `144 DPI`:
  `56` страниц;
- все `56` PNG, отдельно созданные bundled document renderer при `144 DPI`,
  побайтно совпали с PNG verifier;
- все `56` PNG повторного прогона в изолированном venv побайтно совпали с
  финальным эталонным прогоном;
- автоматический DOCX accessibility audit: `0 high / 0 medium / 0 low`;
- итог: `PASS requirements=211 traceability=211 pages=56 a11y=0/0/0`.

Verifier преобразует каждую PDF-страницу отдельно. Это исключает наблюдавшееся
в одном раннем неэталонном batch-render артефактное повреждение PNG и делает
сравнение страниц детерминированным.

Машиночитаемые evidence-файлы прогона записаны как `validation.json` и
`accessibility-report.json` в отдельный временный render directory. Временные
PDF/PNG не коммитятся: исходный Markdown, генератор, verifier и закреплённая
зависимость позволяют воспроизвести их заново.

## 2. Контрольные суммы

На момент финальной проверки:

| Файл | SHA-256 |
|---|---|
| `docs/specs/EVO_PLATFORM_TZ.md` | `c5a5a13673fe5f7691929ac609a88523611c75ab2e9b94c6b33c22fa501ac80f` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `b0465dfef4d4c86f1b6de84f213fc02e91b883c949522d240203f026025fbf68` |

## 3. Что проверяет автоматический verifier

`scripts/verify-evo-platform-tz.py` fail-closed проверяет:

1. сборку DOCX из текущего Markdown и её bit-for-bit воспроизводимость;
2. полный и непрерывный набор `FR`, `INT`, `DATA`, `SEC`, `NFR`, `ACC`, `DEC`;
3. ровно одну provenance-строку для каждого из 211 ID;
4. отсутствие неизвестных и неиспользуемых source codes;
5. существование всех локальных design-evidence изображений;
6. наличие всех обязательных official external links;
7. целостность ZIP/XML структуры DOCX;
8. alt text у каждого drawing object;
9. повторяемую строку заголовка и непустые header cells каждой таблицы;
10. непрерывную heading hierarchy;
11. обязательные core properties;
12. реальный LibreOffice render в PDF;
13. реальный Poppler render каждой PDF-страницы в отдельном процессе;
14. отсутствие high, medium и low accessibility findings.

## 4. Ручная визуальная проверка

Все страницы `1–56` проверены в PNG при original resolution.

- страницы `1–28` проверены независимым visual reviewer;
- страницы `29–56` проверены вторым независимым visual reviewer;
- единственное замечание первого прохода на странице `17` — неудобные
  переносы двух смешанных RU/EN фраз — исправлено;
- после исправления страница `17` повторно отрендерена и проверена отдельно,
  а побайтное сравнение подтвердило, что страницы `1–16` и `18–56` не
  изменились;
- таблицы требований, decisions и provenance не обрезаны;
- переносы текста остаются внутри ячеек;
- headers/footers, повторяющиеся table headers и номера страниц
  последовательны;
- все шесть UI screenshots пропорциональны и не искажены;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены;
- страница `2` содержит обновляемое Word TOC field, поэтому до обновления полей
  в Word показывает намеренный placeholder;
- на странице `44` явно виден warning, что screenshot с исторической ролью
  «Визовый отдел» является pre-P1 evidence, а не нормативной role matrix.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает полноту, воспроизводимость, traceability, структурную
доступность и визуальную целостность ТЗ. P0 разрешает начать repo-реализацию
только после merge этого docs-only блока в соответствии с
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`.

Проверка **не** доказывает live amoCRM, WAHA, Supabase, AI, telephony, payment,
production deployment, controlled cutover или 72-часовой soak. Соответствующие
provider/release gates остаются `BLOCKED` или `PENDING`, пока не появятся
реальные credentials, test identity/number, production authority, evidence и
фактически прошедшее время.
