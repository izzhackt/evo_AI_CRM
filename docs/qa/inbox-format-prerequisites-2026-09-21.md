# Issue 42 — подтверждённые prerequisites форматирования

Контракт до кода: `72bfc244`, уточнение browser-upload boundary `f38acff0`.
Base: `79624c2f821b9aa9082108eb8d9684d37db41179` (main после #947).

## Что обнаружил реальный прогон

Первый mechanical pass существующего locked Prettier изменил 347 файлов.
Он сохранён отдельно, `096d7cc9`, и не входит в этот PR.
`format:check` выявил два нестабильных после первого прохода файла:
`src/components/pipelines/deal-form.tsx` и `src/lib/automations/engine.ts`.
Оба меняются на первом и втором проходах; третий, четвёртый и пятый уже дают
одинаковые байты. Меняется разбиение chained insert/upsert expressions.

Полный существующий companion suite после первого прохода: 842 tests,
836 PASS / 6 FAIL. Сравнение трёх затронутых тестовых файлов с неизменённым
base: 50 tests, 47 PASS / 3 FAIL. Три прежних падения относятся к retired
Inbox edge route, историческому migration tail 105 и старому списку buckets.
Ещё три после форматирования зависят от конкретного вида кавычек.
Это исходные offline unit tests с их прежними mocks, не provider acceptance.

## Изменение

Verifier теперь требует точный стабильный результат существующего форматтера:
не более трёх преобразований и обязательный подтверждающий проход без изменений.
Нестабильность сверх предела — отказ. Конфигурация, версии, plugins, exclusions,
scope/mode/symlink/rename guards из #947 сохранены. Совпадение с форматтером
не заменяет независимый semantic review последующего mechanical PR.

Ровно три существующих тестовых файла получили минимальные исправления:

- Положительные и отрицательные assertions на навигацию, standalone output
  и bounded logging проверяют те же значения при обоих видах кавычек.
- Shared Caddy проверяется на текущие crm/app routes и отсутствие retired Inbox
  route; private ports/networks, secrets redaction и companion boundaries сохранены.
- Историческая migration 105 должна присутствовать; содержательные containment
  assertions сохранены. Актуальный full ledger проверяется root migration checks.
- Перечень private buckets соответствует четырём существующим объявлениям;
  добавлены точные проверки приватности, MIME и limits exports/company files.
  Существующие upload/signing/access assertions не изменены.

Отдельный CI flag разрешает maintenance только этих трёх существующих файлов
со статусом M. Их 50 legacy tests обязательны; selected job не может быть skipped,
cancelled или failed. Обычный dependency lane сохраняет прежние три pure helpers.
Formatter lane по-прежнему требует byte proof и полный legacy suite.

## Проверки этого PR

- Node 22.23.1, dependencies из прежнего lockfile с `--ignore-scripts`.
- Три исправленных legacy test files: **50/50 PASS**.
- Classifier, реальный временный Git и locked Prettier: **40/40 PASS**, включая
  реальные два formatter inputs, semantic/config/mode/rename/symlink rejection.
- Workflow assertions и фактическое исполнение обязательного bash gate:
  **3/3 PASS**, в том числе missing/failed/cancelled/skipped selection outcomes.
- Scoped ESLint, YAML parse (`js-yaml`) и `git diff --check`: PASS.
  Первоначальный ручной YAML helper использовал отсутствующий пакет `yaml`;
  заменён на установленный `js-yaml`, продуктовые зависимости не менялись.

Полный companion suite и пять checks будут повторены на окончательном mechanical
diff после этого prerequisite. Здесь нет runtime, migration, access policy,
provider, managed database или deployment changes; issue 42 ещё не закрыт.
