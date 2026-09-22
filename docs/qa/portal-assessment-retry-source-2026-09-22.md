# Повтор загрузки теста — source checkpoint

> Разделы source checkpoint ниже — историческая запись до браузерного окна.
> Актуальное локальное прохождение и его ограничения добавлены в конце файла.

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


## Actual checkpoint — 22 сентября 2026, controlled local development

Фактический product source — `ba9204ec993a54de6e46da96b388728bc9e00898`,
Node22.23.1. ROOT отдельно разрешил обычный Next development `--webpack` на
собственном loopback HTTP после того, как production-конфигурационный guard
отклонил local HTTP до Auth. Guard не ослаблялся; production canonical build
`FEgfVkbA2tdSyuxSyWHLR` сохранён и остаётся отдельным доказательством сборки.
Этот actual не выполнялся в production runtime и не доказывает production
acceptance, хотя проверял тот же изменённый AssessmentRunner.

Обычный существующий Student прошёл форму входа и один Start опубликованного
RU English36. Реальный ответ UI и DB подтвердили одну новую blank draft r1.
В двух документах той же попытки первый выбор A вызвал обычный autosave;
единственная принятая запись дала r2 и один ответ. Другой выбор B с прежней
revision вызвал stale conflict. Ответы, вопрос, actor и credential values
остались в частных доказательствах и не публикуются здесь.

При offline подтверждённая загрузка сохранённой попытки отказала. Локальный
выбор B сохранился, radios остались disabled, отображалась ошибка загрузки.
Отмена следующего confirm не отправила POST. После online подтверждённый read
вернул принятый ответ A; UI снял ошибку и восстановил доступность radios.
Это реальный UI/Server Action/DB путь, а не RPC substitute или mock response.

Суммарно: login1, Start1, save2 attempted, read2 attempted, один accepted save,
Complete0; итоговая draft r2 содержит один ответ. Notification requests:
16 к завершению retry,21 к closure. `start-verified.json` записан08:15:51Z,
`retry-verified.json`08:15:58Z. Последний фиксирует `offlineReadFailed:true`,
`cancelSentNoPost:true`, `onlineReadReconciled:true`, `completeCount:0`.

### Closure и сохранённые ограничения

Own session закрыта обычным local logout с HTTP204. Оба документа стали inert,
cookies отсутствовали, browser отключён; incumbent sessions/refresh/AMR
сохранены, добавлены только собственные login/logout Auth audits. Auth/browser
receipt08:17:09Z: `OWN_AUTH_AND_BROWSER_CLOSED`. Собственные development server
process groups закрыты; окончательная webpack server receipt08:17:58Z.
Final snapshot сохранён. Независимый review `52aa4535` завершён **PASS**:
`APPROVED_LOCAL_DEV_CHANGED_PATH_AND_OWN_CLOSURE`. Проверены полный actual delta,
сохранение остальных business/Storage/incumbent Auth и собственная closure;
ограничения ниже остаются в силе.

В отличие от исходного frozen production observer, этот проход использовал
controlled route continue/abort с `/_next/static/*` и точными Next dev font/HMR
исключениями. Это отдельная ограниченная dev-проверка изменённой функции,
не выполнение frozen passive70-shape production protocol. Полный login→closure
занял около6 минут после pre-Start font/hydration диагностики; только
retryStarted→complete уложился в180 секунд. Нельзя приписывать всему окну
исходный180s limit или считать повторный hydration readiness product retry.

Исходные readiness/initialize/exercise STOP и pre-Start recovery evidence
сохранены: до принятого Start mutation не было. Они не заменены на PASS.
Production HTTP guard сохранил отказ до Auth; обычный dev Auth выполнен позднее
по отдельному разрешению. Direct disabled radios проверены. Кнопка
«Сохранить и выйти» защищена рассмотренным source guard, но напрямую этим actual
не проверялась. KY runtime/layout, native, VoiceOver, uncertain write/complete,
production и весь пункт24 этим сценарием не приняты.

Частный receipt root: `/private/tmp/evo-assessment-start-post209-execution-20260922/dev-runtime`.
В публичном репозитории сохранены только безопасные refs и SHA-256:

| Evidence | SHA-256 |
| --- | --- |
| `start-verified.json` | `b16cb4e879845e52979ccaaed3e268b4f11908a27fe9eaf58bb8538c112c2126` |
| `retry-verified.json` | `b9fc5ba78fcef61c3d7110b19486e59cc76168ca912f777cb93927103e51941d` |
| `final-snapshot.json` | `1167e2687d1f556f52a4f99dc415f4f9423831e88a765b478e5c17527d907153` |
| `closure.json` | `e031c3a71b6b8d7be869ea71027c14648209ed7f57f7f268f38316c403a796bf` |
| `webpack-server/closed.json` | `7172a28f967c95310e6f0e2212f6d1c38f1b0271d85a2523c93886ac2819d348` |
| Original canonical build receipt | `fcf47456934625e12b487ea3d4e83b31841d5a83a01936c410cbd8ff08e74e14` |
| Independent actual review JSON | `52aa453574b6301c9315aa72bae8f7c3dac605538353af3bbbf906afd0ae36b5` |
| Independent actual review report | `d3f129b837c4455a5681234744bd10fa639eb7a3cc6a7921574509643070be26` |

Independent review root: `/private/tmp/evo-assessment-start-post209-actual-review-20260922`;
verdict относится к локальному dev changed path и own closure, не production.

### Интеграция и повторное использование проверок

Main `83c2e54fb7a0e572286c99c287cd093b9e7bfe6a` интегрирован после actual.
AssessmentRunner, i18n, оба изменённых assessment tests, связанные actions/
contract/source/exit guard и dependencies не изменились относительно `ba9204ec`.
Прежние25/25, scoped lint, typegen/tsc, canonical build и protected CI35673640450
на ba920 переиспользуются с исходной provenance; это не новые запуски на merge
head. Docs diff и сохранение обеих append-history проверяются отдельно.
Финальный exact-head review, новый protected CI и ROOT merge остаются отдельными
шагами; автор интеграции не запускает ещё один actual и не сливает PR.
