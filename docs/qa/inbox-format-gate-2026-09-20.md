# Issue42 — предварительная проверка форматирования Inbox

Это CI predecessor пункта35. Само форматирование companion ещё не выполнено:
исходный `format:check` выявил347 файлов (исторический issue считал338).
Контракты записаны до кода: `3bc41ba9`, затем `2b709251`.

## Граница

Classifier выделяет только M-кандидатов старого companion, сохраняя отдельные
`inbox_dependencies` и `inbox_formatting`. Любой из них требует success уже
существующего Inbox job; skipped/failure/cancelled не принимаются. Неизвестные
пути и остальные lanes сохраняют прежние ограничения. Одиночные ранее разрешённые
edge-изменения не переводятся в formatter-only режим.

Changed range фиксирует SHA merge base и head. Formatter job проверяет именно
этот checkout и диапазон. До установки зависимостей отклоняются новые/удалённые/
переименованные файлы, symlinks/mode changes, изменения package/lock, конфигурации
и игнорирований форматтера, generated/vendor/migrations и смешанный исполняемый
код вне companion. Отдельные Markdown-квитанции в docs допускаются.

После `npm ci --ignore-scripts` verifier читает base/head blobs через Git и
требует для каждого изменённого файла companion точный результат существующего
Prettier с прежними настройками. Игнорируемые файлы и неизвестный parser — отказ.
Весь child diff проверяется, включая ранее известные classifier edge paths.

Затем formatting lane выполняет `format:check`, lint, typecheck, существующий
legacy `npm test`, build и прежний npm audit. Legacy Vitest использует свои
прежние mocks и тестовые env; это unit-проверка форматирования, не проверка
Supabase/WhatsApp/провайдеров. Обычный dependency PR сохраняет прежние три pure
helper tests с config/envDir=false. Новые provider mocks не добавлялись.

Точное совпадение с форматтером само по себе не доказывает полную семантическую
эквивалентность: Tailwind plugin сортирует классы и может удалять повторы. Для
следующего mechanical PR остаётся обязательным независимый semantic-diff review.
Версии/config/plugins/exclusions сейчас не меняются.

## Выполненная локальная проверка

- Node22.23.1; root и companion установлены из lockfile с `--ignore-scripts`.
- Classifier + настоящий временный Git и locked Prettier:38 checks PASS.
  Положительный путь использует копию существующего source blob и formatter;
  отрицательные — semantic edit, dependency/config, mode, rename, symlink,
  новый/неизвестный файл и mixed root/unsupported edge. Это проверка CI-инструмента,
  не выдуманные продуктовые записи или provider acceptance.
- Три изменённых workflow/gate checks PASS, включая реальное исполнение bash
  обязательного Fast checks с success/failure/cancelled/skipped результатами.
- Scoped ESLint, YAML parse и `git diff --check` PASS.
- Первая classifier-проверка обнаружила слишком широкий deploy-кандидат;
  scope сужен до двух существующих Compose-файлов, после исправления38/38 PASS.

Полный suite продукта, БД, провайдеры и deployment не запускались. Companion
исходники не форматировались в этом PR; issue42 пока не закрыт.

## Проверенные API

Prettier API асинхронен; `filepath` задаёт parser, `resolveConfig` требует явного
`editorconfig:true`, а `getFileInfo` принимает пути игнорирований.
[Официальная документация](https://prettier.io/docs/api).
Поведение сортировки/дедупликации классов описано в
[официальном Tailwind plugin](https://github.com/tailwindlabs/prettier-plugin-tailwindcss).
