# Повтор загрузки теста — source checkpoint

Дата: 22 сентября 2026. Source `70a6a3a7e750c10cb237e54b85feae9f054d63a3`.
Статус: **source checks PASS; actual Student/UI acceptance pending**.
[Контракт](../platform/portal-assessment-retry-operation.md) записан до кода
в `92ff16ae`; независимый precode review `bd45fcf8` одобрил его до реализации.

## Изменение

Ошибка AssessmentRunner теперь хранит операцию start/write/reload в React state.
Отказ чтения предлагает загрузить сохранённую попытку с прежним подтверждением;
редактирование ответов и «Сохранить и выйти» остаются заблокированы до успешного
чтения. Три пары RU/KY строк различают ожидание загрузки, её отказ и запрет выхода.
Успешное чтение также снимает устаревшее уведомление о заблокированном переходе.

Pending request UUID, expected revision, answers snapshot и complete flag не
изменены. Write retry вызывает прежний write() без нового флага; pending request
определяет сохранение или завершение. Confirm остаётся до изменения busy/error;
отмена ничего не сбрасывает. Actions, RPC, SQL, Auth/RLS, другие runners,
серверная оценка, визуальные классы и токены не изменялись.

## Выполненные проверки

Все команды проверки выполнены с Node 22.23.1 на исходниках, затем сохранённых
в `70a6a3a7`; повторные запуски без изменения причины не выполнялись.

- До исправления адресная regression: 2 PASS / 5 FAIL. Конкретный старый дефект
  воспроизведён локальным JSX: вместо «Загрузить сохранённую попытку» выбиралось
  «Повторить сохранение». Остальные FAIL отмечали отсутствующие новые guards и
  operation/copy. CFW `01a0c69106c77cc2a3ff505a88626dc9`.
- `node --conditions=react-server --test --experimental-strip-types tests/portal-assessment-retry.test.mjs tests/student-assessments.test.mjs tests/portal-i18n.test.mjs`
  — **25/25 PASS**. Семь новых проверок, десять assessment и восемь i18n.
  CFW `01a0c69269b475d0bb27e65adcc76454`.
- `node node_modules/eslint/bin/eslint.js src/components/portal/tests/AssessmentRunner.tsx src/lib/portal/i18n.ts tests/portal-assessment-retry.test.mjs tests/student-assessments.test.mjs`
  — PASS, exit 0. CFW `01a0c6927176733393e88a9a819ecbf0`.
- `node node_modules/next/dist/bin/next typegen`, затем
  `node node_modules/typescript/bin/tsc --noEmit --incremental false` — PASS,
  exit 0. Это генерация типов, не сборка/запуск приложения.
  CFW `01a0c69317127ee18dabe9b882e96e00`.
- `git diff --check` и побайтная сверка полного компонента после исключения
  только заявленных изменений — PASS. Неизменность pending/confirm/autosave
  и прежних success updates проверена отдельно от тестов.
  CFW `01a0c6937f1472e2be33c068f947a9be`.

Новые tests исполняют настоящие локальные выражения JSX и обработчики с простыми
счётчиками команд, без RPC/service substitute. Проверены оба описания отказа
чтения — returned failure и catch, выбор команды, сохранение pending snapshot
включая complete, busy/cancel до любых setters/read, блокировка select/pause,
disabled и наличие RU/KY строк. Эти тесты не исполняют сетевой throw/response,
не монтируют React в браузере и не доказывают реальный Student/Auth/DB путь.

## Сохранённые ограничения среды

Первый запуск проверки остановился на отсутствующем TypeScript в оборванной
установке зависимостей после disk-full; это не regression-результат.
CFW `01a0c69096a27631824478122f080237`. Повторного npm ci не было:
использован существующий успешно установленный node_modules ветки native logout
с побайтно одинаковым package-lock. Незавершённая установка не объявлена успешной.

Первый объединённый запуск без `--conditions=react-server` прошёл новые/i18n
проверки, но assessment suite не загрузилась из-за server-only. После выбора
существующего в проекте server condition весь адресный набор прошёл.
CFW исходного отказа `01a0c691cd73707183b48f980ea1073a`.

Первый TypeScript в новом worktree не имел сгенерированных Next image declarations
и сообщил TS2307 для существующего evo-logo.png. Файл присутствует; штатный
`next typegen` восстановил декларации, затем tsc прошёл. Исходный отказ сохранён:
CFW `01a0c6928a6f7420bdcc423c2e083286`. Продуктовый обход типов не добавлялся.
Существующее предупреждение Node MODULE_TYPELESS_PACKAGE_JSON не исправлялось.

## Что ещё не проверено

Нет новой сборки, локального сервера, браузерного сценария, Student/Auth/DB
операций, screenshots, KY layout, native или production проверки. Общая QA
остаётся у координатора и соседних задач. Нужны независимое source review,
protected CI и отдельное согласованное actual окно. PR остаётся draft;
пункт 24 и весь план 1–36 не завершены.
