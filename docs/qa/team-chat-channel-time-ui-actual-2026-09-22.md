# A15 / #1030 — фактическая проверка времени каналов и закрытие QA

22 сентября 2026: ограниченный прогон в изолированной локальной QA принят
независимым ревью `APPROVED_ACTUAL_UI_AND_CLOSURE`, затем ROOT принял ресурс.
Итоговый handoff: `PASS`, `released:true`, следующий владелец ROOT,
назначенное окно `ROOT1031_CALENDAR_COMBINED`. Собственные ресурсы A закрыты.
Это техническая приёмка видимого времени каналов по [плану](../EVO_TEAM_CHAT_CHANNEL_TIME_UI_PLAN_2026-09-22.md).

## Исходники и повторное использование проверок

Фактически запускался чистый `c1fcda9b558a5329693d3e024e07f7f519bdf16e`,
реализация `4e434eee1d91ed3d4f3b7cbe4e7bbc0ff8042d5b`, схема `001–239`.
[Source receipt](team-chat-channel-time-ui-source-2026-09-22.md): 7/7 тестов
форматтера, scoped ESLint, typegen и TypeScript PASS; прежние 43 reader-теста
не повторялись. Source review `449fa0fc…` и успешный
[CI 35676395214](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35676395214)
на `c1fcda9b` переиспользованы; пять jobs success, три scope-skip.
В ветку PR интегрирован main `ac165cf992ea418c2a11745590a5dadb443e9d6f` коммитом
`c2157ae243a6f07af9afd57e80c0ee0cbb84925d`: все четыре файла кода/тестов A
побайтно равны фактически проверенному источнику, входящие изменения календаря
сохранены из main. Финальное интеграционное ревью, CI и merge
[PR #1030](https://github.com/izzhackt/evo_AI_CRM/pull/1030) эта ведомость не подтверждает.

## Исходный STOP и отдельное разрешение v3

Первый readonly BEFORE `cc827a8c…` установил 51 потенциальную новую отметку
прочтения в объединении latest50 и контекста 25-before + anchor + 24-after.
При `allowedSeenIds=[]` получен корректный `STOP_ZERO_SEEN_ELIGIBILITY`
`56925439…`; независимое ревью `73b02f62…` сохранено без пересмотра результата.
Предшествующая совместимость v2 (`9eef9237…`) сопоставила реальные поля
входящего handoff и происхождение snapshot SQL, не добавляя вымышленных полей.

ROOT отдельно разрешил v3: ровно вычисленные 51 eligible-minus-existing ID,
только обычные добавления seen для существующего Admin в General своей
организации; все старые строки неизменны, другие бизнес-записи запрещены.
Source/concrete binding review `e4d38405…` проверило полный список независимо.
Сохранённый BEFORE повторно использован побайтно; новый BEFORE не запускался.
Baseline observer `d1f2bec1…` отделён от нового observer AFTER/FINAL.
Фикстуры, предварительная разметка seen и подавление штатного поведения не применялись.

## Один фактический UI-прогон

Один обычный Admin login, один batch, три исходных PNG: **390 → 320 → 1440**.
На всех ширинах совпали разрешённые каналы, ссылки, выбор, preview и unread
51/1/0; время General/Sales совпало с независимым UTC6/Asia/Bishkek oracle,
у пустого Admissions времени нет. Полный год/offset доступны в title/srOnly
и AX; время не добавляет отдельную точку фокуса. Видимые метки — `dd.MM HH:mm`.
Независимый reviewer просмотрел все три PNG и сверил DOM/AX/геометрию:
переполнения и пересечений нет, цели больше 44px, время 13px/tabular/nowrap,
контраст **5.625:1 и 6.385:1**. На 390/320 полные имена каналов видны.
На desktop rail **288px** название Sales визуально «Прода…» — предусмотренное
ellipsis; полное «Продажи» остаётся в DOM/AX. Полное визуальное имя не заявляется.
Один клавиатурный сценарий проверил Enter/Back, собственный неотправленный
черновик, существующий поиск/контекст и сохранение черновика при переходах;
собственный черновик очищен. Запросы завершены, chat размонтирован до AFTER.
Все пять CLI-шагов PASS/exit0, повторов нет; UI уложился в бюджет 240 секунд.

## Данные и закрытие собственных ресурсов

Независимо сопоставлены исходные объекты BEFORE / AFTER / FINAL: все **290**
бизнес-таблиц, scope, canonical, catalog и реестр `001–239` полностью равны.
Фактически добавлено **0 seen**; unread/firstUnread пересчитаны независимо.
Все **33** Auth/Storage ключа сохранены, посторонние данные неизменны.

| Auth-проекция | BEFORE | AFTER UI | FINAL |
| --- | ---: | ---: | ---: |
| Sessions | 224 | 225 | 224 |
| Refresh tokens | 239 | 240 | 239 |
| AMR claims | 224 | 225 | 224 |

Все унаследованные строки восстановлены точно; добавлены лишь собственные
login/logout audit-записи. Stable fingerprints пользователей неизменны;
разрешены только собственные sign-in/update timestamps. Local logout **204**,
собственный browser закрыт, один SIGTERM своей группе, launcher реально reap
с exit0; группа отсутствует, соединение отклонено `ECONNREFUSED`.
Пригодность порта для повторного bind не заявляется. Собственный Auth capture
удалён по отдельной проверенной квитанции; финальные эффекты равны BEFORE.

## Закреплённые доказательства

Полные исходники доказательств хранятся в приватном пакете A1030 v3.
Здесь только имена и SHA-256; содержимое переписки, учётные данные и ID исключены.
`actual-summary` и candidate остаются историческими записями до review/release;
окончательные принятие и передача подтверждены отдельными review и ROOT handoff.

| Артефакт | SHA-256 |
| --- | --- |
| Source review | `449fa0fc9bf64f7d0e378898ea83786d32516878a1aea9f7ae44100c4ae6d89b` |
| Исходный eligibility STOP | `56925439007f09763ea9f7c73e6953f872a9efbaddc2728faf33718ad255d2c6` |
| Readonly STOP review | `73b02f62263e1895d2375f358374655e48bd1bc0b230148168ea7d91b76eb7fe` |
| v3 source/binding review | `e4d384057e5dbe19538c4c40cfdf189a423b779b8e58efe44672def4650e02d0` |
| before.json | `cc827a8c17c530febfe7f99918c4122f544658e73be01db871df76f474ceebaa` |
| after-ui.json | `0373479471baf6dbc5dfd22115ceb739fd9410c36baa86ab8c6d19b42fdfbff4` |
| final.json | `8dc5291259b352173c6a9d52bb25bf78c2cf139f7e8346ceb5a1610167e308db` |
| final-verification.json | `20cab1a4817dfe87ee9a6852d934d8241ed5761955cbbf2c66cc075003171cd0` |
| batch-result.json | `a1334ee29b7cd76bea5ea0362d47aee3efd666d8807a8f377c17a4e3bd9f0d38` |
| actual-summary.json | `6b9d6c9ad396e77370c5779454b321f9ee6a4f13d9b75d44e172e043a3d9c2a5` |
| channel-time-390.png | `85bad7cd2461ddbec6df84b922be7c69ae698a51c0f92ce0eda7b80bee8ccee3` |
| channel-time-320.png | `bac4b56fbdb7e43db6779295bfd8325b921f609e97d3e6f775cdfd2649d76c21` |
| channel-time-1440.png | `3bf6fad5144ed29ab03fa5f93b4ecb216efaf8a9f2560ad4e44cdbef209c574e` |
| Independent actual/closure review | `669af3dcde6748b74d7b001074723cc6f9355a80accbf3e1e23c7f4358154928` |
| ROOT handoff-root1031.json | `d21f93bc4d85c176116c275b510730d4328714519c2233819d908f7718845697` |

## Границы результата

Ноль новых seen не доказывает новое исполнение writer или видимость всех 51 тел.
Не создавались варианты старого года, собственного автора, tombstone, reply или
длинного latest-body. Полный screen-reader, native, production, employee #708,
другие роли и весь item15 не приняты. DOM/AX и визуальное ревью — предел этой
accessibility-проверки. Исходный STOP остаётся действительным при своей политике.
