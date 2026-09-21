# Общая строка времени и действий — actual local QA

Статус: один ограниченный UI batch и строгое закрытие PASS; независимая
actual/closure приёмка одобрена. Финальные integration review/CI/merge ожидаются.
Это сохранённые технические QA сообщения; не приёмка реальным сотрудником,
не весь item15 и не production.

## Привязка и выполненная проверка

Actual source `2f467e5bccdb2cffd387053cb07c64182ca19c53`, product `30f8fa3f`,
base #1012/main7faa4748. Source reviewf6f7662e и CI35632967748 (5 PASS/3 scope SKIP)
пройдены до окна. Incoming ROOT22G release77a63714, schema001–235; observer
reviewd7fe6691 и отдельный GO, затем bound UI revieweb76d586 и отдельный GO.

Fresh before e6e19b46 подтвердил полное совпадение состояния с incoming release:
290 business/33 AuthStorage. Существующий активный ordinary staff, не system Admin;
64 собственных сообщения, пара15/16 и3deleted rows. allowedSeenIds=[] получен
из fresh scope. Новых аккаунтов, сообщений, fixtures, save/edit/delete/upload нет.

Один фиксированный batch на1440/390/320, без correction/confirmation:

- Имя первой fetched строки и highlighted target видно; повторный автор
  остаётся в accessibility snapshot. Одно видимое время каждой реплики теперь
  находится рядом с действиями. Body16px, controls не меньше44px, один composer,
  без document/footer overflow. Меню проверено открытым на каждой ширине.
- Reply88.25×44, menu44×44, link55.71875×44; Tab/Enter достигают menu и permalink.
  Ответ создаёт прежнюю composer quote; снятие цитаты сохраняет несохранённый
  текст. Реальный permalink открывает полный target и выполнен последним.
- Prepend сохраняет открытый DOM details и anchor111.390625→110.984375px
  (сдвиг0.40625px в пределах2px). Фокус menu через prepend не заявляется:
  активация кнопки догрузки намеренно меняет фокус.
- Search→context→Back сохраняет диапазон, draft и offset−70.8125px до/после.
  Draft переживает resize и восстановлен до собственного исходного пустого значения.
- Три PNG просмотрены одной группой. Верхняя частично обрезанная строка —
  выбранная позиция прокрутки; first fetched author не означает sticky author.
  Видимый outline menu на мобильных кадрах — клавиатурный focus, не дефект.

## Сравнение плотности на одинаковых входных данных

Исторический batch #1012 source6e401f9c/c27160e7 и новая fresh пара совпадают
по ordered row hashes/projections. Не менялись body/quote/mentions, окружающий CSS,
остальные src/public/package inputs. Одинаковы viewport height1000, ширины,
24px целевое положение пары, точный draft text и закрытые search/menu/quote
при измерении. Proofae139005 фиксирует сравнимость; это не новый прогон старой версии.

| Viewport | Высота каждой строки до | После | Разница | Полных строк до → после |
|---|---:|---:|---:|---:|
|1440×1000|112.1875px|94.796875px|−17.390625px|6 → 7|
|390×1000|136.984375px|119.59375px|−17.390625px|4 → 5|
|320×1000|161.78125px|144.390625px|−17.390625px|4 → 4|

Результат относится только к этому сохранённому участку и указанной геометрии.
Общий процент улучшения всего чата не заявляется. Другие варианты сообщения могут
переносить footer; факт сохранения44px/time/overflow проверен в доступном наборе.

## Закрытие и данные

Raw after f2059342 без intermediate Auth PASS → собственный scope=local logout204
→ browser close → остановка только33258/PID55820/55798/PG55782 → final c9d5e401
и strict verifier6cf2902f PASS. Все290 business tables/state/catalog/effects
неизменны, zero seen/Storage changes. Сохранены431 входящих Auth audits,
224 sessions/239 refresh/224 AMR,8пользователей и все stable поля; только
собственные last_sign_in_at/updated_at и2собственных login/logout audits допустимы.

Own captured Auth удалён только после strict success. Процессы/порт отсутствуют,
browser закрыт; user33216/PID76071 продолжает слушать и не останавливался.
Launcher завершён намеренным Ctrl-C с exit1; не выдаётся за exit0.
Release7ca6c43a передан ROOT_COORDINATOR, runtime A закрыт. Его immutable
productAcceptance=false отражает ожидание независимого review на момент передачи.

Первый readiness STOP случился до Docker inspect/SQL: DOCKER_HOST мешал проверять
имя текущего context. Исправлен только env команды context show, сохранив pinned
socket/container/network/epoch; без смены context/restart. Также сохранена ошибка
локального разбора snapshot: helper возвращал inline aria JSON, а читатель ожидал
путьYAML. Использован уже сохранённый inline результат; UI batch/snapshot не
повторялись. Сам reviewed UI batch завершился PASS.

## Ограничения

Нет foreign messages/аватара/нового seen. Edited, mentions, stored quote отдельно
не проверялись; composer quote проверена. Нет actual firstUnread, native/VoiceOver,
превью всех каналов или production. По плану выполняется ровно этот двухфайловый
срез. Более поздний main не был интегрирован в работающую QA-версию.

## Артефакты

Private packet `/private/tmp/evo-team-chat1014-local-20260921`; исходные данные
и снимки остаются вне публичного репозитория.

| Артефакт | SHA256 |
|---|---|
| `observer-binding.json` | `169c75c6a2169bdde62674e8ca98e9a369202c0ee5944b27adbfbc197f64c28d` |
| `qa-binding.json` | `2294ff9466f535e8c66d243642299a8f26c54c1f62680a00853932251a0f3d32` |
| `same-input-comparison.json` | `ae139005555253a49949f2a09656d4b696ef6e30677a6f55f4a5745064ac93a9` |
| `ui-service-row.js` | `6ccdb84aaf6afeefd53b690b7cb7be2536e42200e444dad46f630579dca8e60f` |
| `ui-proof/before.json` | `e6e19b46ebc84c63343d348963bfdfe555f818049d1517b166383e6b55149d11` |
| `ui-proof/after-ui.json` | `f20593426bc8e66ed409af92736b03275f68a4ce8df0d760885b02e68dfae280` |
| `ui-proof/final.json` | `c9d5e401257081408e28eb40ca8527c45db5941d5825b060885597d87185e042` |
| `ui-proof/final-verification.json` | `6cf2902f64d5c21cf21866e6f39f06aeb8256ca2a7b1cc7e1ba6fd39481b1029` |
| `ui-proof/batch-result.json` | `c09ec1a43f5d7d9ba8bc8c48866c132f4701d361162207cc6da6a0ecfc833ac2` |
| `ui-proof/service-row-1440.png` | `247920bc0273d191db47f398d15282e3da775f0cccb5973fc84d9837871b8043` |
| `ui-proof/service-row-390.png` | `bf1a5c5fb7323db28a5c9651ecf03cb77a50c32d7fbd74b624beb8ad6db461a0` |
| `ui-proof/service-row-320.png` | `1817bb845f618c583c6b949578c35961250f65d95c4e2a22b203992fcc2b1b15` |
| `ui-proof/server-closure.json` | `9346747a24ec9b3d6fce4bfe42f163e13896acf74d4fcffc74999ddece5e5a67` |
| `ui-proof/sales-logout.json` | `602d743ee52d6d37f8c5d923a9214717be1d27121eb02fd591a46d3fc99692f4` |
| `ui-proof/auth-file-removal.json` | `4b0a164bde3a68a15173779a8e5065fd49d55dcd0cb0d42abed77be82138ccd4` |
| `release-receipt.json` | `7ca6c43acb21e32bcb799c087537f59298b38c31b9ccb974c2e26bbaf2cc5205` |

## Независимая приёмка и интеграция main

APPROVED_SCOPED_ACTUAL_AND_CLOSURE принято для exact actual2f467e5b:
`/private/tmp/evo-team-chat1014-actual-review-20260921.md`, SHA256
`a76c16a6415c79f6bfb0b0bbef4bcd0c691d51874b48c3acc25fdb5595904a20`.
Reviewer отдельно сравнил full before/final и release projections, все ссылки
на hashes,431 inherited audits,8 users,224/239/224 sessions/refresh/AMR; просмотрел
три сохранённых PNG одной группой. ROOT также просмотрел эту группу. Нового runtime
или дополнительного visual pass не было. Immutable release не переписывался.

После closure интегрирован main `59a726b53217d816a40e1653fe57b544368e7134`
(#1006 и #1010), merge commit `4f33577f`. Конфликты только в текущей ведомости
и двух append-only журналах; обе родительские истории сохранены в прежнем порядке.
Вся папка team-chat и helper остаются побайтно равны actual2f467e5b. Импортированные
DeleteAccountRequest/portal i18n/navigation и navigation test равны main.
Navigation меняет только destinationKey для Sidebar: AppShell/ширины/стили/чат
не менялись; Portal profile не является этим staff flow. Не утверждаем, что
весь product tree равен actual: эти три принятых main-файла отличаются.
Source-проверки не повторялись без изменения проверенного кода; финальные
exact-head integration review и protected CI остаются отдельными gates.
