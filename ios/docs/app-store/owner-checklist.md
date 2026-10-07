# Чеклист владельца: EVO Admissions 1.0 в App Store

Аккаунт разработчика: индивидуальный, на имя владельца. Приложение: «EVO Admissions», bundle id `com.evoadmissions.app`, бесплатное, только iPhone, портретная ориентация, языки приложения русский и кыргызский.

Метки:

- **[Владелец]**: делает только владелец. Пароли, оплата, соглашения, удостоверение личности и кнопка отправки на проверку остаются за ним.
- **[Агенты]**: делают агенты. Код идёт через PR в `main` с независимым review; сливает владелец.
- **[Вместе]**: владелец даёт доступ или решение, агенты выполняют.

Пароли, ключи и Team ID не пишите в чат. Личный email Apple ID владельца не попадает ни в репозиторий, ни в документы.

Файлы рядом: `listing-ru.md`, `listing-en.md`, `app-privacy.md`, `age-rating.md`, `review-notes.md`.

## 0. Решения до начала

| № | Вопрос | Факты | Рекомендация |
| --- | --- | --- | --- |
| Р1 | Индивидуальный аккаунт или организация | При индивидуальном аккаунте продавцом в App Store будет личное имя владельца. Правило 5.1.1(ix): приложения, которые «require sensitive user information», должна подавать организация, а не частное лицо. Приложение принимает паспорта, финансовые и медицинские документы. Организации нужны юрлицо и D-U-N-S | Риск отказа по 5.1.1(ix) реальный. Если у EVO есть юрлицо, надёжнее организация. Если остаётся индивидуальный аккаунт, в «Notes» прямо писать, что EVO оказывает услугу по договору, и быть готовым к вопросу проверяющего |
| Р2 | Страны продажи | ЕС: для торговца Apple публикует на странице адрес, телефон и email (DSA); у частного лица это личные данные. Китай: без номера ICP приложение там недоступно | Все страны, кроме стран ЕС и Китая (материк). Если ЕС нужен, сначала пройти DSA (шаг 4) |
| Р3 | Какой review-аккаунт создать | Без дела с сопровождением проверяющий не увидит «Моё поступление», «Документы», «Оплату», «Сообщения». Правило 2.1 требует показать все функции | Аккаунт с сопровождением и отдельным QA-делом в CRM, явно помеченным «App Review». Учесть, что это дело попадёт в отчёты CRM |
| Р4 | Удаление аккаунта | Сейчас кнопка создаёт запрос, а текст обещает «закроет доступ к кабинету». В CRM запрос виден только админу как бейдж, статусы «requested» и «acknowledged», инструмента удаления нет. Apple: отключение аккаунта недостаточно; ручная обработка допустима, если человек узнаёт срок и получает подтверждение; надо сказать, что хранится по закону | Владелец определяет срок (N дней), что удаляется, что хранится по договору и закону, и кто удаляет. Агенты меняют текст на экране. Инструмент удаления в CRM, если для него нужна миграция, агенты не делают: номера 267..277 заняты, они останавливаются и сообщают |
| Р5 | Фото вузов без лицензии | В `src/lib/university-photo-library.json` 57 из 144 фото помечены «no reuse license stated» или «All rights reserved». Вопрос «Content Rights» требует подтвердить права. Правило 5.2.1 запрещает чужие защищённые материалы без разрешения | Для iPhone 1.0 показывать только фото со свободной лицензией (правка агентов), остальные вузы без фото. Или получить разрешения |
| Р6 | Кыргызский язык | Тексты KY писал агент, носитель их не вычитывал | Вычитка до выпуска или осознанный выпуск как есть |
| Р7 | Строка Copyright | Apple: год и имя владельца прав | «2026 EVO Admissions», если бренд принадлежит владельцу или его компании; иначе имя владельца |
| Р8 | Имя под иконкой | Сейчас `EVO admissions` (строчная a), в App Store «EVO Admissions» | Выровнять на «EVO Admissions» (правка агентов) |
| Р9 | Английская локализация | Витрина Кыргызстана поддерживает только English (U.K.) | English (U.S.), подробности в `listing-en.md` |
| Р10 | Email в приложении | Экран подтверждения регистрации показывает evo@evoadmissions.com, публичные тексты используют evoadmissions@gmail.com | Оставить один ящик, который точно читают; агенты выровняют |
| Р11 | Ответы App Privacy | Health, маркетинг, аналитика: см. `app-privacy.md`, раздел 6 | Health отметить; маркетинг и аналитику подтвердить |
| Р12 | Выпуск после одобрения | Варианты Apple: вручную, автоматически, автоматически не раньше даты | Вручную |

## 1. Apple Account и двухфакторная аутентификация [Владелец]

1. iPhone: «Настройки» → ваше имя → «Вход и безопасность» → «Двухфакторная аутентификация» должна быть включена.
2. Там же проверить имя и фамилию: только юридическое имя, без псевдонимов и названия компании. Иначе Apple задержит вступление.
3. Адрес (не абонентский ящик) и телефон должны быть актуальными.

## 2. Вступление в Apple Developer Program как Individual [Владелец]

Вариант А, приложение Apple Developer на iPhone (весь процесс на одном устройстве):

1. Установить «Apple Developer» из App Store.
2. Вкладка «Account» → войти своим Apple Account → принять Apple Developer Agreement.
3. «Enroll Now» → ввести юридические имя, фамилию и телефон.
4. Сфотографировать паспорт или другое государственное удостоверение с фото.
5. Тип: «Individual» → принять Apple Developer Program License Agreement.
6. «Subscribe»: 99 USD в год или цена в местной валюте, автопродление, оплата способом из Apple Account. Подарочные карты не принимаются.

Вариант Б, сайт (если в приложении нет кнопки «Enroll Now»: Apple предупреждает, что в части стран вступление через приложение недоступно):

1. https://developer.apple.com/programs/enroll/ → «Start your enrollment».
2. Войти, выбрать «Individual», заполнить данные.
3. Оплатить своей картой. Чужая карта задержит вступление, Apple попросит удостоверение.

Итог: письмо о подтверждении членства.

## 3. Team ID [Владелец → агенты]

1. https://developer.apple.com/account → «Membership details» → строка «Team ID» (10 символов).
2. Не отправлять в чат. Создать файл `output/app-store/team-id.txt` в основной папке `evo_AI_CRM` (папка `output/` не попадает в Git) и записать туда только Team ID. Или сказать лиду устно.
3. **[Агенты]** передают его скрипту `ios/scripts/write-release-config.sh` в переменной `DEVELOPMENT_TEAM`. Скрипт пишет игнорируемый `ios/Release.xcconfig`; в Git Team ID не попадает. Порядок в `ios/README.md`, «Выпуск в App Store».

## 4. Соглашения и обязательные разделы [Владелец]

1. https://appstoreconnect.apple.com → «Business».
2. Принять все соглашения, которые там ждут. Без последнего соглашения нельзя создать приложение.
3. Платное соглашение, банк и налоги для бесплатного приложения не нужны.
4. Только если по Р2 выбраны страны ЕС: «Business» → «Agreements» → раздел «Compliance» → «Digital Services Act» → «Complete Compliance Requirements». Для частного лица Apple опубликует адрес, телефон и email.

## 5. Ключ App Store Connect API для агентов [Владелец], рекомендуется

Ключ даёт агентам загружать сборки без вашего пароля.

1. App Store Connect → «Users and Access» → вкладка «Integrations» → слева «App Store Connect API» → вкладка «Team Keys».
2. Если Apple показывает кнопку «Request Access», сначала нажать её (это делает Account Holder).
3. «Generate API Key» (или «+») → имя `EVO agents` → «Access»: «App Manager» → «Generate».
4. «Download API Key»: файл `.p8` скачивается один раз, Apple его не хранит.
5. Положить `.p8` в «Секреты и доступы ЭВО» через SOPS. Key ID и Issuer ID (видны на той же странице) передать лиду не через чат.

Без ключа: владелец сам входит в Xcode на этом Mac («Xcode» → «Settings» → «Accounts» → «+» → Apple Account). Агенты пароль не вводят.

## 6. Bundle ID [Агенты по ключу, или Владелец]

1. https://developer.apple.com/account → «Certificates, IDs & Profiles» → «Identifiers» → «+».
2. «App IDs» → «App» → «Continue».
3. Description `EVO Admissions`, Bundle ID «Explicit» `com.evoadmissions.app`. Дополнительные возможности не нужны: push, Sign in with Apple и Associated Domains приложение не использует.
4. «Register».

После загрузки первой сборки bundle id поменять нельзя.

## 7. Запись приложения [Владелец]

1. App Store Connect → «Apps» → «+» слева вверху → «New App».
2. «Platforms»: iOS.
3. «Name»: `EVO Admissions`. Если занято, запасные варианты в `listing-ru.md`.
4. «Primary Language»: Russian.
5. «Bundle ID»: `com.evoadmissions.app`.
6. «SKU»: `evo-admissions-ios` (потом не меняется, покупателям не виден).
7. «User Access»: «Full Access».
8. «Create».

## 8. App Information [Владелец, тексты готовы]

В боковой панели «General» → «App Information»:

1. «Subtitle» и «Name»: из `listing-ru.md`.
2. «Category»: Primary «Education», Secondary «Reference».
3. «Content Rights»: приложение показывает чужой контент (фото кампусов, сводки O*NET). Отвечать «Yes, it contains third-party content» и подтверждать права только после решения Р5.
4. «Age Ratings» → «Set Up Age Ratings»: ответы из `age-rating.md`, итог 4+.
5. Если появится вопрос о медицинском устройстве (Regulated Medical Device): «No».
6. Если появится раздел «Digital Goods and Services in Your Apps»: на вопрос «Can customers consume digital goods and services in this app?» ответ «No»: платных цифровых товаров в приложении нет, сопровождение EVO это услуга вне приложения по договору. Выбор для ЕС блокируется на 12 месяцев; если формулировка вопроса покажется другой, сначала спросить лида.
7. Английская локализация по Р9: справа вверху меню языка → «Not Localized» → «English (U.S.)» → «+». Тексты из `listing-en.md`.

## 9. Pricing and Availability [Владелец]

1. «Price»: 0 (Free).
2. «Availability»: страны по Р2.
3. Снять доступность на Mac с Apple silicon и на Apple Vision Pro: приложение на них не проверялось.

## 10. App Privacy [Владелец]

1. Боковая панель → «App Privacy» → «Get Started».
2. Ответы из `app-privacy.md`, разделы 1 и 2.
3. «Privacy Policy URL»: https://evoadmissions.com/ru/privacy/ (страница должна быть опубликована и содержать то, что требует правило 5.1.1(i): какие данные, кто ещё их получает, срок хранения, как отозвать согласие и запросить удаление).
4. «Publish».

## 11. Подготовка сборки [Агенты]

Блокеры отправки, которые закрывают агенты (PR → review → владелец сливает):

1. Ссылка на политику конфиденциальности внутри приложения: в «Профиле» и у согласия в анкете. Сейчас её нет, а правило 5.1.1(i) требует ссылку «within the app».
2. Текст «Удаление аккаунта» по решению Р4: срок, что удаляется, что хранится, подтверждение.
3. Сделано в PR #1172: сырые ключи локализации на экране (`prep_status_preparation` и другие) заменены подписями из каталога строк, тест `LocalizationKeysTests` следит за этим.
4. Сделано в PR #1172: файл приватности `ios/EVOAdmissions/Resources/PrivacyInfo.xcprivacy`. Типы данных совпадают с `app-privacy.md`; из API с обязательной причиной приложение использует только `UserDefaults` (причина `CA92.1`).
5. Сделано в PR #1172: версия `1.0.0`, номер сборки `1` (`MARKETING_VERSION` и `CURRENT_PROJECT_VERSION` в `ios/project.yml`, `Info.plist` берёт их оттуда). Каждая следующая загрузка той же версии получает новый номер сборки.
6. Решения Р5 (фото), Р8 (имя), Р10 (email).

Сборка и загрузка:

7. Сделано в PR #1172: Release читает игнорируемый `ios/Release.xcconfig`, его пишет `ios/scripts/write-release-config.sh` (рабочий Supabase, publishable ключ, Team ID; только `https://`). Шаг сборки `ios/scripts/check-release-config.sh` не даст собрать Release без значений или с исключением ATS, а архив ещё и с заглушкой ключа или без Team ID. Секретов в сборке нет.
8. Сборка в Xcode 26 с iOS 26 SDK: Apple требует этого с 28.04.2026.
9. Проверка на симуляторе iPhone и в режиме совместимости на iPad: приложения только для iPhone тоже запускаются на iPad.
10. Archive и загрузка по ключу из шага 5. Вопрос о шифровании не появится: в `Info.plist` уже `ITSAppUsesNonExemptEncryption = NO` (только HTTPS).
11. Скриншоты на локальном демо-стенде с синтетическими данными: iPhone 17 Pro, 1206×2622 (обязательный размер «iPhone with Dynamic Island (medium display)»), по желанию iPhone 17 Pro Max, 1320×2868. От 1 до 10 на язык, PNG или JPEG без прозрачности. Без фото, на которые нет лицензии, и без реальных персональных данных.

## 12. TestFlight, внутреннее тестирование [Владелец, сборку грузят агенты]

1. После загрузки сборка появляется в «TestFlight» после обработки.
2. «TestFlight» → «Internal Testing» → «+» → группа `EVO` → добавить тестировщиков (пользователи App Store Connect, до 100).
3. На iPhone установить TestFlight, принять приглашение, установить сборку.
4. Пройти путь студента на QA-аккаунте: вход, «Главная», каталог, урок, тест, «Документы» (загрузить тестовый PDF), «Сообщения», «Профиль».
5. Проверить в рабочей системе доставку письма подтверждения регистрации: отправить анкету с ящика, который контролирует EVO, и дождаться письма. Сейчас доставка писем Auth не подтверждена. Эту тестовую анкету не одобрять.
6. Сборка в TestFlight действует 90 дней.

## 13. TestFlight, внешние тестировщики [Владелец], по желанию

1. «TestFlight» → «External Testing» → «+» → группа (например, `Студенты EVO`).
2. Добавить людей по email или включить публичную ссылку.
3. «Test Information»: описание бета-версии, что тестировать, Feedback Email evoadmissions@gmail.com, данные для входа (review-аккаунт), Privacy Policy URL.
4. Добавить сборку → «Submit for Review». Первая сборка проходит Beta App Review, следующие обычно без полной проверки.

## 14. Review-аккаунт [Владелец]

1. Создать в рабочей системе обычным путём: анкета в приложении или приглашение из CRM, затем одобрение в CRM. Ящик для аккаунта должен контролировать EVO. Обхода входа и демо-режима в приложении нет по замыслу.
2. По Р3 подключить сопровождение: отдельное QA-дело «App Review», тестовые начисления, один запрос документа, одно сообщение от сотрудника.
3. Пароль не меньше 12 символов. Хранить в «Секреты и доступы ЭВО» через SOPS, в чат не писать.
4. Не отключать аккаунт после проверки: Apple требует, чтобы демо-аккаунт не истекал.
5. Во время проверки отвечать на сообщения от этого аккаунта в CRM и не выполнять его запрос на удаление.

## 15. Страница версии 1.0 [Владелец, тексты и файлы готовят агенты]

Боковая панель → «iOS App» → «1.0 Prepare for Submission»:

1. «Previews and Screenshots» → вкладка iPhone → перетащить файлы из шага 11. Для английской локали те же или отдельные.
2. «Promotional Text», «Description», «Keywords», «Support URL», «Marketing URL»: из `listing-ru.md` и `listing-en.md`. Support URL по правилам Apple должен вести на реальные контакты.
3. «Version»: `1.0.0`, ровно как `CFBundleShortVersionString` сборки (App Store Connect при создании записи предлагает `1.0`, его нужно исправить, иначе сборку нельзя выбрать). «Copyright»: по Р7.
4. «Build» → «+» → выбрать загруженную сборку.
5. «App Review Information»: из `review-notes.md`. Логин и пароль в «Sign-In Information», остальное в «Notes».
6. «App Store Version Release»: «Manually release this version» (Р12).
7. «Save».

## 16. Отправка на проверку [Владелец]

1. Справа вверху «Add for Review» → создать новую отправку (submission). Статус станет «Ready for Review».
2. Справа внизу «Draft Submissions» (или раздел «App Review» в боковой панели) → проверить состав → «Submit for Review».
3. Дальше статусы меняются до «Pending Developer Release» (одобрено, ждёт ручного выпуска) или «Rejected».
4. Вопросы и отказ приходят в App Store Connect в разделе сообщений App Review. **[Агенты]** готовят ответ и правки; отправляет владелец.

## 17. Выпуск [Владелец]

1. Статус «Pending Developer Release» → «Release This Version».
2. Найти приложение в App Store на своём iPhone, установить и войти QA-аккаунтом.
3. **[Агенты]** записывают факты выпуска (версия, сборка, дата) в `ios/README.md` и план только после реальной проверки.

## Сводка: кто что делает

| Шаг | Владелец | Агенты |
| --- | --- | --- |
| Решения Р1..Р12 | решает | готовят факты и варианты |
| Apple Account, 2FA, вступление, оплата, удостоверение | да | нет |
| Team ID | находит и передаёт | прописывают в игнорируемый конфиг |
| Соглашения, DSA | да | нет |
| Ключ API | создаёт и хранит в SOPS | используют для загрузки |
| Bundle ID | или сам | по ключу |
| Запись приложения, App Privacy, цены и страны, Content Rights | да | готовят ответы |
| Тексты, ключевые слова, рейтинг, заметки для проверки | вставляет | пишут (эти файлы) |
| Правки кода, сборка, загрузка, скриншоты | сливает PR | делают |
| TestFlight: группы и тестировщики | да | загружают сборки |
| Review-аккаунт в рабочей системе | создаёт | не создают |
| Отправка, ответы Apple, выпуск | нажимает | готовят ответы |

## Источники (проверено 07.10.2026)

- Вступление, Individual, 99 USD, 2FA, имя продавца: https://developer.apple.com/programs/enroll/ и https://developer.apple.com/support/enrollment/
- Вступление через приложение Apple Developer: https://developer.apple.com/help/account/membership/enrolling-in-the-app/
- Проверка личности: https://developer.apple.com/help/account/membership/identity-verification/
- Создание записи приложения: https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app
- Отправка на проверку: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app
- Ключи App Store Connect API: https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
- TestFlight: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- Поля версии, App Review Information, варианты выпуска: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Скриншоты: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Рейтинг: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating
- Digital Goods and Services: https://developer.apple.com/help/app-store-connect/manage-app-information/complete-the-digital-goods-and-services-questionnaire
- DSA: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
- Языки витрин: https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations
- Требования к SDK, DSA, рейтингам: https://developer.apple.com/news/upcoming-requirements/
- Правила 2.1, 2.3.7, 3.1.3(e), 5.1.1(i), 5.1.1(v), 5.1.1(ix), 5.2.1: https://developer.apple.com/app-store/review/guidelines/
- Удаление аккаунта: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Факты о приложении: `output/app-store/inputs/book.json`, `output/app-store/inputs/R2-student-app.md` (в основной папке, вне Git), код ветки `izzhackt/ios-app-store-1-0` (PR #1172).
