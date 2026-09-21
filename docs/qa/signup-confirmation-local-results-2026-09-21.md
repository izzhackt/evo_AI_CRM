# Item27c — фактическая локальная web/API QA, 21 сентября2026

Статус: выполнена ограниченная A/B QA в изолированном локальном Supabase/Mailpit.
Это техническое подтверждение перечисленных путей, не production/provider или native UI acceptance.
Draft PR#980 остаётся несмёрженным до требуемой native-приёмки и окончательного review.

## Исходники и границы

Начало Auth/web сценария: `5bde6c7e9adea6f24e3d988b3fb99b5a4fdbbdfc`.
Продолжение после исправления отображения: `428b68551506577959d3b590696bc3dd143a003c`.
428b меняет только web presentation восстановленного pending; Auth/backend/native DTO не менялись.
Начальные наблюдения5bde не выдаются за повторную проверку428b.
Интеграция main в182b0d28 затронула только документацию; runtime совпадает
с428b побайтно. Полный прогон на182b0d28 повторно не запускался.
ROOT единолично координировал окно; использованы разрешённые собственные QA identities A/B.
Owner=NULL и intake enabled=true сохранялись. NativeC не создавался.

## Реально пройдено

| Путь | Наблюдение |
|---|---|
| A, настоящий web `/apply` | Регистрация создала1 неподтверждённую Auth identity и её legacy account/profile, без application/session; письмо принято локальным Mailpit |
| Pending/refresh | Черновик анкеты сохранён в metadata, пароль очищен; refresh не создаёт аккаунт и не отправляет письмо |
| Восстановление pending | Найдено ложное unknown-сообщение при SSR restore;428b отделяет нейтральное ожидание от результата отправки. Реальный refresh нейтрален, явный resend показывает accepted |
| Повторные письма A | Начальное+4 ручных resend дали5 писем; шестой reserve отклонён с сообщением о лимите без нового письма. Отказанный reserve учитывается как изменение quota, не zero-write |
| Native registration API B | Настоящий endpoint вернул202 с шестью предусмотренными полями; B остался неподтверждённым, без application. Это API, не iPhone UI |
| Старый native transport | Отсутствующий/старый flow header дал426 до create/quota/mail |
| Перекрёстное подтверждение | Cap A с отличающимся настоящим OTP B отклонён; identities не подтверждены этим запросом |
| Чужая текущая сессия | Подтверждение из существующей Sales-сессии отклонено; три Auth cookies до/после побайтно совпали |
| Последнее письмо A | Явное подтверждение привело в `/apply/status`; создана ровно1 application и1 submit receipt, metadata draft очищен |
| Повтор ссылки | В той же сессии нет повторной application; после выхода — sign-in-required, без новой сессии/заявки |
| Confirmed A resend |200/confirmed, без quota/mail |
| Существующий owned Student duplicate |409/conflict, без изменения существующей Auth identity |

При owner=NULL не создавались canonical client/lead/case/staff membership.
Сохранены2 технические Auth identities с2 legacy accounts/profiles,1 application/receipt и6 писем (A5+B1).
Quota сверялась по фактическим reserve, счётчикам и допустимым TTL-удалениям; весь quota-раздел не исключался из контроля.
Accounts/mail/application не удалялись, reset/cleanup не выполнялись.

## Impeccable и восстановление окружения

Сохранены EVO/Golos и существующая композиция. Исправление428b не заявляет доставку письма;
реальный результат resend не скрывается нейтральным восстановленным состоянием.
Снимок настоящего pending390×844 независимо просмотрен: материальных визуальных замечаний нет.
Это не проверка других размеров/тем, screen reader или native UI.

Auth overlay восстановлен: исходный контейнер, Config/HostConfig/mounts/aliases и health проверены,
restore receipt PASS. Invite сохранён. Несекретный confirmation template намеренно оставлен в Kong;
восстановленный Auth больше на него не ссылается. Удаление template не заявляется.
Последний observer после restore не обнаружил новых изменений full state, таблиц, partitions,
schema/configuration или quota относительно предыдущего снимка.
Независимая сверка24 снимков завершена: ожидаемые изменения только limits,
applications и receipts;278 остальных business tables, schema/functions/ledger
сохранены. Старые бизнес-партиции неизменны; обычный Sales login отдельно
изменил Auth metadata, его session/refresh после logout вернулись к прежним hashes.
Локальное окно освобождено для224; `root-release.json` хранит новый baseline.
Исходные CAPTURED receipts сохранены, результат их сверки записан отдельно.

## Ограничения и сохранённые остановки

- Mac заблокирован: iPhone pending/resend/возврат в приложение не проверены, C отложен.
- Настоящее истечение24 часов и owned-invite negative не выполнены.
- Managed/production SMTP/Resend, внешняя доставка и caches не проверены.
- Полная сверка Auth audit data не покрыта; обычные sessions/refresh-token эффекты не объявляются неизменными.
- Первая tooling capture перекрёстной ссылки до hydration захватила локальный cap A с неправильным OTP B. Значения не воспроизводятся. Это ограничение приватности QA-capture, поэтому общей гарантии отсутствия чувствительных данных во всех tooling artifacts нет.
- Последняя отдельная проверка собственных Next server logs не нашла actual cap/OTP или callback fragment; это утверждение ограничено этими логами.
- Первоначальный launcher STOP из-за ошибочного предположения об Aliases сохранён; app тогда не стартовал. Исправленный guard сравнивает точные Aliases и проверяет имя в DNSNames.
- Mailpit response-shape STOP сохранён; корректировка наблюдателя не сопровождалась дополнительной отправкой.

## Приватные доказательства

Файлы содержат закрытые QA evidence и не являются runtime/CI зависимостью. В Git переносится только этот отчёт без identities, cookies, cap/OTP и тел писем.

| Receipt/артефакт | SHA-256 |
|---|---|
| `final-web-qa-reconciliation.json` | `4347c71a99bd779ca1b3f358e1b53551ea7f5deaf8e1e34eee4630cccb1a79c9` |
| `root-release.json` | `0d7622346c4c5bee2d5f1e00d71b3c39da4214c52a8d1ba511586181f22e8707` |
| `after-auth-restore.json` | `2f126bae88b2ae5f9e751eb0018fdcdaa79a60ab4b46c5dc60c7028bceff299e` |
| `after-confirm.json` | `d7e459cf48cc6385f84c4fcff8dd85451173d9698943ff31dbd11d244c079936` |
| `after-quota-denial.json` | `2a89e2f33fde3c4772bf177ea8dda2c32cc363cc2fbf95570c104ca511ebd136` |
| `foreign-cookie-parity.json` | `77fa25c697ab71e7780f17f5f3644bb2d2822e3afe1a9a7892d4f740a7dfc1d8` |
| `callback-log-scan.json` | `a2fe64f21a23ef6f9f09d2d5fdc1544d2dbce6b60f86edcbf9d8c2f28f5a8b01` |
| `pending-mobile-428b.png` | `cb43159c8a5c2fa6873f175c6388644d17f9bc8b9407f3164155d00f8fbdb99a` |
| `restore-7c49f67fc08e485ca06217e2612a8f3f-restored.json` | `4b5c3c510d5740915dd2541bea0c02e484ce0a5cf24bcc09a99ebc98e42cffaa` |
