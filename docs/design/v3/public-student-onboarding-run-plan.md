# Публичная анкета и доступ студента EVO

Дата: 2026-09-18. Статус: выпущено. PR #830 объединён как
`1de14c0ad02b97b5b576060864574ee70e9e8508`, production177 применена,
managed release `v3-r35340641026-a1-1de14c0a` принят. Полный новый Student
signup/approval/relogin доказан локально; production проверен существующими
Auth-аккаунтами и публичной формой без создания нового Student.

## Решение владельца

Структура предоставленных скриншотов: восемь коротких шагов анкеты, затем
создание аккаунта. Оформление — существующий EVO. Владелец отдельно подтвердил:
до одобрения Admissions доступны только собственная анкета и её статус; полный
кабинет открывается после одобрения. Также убрать из настроек и основных экранов
лишний технический/повторяющийся текст, сохраняя нужные действия и ошибки.

Текущее решение: «Без подтверждения email». Сразу после создания аккаунта
сохраняется заявка и открывается «На рассмотрении»; Gmail для этого не нужен.
Проверки ограничены реальным изменённым Auth/RPC/UI-путём и действующими
короткими PR/release controls. Старые результаты не считать приёмкой новой версии.

## Контракт продукта

1. Публичный `/apply` на app.evoadmissions.com; анонимный корень ведёт туда,
   «Уже есть аккаунт» открывает существующий вход. Девять шагов: страны;
   набор/год; образование/оценка/шкала; направления; ступень; гражданство;
   английский (официальный экзамен/результат либо самооценка); годовой бюджет
   обучения USD/источник; имя/фамилия/телефон/email/пароль и согласие на передачу
   анкеты EVO для рассмотрения. Мультивыбор сохраняется полностью. Назад и
   обновление не теряют черновик в текущей вкладке; пароль не сохраняется.
2. Реальная Supabase email/password регистрация без письма подтверждения.
   Public Auth signup остаётся выключенным; глобальные confirmation settings
   не меняются. Серверная action после Origin/валидации и постоянного лимита
   запросов создаёт только НОВУЮ identity через admin.createUser(email_confirm:true),
   затем выполняет обычный password login. Дубликат или неопределённый результат
   создания не разрешает менять/подтверждать/присваивать существующую identity.
   Только живая сессия, повторно прочитанная через Auth, сохраняет заявку.
   Анкета в user_metadata — недоверенный черновик, не источник прав; сервер
   валидирует её и сам определяет uid/email. Auto-confirmed timestamp не
   доказывает владение почтовым ящиком. После записи удаляется только ключ
   черновика. Повторный вход восстанавливает незавершённое сохранение.
   Удалить неопубликованные signup-confirmation UI/action; общий invitation
   callback, staff login и защищённый staff app_metadata marker сохранить.
3. Заявитель видит собственные ответы и «На рассмотрении». Нет Student membership,
   дела, доступа к документам/тестам/каталогу до одобрения. Чужие заявки закрыты.
   Отклонённая заявка показывает понятную причину; исправление/повторная подача
   использует ту же идентичность и контролируемую ревизию.
4. Admissions получает обнаружимую очередь «Заявки» рядом с рабочим списком
   поступления: просмотр ответов, одобрение с назначением действующего куратора
   и направления либо отклонение с причиной. Только Admin/разрешённый Admissions,
   актуальные права и организация проверяются в БД; preview не даёт прав записи.
5. Одобрение атомарно создаёт/связывает канонические Auth profile, Student membership,
   разрешённые scopes, student case и профиль, затем активирует кабинет и пишет
   аудит. Повторы/гонки не создают дубли; expected_version и стабильный request ID.
   Обнаруженные существующие case/membership-конфликты требуют явного разрешения,
   не автоматической привязки по непроверенному телефону/email. Не подделывать
   invite receipts, оплату, договор или менеджера Sales. Для публичной заявки
   разрешить отсутствие Sales owner только при durable связи с этой заявкой;
   прежний CHECK остаётся обязательным для остальных дел.
6. Ответы доступны в существующей вкладке «Анкета» карточки студента с происхождением
   «Заполнено студентом». Частичные канонические сведения заполняются без выдумок,
   подробные поля требуют проверки сотрудником. Одобрение доступа не подтверждает
   академические/финансовые факты. Личные assessment answers/results не читаются
   сотрудниками и не смешиваются с самооценкой английского при регистрации.
7. Чистка текста ограничена настройками и очевидными повторениями/внутренними
   терминами основных CRM/Portal экранов. Не менять глобальную навигацию, права,
   состояния провайдеров или существующие рабочие процессы ради уборки текста.

## Дизайн

Визуальный тезис: спокойная светлая форма EVO, ясный крупный вопрос, воздух,
красный акцент выбора и главного действия. Содержание: прогресс → один вопрос
или тесно связанные поля → Назад/Продолжить → проверка/создание аккаунта.
Взаимодействия: короткая смена шага с переносом фокуса на вопрос, заметный выбор,
плавное раскрытие условных полей; reduced-motion без движения. На мобильном
кнопки не перекрывают форму; ошибки рядом с полями и доступны скринридеру.
Не копировать ApplyBoard assets, цифры подборов, проценты, scholarship/free-service
обещания или фиктивную загрузку подбора.

## Историческая исходная точка

Main7d6b61a0 после общего release600e11416. Публичная регистрация отсутствует;
`/register` скрыт. Pending page сейчас только для приглашений. Portal guard
требует active/closed case, portal activation и Student membership. Профиль
имеет существующие общие факты и reviewed поля; pending — отдельное состояние
заявки, не существующее состояние операционного дела.
Live Auth GET18 сентября: disable_signup=true, email=true,
mailer_autoconfirm=false; Google/Facebook/phone выключены. Dashboard подтвердил
это. Первоначальный план предполагал включение публичного signup и проверку
SMTP; последующие решения ниже заменили этот контракт. Снимок не является
доказательством email delivery или текущей проверки новой регистрации.

Текущая активация не требует signup callback или SMTP. Существующие staff
callback и Student invitation callback, host-only cookies сохраняются.
Public Auth signup остаётся выключенным; новую identity создаёт только серверная
action, затем выполняется обычный password login. Все production Auth settings
сохранены. SQL177 сам настройки Auth не меняет.

## Исторические проверки первоначального draft

Отмеченные результаты ниже относятся к исходному draft до staff173–175.
Они не доказывают новую177 и исправления интеграции, описанные в конце плана.

- [x] Аудит действующих Auth, route, schema, profile и UX; выбор ограничений владельцем.
- [x] Один forward schema slice: заявки/RPC/RLS/атомарное одобрение, без второго
  источника данных. Проверить реальные RPC и запреты на существующем разрешённом
  QA контуре; не добавлять staff identities, не засорять продажи.
- [x] Публичная анкета, signup/confirmation, восстановление, pending реализованы; UI приёмка ещё открыта.
- [x] Admissions очередь/решение и ответы в карточке; уборка текста реализованы.
- [x] Короткие проверки изменённых функций и lint/type/build по scope.
- [x] Независимый review реализации `b24b19b75e0baad5d73524e092284848d94f32d6`
  против `2908a0dbf2b3c829b687ecfbc0e0aa63e1be98be`: APPROVED для draft PR.
- [x] Защищённые PR checks на `db80bd85` прошли: `35292813009`, включая
  build/lint/contracts/migration boundary. Независимый exact-head review APPROVED.
- Desktop/mobile и реальный Next/signup/email-delivery прогон отменён владельцем
  после этих проверок. Не отмечать его выполненным или успешным.

## Завершение текущего выпуска

- [x] Владелец выбрал регистрацию без подтверждения email.
- [x] Удалён неопубликованный confirmation path; public signup закрыт,
  server-only создание новой identity защищено валидацией и постоянным лимитом.
- [x] Локально пройдены девять шагов, pending/запрет портала, существующий Admin
  RPC approval, полный кабинет и повторный password login; отдельно 11 security checks.
- [x] Независимо проверен `5323f23321505a27d0e70b6ce2fdd3c9aff04555`,
  protected checks `35340251635` прошли; PR #830 объединён в main.
- [x] Production177 применена, точный SQL hash и ledger001–177 прочитаны обратно.
- [x] Upstream `35340610391` и managed `35340641026` прошли; accepted/running
  image и receipt hashes совпали, healthy, 0 restarts, pending=false, arm=false.
- [x] Production existing-Auth browser smoke и публичная форма проверены;
  новый production Student и staff approval submission не выполнялись.

Владение: root — план, публичный UI, Auth/routing, интеграция/проверка/release;
worker schema — контракт, миграция и RPC adapters/actions; worker staff — очередь
и существующая карточка; worker copy — ограниченные settings/portal тексты.
Все работают в одной ветке, не откатывая чужие изменения.

## Источники

- https://supabase.com/docs/guides/auth/passwords — signup, подтверждение email,
  производственный SMTP; выключенные провайдеры не представляются доступными.
- https://supabase.com/docs/guides/auth/server-side/nextjs — cookie SSR,
  getClaims/getUser вместо доверия cookie session; сохраняем существующий клиент.
- https://supabase.com/docs/guides/auth/server-side/creating-a-client — proxy
  обновляет cookies также у авторизованного посетителя публичного `/apply`.
- https://supabase.com/docs/reference/javascript/auth-signup — ответ signup
  для существующего email может быть скрытым/обезличенным; он не устанавливает
  владельца заявки. Черновик сохраняется до подтверждённой отправки; восстановление
  после повторного входа привязано к проверенному email/аккаунту и ревизии.
- https://supabase.com/docs/guides/auth/auth-smtp — встроенная почта ограничена
  адресами команды проекта и не подходит для публичной регистрации.
- https://supabase.com/docs/guides/database/postgres/row-level-security — auth.uid,
  RLS и серверные границы; user metadata не является источником прав.
- Установленные Next16.3.4 docs: forms, server-actions, authentication —
  useActionState, серверная проверка каждой команды и DAL.
- Context7 запрошен18 сентября: monthly quota exceeded; официальные источники
  выше прочитаны напрямую. Это не препятствует исполнению.
- https://www.ets.org/toefl/test-takers/ibt/scores/understand-scores.html — с
  21 января 2026 TOEFL использует шкалу 1–6 с шагом 0,5; отдельно поддержан
  предоставленный студентом прежний/сопоставимый результат 0–120. Шкала сохраняется.
- https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail — IELTS 0–9,
  https://www.pearsonpte.com/pte-academic/scoring/understand-your-score — PTE 10–90.
- https://blog.englishtest.duolingo.com/how-is-the-duolingo-english-test-scored/
  — Duolingo English Test 10–160, шаг 5.

## Промежуточная проверка 18 сентября

- Next production build, TypeScript и оба worker bundles прошли после интеграции
  анкеты/очереди/nullable Sales DTO. Изменённые TS/TSX прошли scoped ESLint.
- Signup/runtime/proxy: 16 outcome tests; Admissions: 24; profile integration: 24;
  существующие Auth/route/settings: 44. Тест с отдельным Next dev сначала
  столкнулся с уже запущенным сервером; после остановки сервера этот тест и
  callback-контракт прошли. Это не ошибка или обход продуктового запрета.
- Предварительное независимое review нашло и привело к исправлению:
  отсутствие Sales owner исключало публичное дело из INNER JOIN read projections;
  публичный `/apply` пропускал cookie refresh; авторизованный черновик терялся
  после reload. Final review реализации на `b24b19b7` APPROVED; новые изменения
  CI-классификатора также требуют независимой проверки перед публикацией head.
- Локальная форма отвечает HTTP 200 с реальным QA Supabase config. Визуальная
  проверка не засчитана: Chrome-команды зависают, инструмент сообщает locked Mac;
  запрошена разблокировка. HTTP/сборка не заменяют browser acceptance.
- Production Auth по-прежнему `disable_signup=true`. Запрошены сервис и адрес
  отправителя EVO; password/key в чат не запрашивались. Production migration,
  публикация регистрации и email delivery в этом run ещё не выполнялись.

- Реальный существующий локальный Supabase: 35 Auth/RPC проверок прошли.
  Signup без сессии до подтверждения Mailpit, собственная pending заявка,
  отсутствие membership/case до одобрения, запреты Student/Sales/anonymous,
  отказ и повторная подача с ревизией, атомарное одобрение, отсутствие дублей,
  новый Auth access version и реальный portal RPC. Подтверждены nullable Sales
  read projections, профиль со статусом needs_review, изоляция другого Student
  и отсутствие фиктивного Sales клиента/лида. Production SMTP это не доказывает.
- На момент исходной проверки регистрация сохранена в draft PR #830; migration172 была только в ветке
  и локальном QA. Первая CI попытка `35292465410` остановилась на неизвестном
  документальном JSON-отчёте. Добавлен его точный путь без расширения glob:
  classifier20/20 прошли, действительный range сохраняет обязательные contracts,
  migration boundary, lint и build. Неизвестные/пустые ranges всё ещё fail closed.
- Тексты выпущены отдельно через PR #828. Exact head `4883d90d` получил
  независимый APPROVED и защищённый CI `35292049272`. Merge/current main
  `2908a0dbf2b3c829b687ecfbc0e0aa63e1be98be` прошёл lightweight CI `35292204474`
  и release `35292232876`; accepted release `v3-r35292232876-a1-2908a0db`.
  Реальный Admin/Student browser smoke пройден. SSH readback подтвердил совпадение
  running/accepted revision/image и обоих хешей acceptance/browser receipt,
  healthy,0 restarts,pending absent,CRM/app health200. Release arm прочитан false.
  Это выпуск 12 файлов текста; migration172 и публичная регистрация не включены.
  Отдельная визуальная приёмка всех settings экранов остаётся непроверенной.

## Продолжение: выбран Gmail, дополнительных проверок не запускать

Официальные инструкции Google/Supabase требуют пароль приложения Google при
включённой двухэтапной проверке. Подготовлены SMTP host `smtp.gmail.com`, port587,
sender name `EVO Admissions`; выбранные владельцем email/username хранятся только
в частном operator draft. Обычный пароль Google не заменяет app password.
В проверенных `.env*` проекта и `/opt/evo-crm` SMTP/Gmail credentials отсутствуют.
Dashboard повторно прочитать не удалось из-за сбоя browser-control; текущая
конфигурация custom SMTP не объявляется подтверждённой. Требуется доступ к уже
настроенному SMTP либо безопасно сохранённый пароль приложения. Никаких писем,
проверочных аккаунтов, изменений production Auth или migration172 в этом
продолжении не выполнялось.

- https://support.google.com/accounts/answer/185833 — Google app passwords.
- https://supabase.com/docs/guides/troubleshooting/using-google-smtp-with-supabase-custom-smtp-ZZzU4Y
  — Gmail custom SMTP. Context7 снова недоступен из-за monthly quota;
  официальные инструкции прочитаны напрямую.

## Интеграция после staff release99ac5aa3

Main содержит retired no-op172 и staff173–175. Реальный Student SQL перенесён
в176; эти четыре общие миграции сохранены без изменений. Старый local QA172
и его JSON receipt остаются историческими: номер или хеш в receipt не заменять.

- Очередь pending привязана к существующему активному отделу сопровождения
  через private configuration и составной FK. При отсутствии единственного
  подходящего отдела или организации intake остаётся недоступным.
- Department manager получает очередь по трём опубликованным permission grants;
  названия ролей и own-record grants не открывают все неназначенные заявки.
  Выбор куратора и approve дополнительно учитывают реальную область назначения.
- Password-provisioned staff распознаётся по защищённому Auth app_metadata
  marker. Отсутствие активного staff доступа не переводит такой аккаунт в
  Student continuation; Admin alias и штатный staff вход сохраняются.
- Это изменения исходного кода без нового test/browser/SQL прогона.176 не
  применялась, production Auth/SMTP не менялись. Последующее объединение main
  и выпуск согласовываются с параллельной staff/Docs работой.

## Резервирование177 для Student signup

Отдельный текущий выпуск Docs занимает176 для прямого создания студента
сотрудником без автоматического Auth invitation. Невыпущенная Student миграция
перенесена с176 в177 без изменения SQL. До её выпуска требуется rebase на
принятую Docs176 и разбор прямых schema dependencies; через отсутствующую176
этот draft не выпускать. Auth/SMTP и production не менялись.

## Официальные источники для режима без письма

- https://supabase.com/docs/reference/javascript/auth-signup — signUp и сессия.
- https://supabase.com/docs/reference/api/v1-update-auth-service-config — Auth settings.
- https://supabase.com/docs/guides/auth/server-side/creating-a-client — SSR cookies.
- https://github.com/supabase/auth/blob/master/internal/api/signup.go — autoconfirm вызывает Confirm и выдаёт сессию.
- https://github.com/supabase/auth/blob/master/internal/models/user.go — Confirm заполняет email_confirmed_at.
- https://supabase.com/docs/guides/database/postgres/row-level-security#authjwt — user_metadata не источник прав.

Context718 сентября снова вернул quota exceeded; прочитаны официальные docs/source.
Исторические разделы о письмах выше описывают предыдущий черновик и не являются
действующим требованием после явного выбора владельца.


Текущий серверный путь проверен по официальным источникам:
- https://supabase.com/docs/reference/javascript/auth-admin-createuser
- https://raw.githubusercontent.com/supabase/auth/v2.196.0/internal/api/admin.go
- https://raw.githubusercontent.com/supabase/auth/v2.196.0/internal/api/signup.go
Общий autoconfirm из промежуточного черновика заменён до публикации, поскольку
он небезопасно пересекается с существующими неподтверждёнными приглашениями.


## Локальная техническая проверка

Новый server-only signup пройден через реальный локальный UI: все девять шагов,
новый аккаунт без письма, pending, запрет прямого /portal, одобрение существующим
Admin через реальный RPC, обновление статуса, полный кабинет и повторный password
login. Ответы сохранены в canonical profile; Sales client/lead не создаются.
Отдельно11 реальных security-delta проверок: закрытый public signup, отказ
дубликату неподтверждённого аккаунта без изменения identity и service-only quota.
Исходные35 проверок приложения/Docs сохранены с прежними SHA; прежний способ
создания Auth заменён и не выдаётся за текущую проверку.

Перед применением полный итоговый SQL177 с SHA256
`55b821d1f2612d82208991a6f103b5686c1b120324286147b7b9a267967803f6`
скомпилирован на production176 в транзакции с ROLLBACK; эта предварительная
проверка не оставила постоянных записей, конфигурация intake найдена ровно одна.
Подробности: [локальный receipt](../../qa/student-public-onboarding-177-local-2026-09-18.json).

## Принятый production release — 2026-09-18

Миграция177 затем применена отдельно, ledger001–177 и тот же SQL hash подтверждены.
Release `v3-r35340641026-a1-1de14c0a` принят на merge SHA
`1de14c0ad02b97b5b576060864574ee70e9e8508`. Accepted/running image, acceptance
и browser receipt hashes совпали; runtime healthy, 0 restarts, health обоих
доменов доступен, pending=false, arm=false. Auth settings не изменены.

Production browser smoke с существующим Auth прошёл. Отдельный CUA-прогон:
анонимный корень → `/apply`, девять шагов до создания аккаунта, reload сохраняет
шаг, mobile390 показывает элементы управления. Identity/consent не вводились,
форма не отправлялась; новый Student не создавался, staff approval через форму
не выполнялся. Полный signup → approval → relogin остаётся реальным локальным
доказательством, а не production business acceptance. Точные hashes, operator
recovery и границы: [production receipt](../../qa/student-public-onboarding-177-production-2026-09-18.json).
