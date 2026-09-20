# Issue 42 / пункт 35 — нормализация форматирования Inbox

Base: `a878091e0933bc21b40f310a7efaea2f466b0d8b` (после prerequisites #947/#949).
Mechanical source: `8ad555a7323e151a2bbee8244c9b74b89dfb8020`.
347 существующих файлов companion; generated/vendor assets, исключения,
зависимости и конфигурация форматтера сохранены. Runtime/provider/schema/product/
deployment behavior не изменяется. Root CRM и Lead Agent не форматируются.

## Проверка

Node **22.23.1**, прежние lockfiles, Prettier **3.9.1**:

- `npm run format:check` — PASS.
- `npm run lint` — PASS, 0 errors / 11 прежних warnings.
- `npm run typecheck` — PASS.
- `npm test` — **842/842 PASS**, 94 файла. Это прежний offline legacy suite с
  прежними mocks, не реальный Supabase/WhatsApp/provider или customer acceptance.
- `npm run build` — PASS, включая knowledge importer bundle.
- Frozen-base byte proof — **347/347** совпадают с ограниченным стабильным
  результатом прежнего locked formatter. Git diff check — PASS.

Первый mechanical pass сохранён коммитом `096d7cc9`. После отдельного исправления
legacy contracts в #949 две цепочки вызовов потребовали второй проход; следующий
`format:check` успешен. Попытка ручного verifier с символическим `HEAD` была
отклонена guard; указанные выше результаты получены с полными immutable SHA.

## Дополнительная проверка семантики

Временный аналитический helper сравнил TS-transpiled/Babel AST для 338 JS/TS/TSX
файлов. Удалены позиции/комментарии, пустые statements и объединены только
соседние строковые JSX children. Для 236 файлов деревья равны; в 102 остаются
1030 перестановок строковых токенов, вызванных сортировкой классов. Этот helper
помогает независимому review, но не доказывает полную эквивалентность типов,
CSS или React behavior. Независимый semantic-diff review остаётся обязательным.

Пять YAML-файлов дают идентичные parsed objects. В трёх Markdown-файлах только
пустая строка и выравнивание таблиц; в одном `.d.ts` только вид кавычек.
Настройки, package/lockfiles и migrations не входят в mechanical diff.

Credentials, provider calls, production data, DNS и deployment не затрагивались.
Полная продуктовая приёмка и публикация приложения не заявляются.

GitHub преждевременно закрыл issue при merge #947 из-за распознанной фразы
`does not close` перед номером. Описание исправлено, issue восстановлен до
завершения actual formatting PR; состояние tracker не использовано как proof.
