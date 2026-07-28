# EVO Platform ТЗ — журнал валидации

Дата проверки: 28.07.2026
Основание даты: host-проверка и явная проверка с `TZ=Asia/Bishkek` вернули
`Tuesday 2026-07-28 15:30:25 +0600 +06`.
Исходный commit до подготовки P2 plan amendment:
`d3edcda6649cb7b90b789c57c658ec1fc4a20618`
Канонический источник: `docs/specs/EVO_PLATFORM_TZ.md`
Owner-facing документ: `docs/specs/EVO_PLATFORM_TZ.docx`
Контекст проверки: docs-only контракт декомпозиции P2 и уточнение единственной
Supabase migration/schema authority; SQL, remote apply и production mutation в
этот блок не входят.

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
- DOCX: `540` paragraphs, `29` tables, `7` drawings с alt text,
  `8` external hyperlinks;
- две последовательные сборки DOCX дали одинаковый SHA-256:
  `dcebd83284d5f55eaab2979196221bdbeab22e38e895da4dd1ff31eca7400e6e`;
- рендер LibreOffice → PDF → Poppler PNG при фиксированных `144 DPI`:
  `58` страниц;
- все `58` PNG, отдельно созданные bundled document renderer версии
  `26.727.11326` при `144 DPI`, побайтно совпали с PNG verifier;
- автоматический DOCX accessibility audit: `0 high / 0 medium / 0 low`;
- итог: `PASS requirements=211 traceability=211 pages=58 a11y=0/0/0`.

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
| `docs/specs/EVO_PLATFORM_TZ.md` | `768a18ad67c770cf5437ea4daa6c8d06e37d8fa5e65a90bdd06c4a2ead84cdaf` |
| `docs/specs/EVO_PLATFORM_TZ.docx` | `dcebd83284d5f55eaab2979196221bdbeab22e38e895da4dd1ff31eca7400e6e` |

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

Все страницы `1–58` проверены в PNG при original resolution.

- страницы `1–29` проверены независимым visual reviewer;
- страницы `30–58` проверены вторым независимым visual reviewer;
- основной executor дополнительно проверил страницы `1–58` по
  original-resolution contact sheets;
- после final terminology correction изменились только страницы
  `4–7`, `17–21` и `38`; они повторно проверены по отдельности двумя
  независимыми reviewers и основным executor, а остальные `48` страниц
  побайтно совпали с уже проверенным render;
- таблицы требований, decisions и provenance не обрезаны;
- переносы текста остаются внутри ячеек;
- headers/footers, повторяющиеся table headers и номера страниц
  последовательны;
- все шесть UI screenshots пропорциональны и не искажены;
- clipping, overflow, missing content, raster corruption и illegible rows не
  обнаружены;
- страница `2` содержит обновляемое Word TOC field, поэтому до обновления полей
  в Word показывает намеренный placeholder;
- на странице `46` явно виден warning, что screenshot с исторической ролью
  «Визовый отдел» является pre-P1 evidence, а не нормативной role matrix.

Итог ручной проверки: `PASS`.

## 5. Граница доказательства

Эта проверка доказывает полноту, воспроизводимость, traceability, структурную
доступность и визуальную целостность обновлённого ТЗ. Она разрешает начать
P2A только после merge этого docs-only plan amendment в соответствии с
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`; она не является доказательством
реализации Supabase foundation.

Проверка **не** доказывает live amoCRM, WAHA, Supabase, AI, telephony, payment,
production deployment, controlled cutover или 72-часовой soak. Соответствующие
provider/release gates остаются `BLOCKED` или `PENDING`, пока не появятся
реальные credentials, test identity/number, production authority, evidence и
фактически прошедшее время.
