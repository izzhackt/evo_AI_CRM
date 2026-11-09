# Тексты для App Store и Google Play (черновик)

Черновик для владельца: проверить факты, отправить в консоли. Приложение: «EVO admissions» (`com.evoadmissions.app`,
iOS и Android), версия 2.0.0. Языки магазинов: русский (основной) и английский. Цены, гарантии и юридические
формулировки в тексты не вынесены сознательно: любое их добавление требует подтверждения владельца.

## 1. Название, подзаголовок, категория

| Поле | Русский | English |
|---|---|---|
| Название (до 30 знаков) | EVO admissions | EVO admissions |
| Подзаголовок App Store (до 30) | Поступление за рубеж | Study abroad admissions |
| Краткое описание Google Play (до 80) | Ваше поступление за рубеж: документы, чат с куратором, вузы, CSCA. | Your study-abroad admission: documents, curator chat, universities, CSCA prep. |
| Категория | Образование (Education) | Education |
| Вторая категория App Store (необязательно) | Справочники (Reference) | Reference |

## 2. Полное описание

### Русский

EVO admissions — кабинет студента компании EVO Admissions. Приложение для тех, кто уже работает с командой EVO над
поступлением в университеты за рубежом. Вход по логину и паролю, который выдала компания; регистрация только по личной
ссылке от менеджера.

Что внутри:
• Главная: этапы вашего поступления, ближайшие сроки, новости и избранные университеты.
• Документы: чек-лист нужных документов, статусы проверки, договор и чеки по вашему делу.
• Оплаты: график и статус платежей по договору.
• Сообщения: чат с куратором и уведомления по делу.
• Университеты: каталог вузов по странам и городам, карта, стоимость, избранное.
• Профессии и тесты: подборка профессий и проверка знаний.
• Подготовка: английский язык и подготовка к CSCA с таймером, разбором ошибок и прогрессом.
• Профиль: русский и кыргызский языки, светлая и тёмная тема, смена пароля, запрос на удаление аккаунта.

Данные защищены: соединение шифруется, сессия хранится в защищённом хранилище телефона, документы доступны только вам и
вашему куратору. Приложение не показывает рекламу и не содержит сторонних трекеров.

Нужна помощь? https://evoadmissions.com/ru/support/

### English

EVO admissions is the student portal of EVO Admissions. It is for students who already work with the EVO team on
applying to universities abroad. Sign in with the login and password issued by the company; registration is only
available through a personal link from your manager.

What you get:
• Home: your admission stages, upcoming deadlines, news and favourite universities.
• Documents: the checklist of required documents, review status, your contract and receipts.
• Payments: schedule and status of payments under your contract.
• Messages: chat with your curator and case notifications.
• Universities: a catalogue by country and city, map, costs, favourites.
• Professions and tests: career cards and knowledge checks.
• Preparation: English and CSCA preparation with timers, mistake review and progress.
• Profile: Russian and Kyrgyz, light and dark theme, password change, account deletion request.

Your data is protected: the connection is encrypted, the session is kept in the phone's secure storage, and your
documents are visible only to you and your curator. The app shows no ads and has no third-party trackers.

Need help? https://evoadmissions.com/ru/support/

## 3. Ключевые слова (App Store, до 100 знаков, через запятую)

RU: `поступление,университет,учёба за рубежом,студент,документы,куратор,Китай,Малайзия,CSCA,IELTS,вузы`
EN: `admissions,university,study abroad,student,documents,curator,China,Malaysia,CSCA,universities`

Названия конкурентов и чужие торговые марки в ключевые слова не добавлять (правило 5.2 App Review).

## 4. Ссылки

| Что | URL | Статус |
|---|---|---|
| Поддержка (Support URL) | https://evoadmissions.com/ru/support/ | задан в приложении, страница должна существовать |
| Политика конфиденциальности | https://evoadmissions.com/ru/privacy/ | задан в приложении, должна совпадать с разделом ниже |
| Маркетинговый URL | https://evoadmissions.com/ | по желанию |
| Удаление аккаунта (Google Play, обязательно) | https://evoadmissions.com/ru/account-deletion/ | предложение; страницы пока нет, см. раздел 7 |

## 5. Возрастной рейтинг и аудитория

Анкета рейтинга (Apple, новая шкала; Google IARC): на все вопросы про насилие, сексуальный и азартный контент,
алкоголь, табак, наркотики, ужасы, ненормативную лексику, медицинские советы и мнения — «Нет».

| Вопрос | Ответ |
|---|---|
| Неограниченный доступ в интернет (произвольный браузер) | Нет: только фиксированные ссылки на сайт компании |
| Пользовательский контент, виден другим пользователям | Нет: чат только студент и его куратор, публичной ленты нет |
| Реклама | Нет |
| Покупки внутри приложения | Нет (оплаты по договору идут вне магазина, приложение их только показывает) |
| Азартные игры, лутбоксы | Нет |
| Результат App Store | 4+ (оформление рекомендовано 4+; если Apple посчитает иначе, принять её итог) |
| Результат Google (IARC) | Для всех (Everyone) |
| Целевая аудитория Google | 16 лет и старше (не «для детей», программа Designed for Families не нужна) |

## 6. Конфиденциальность

Сводка того, что собирает приложение. Совпадает с `ios.privacyManifests` в `mobile/app.config.ts`
(`NSPrivacyTracking: false`, все типы «связаны с пользователем», цель «функциональность приложения»).
В приложении нет аналитики, рекламных, краш-репортинг и других сторонних SDK, поэтому трекинга нет.

| Данные | Откуда | Зачем |
|---|---|---|
| Имя | профиль студента, регистрация | личный кабинет, связь с куратором |
| Email | вход, регистрация, письма по делу | вход, восстановление пароля |
| Телефон | регистрация | связь по заявке |
| ID пользователя | Supabase Auth | сессия, права доступа |
| Фото и файлы документов | загрузка студентом (камера, выбор фото, файлы) | проверка документов кураторами |
| Сообщения | чат с куратором | сопровождение поступления |

### 6.1. Apple: App Privacy («Nutrition label»)

Data Used to Track You: **не собираются** («No, we do not track»).

| Тип данных Apple | Собираем | Связано с пользователем | Трекинг | Цель |
|---|---|---|---|---|
| Contact Info: Name | да | да | нет | App Functionality |
| Contact Info: Email Address | да | да | нет | App Functionality |
| Contact Info: Phone Number | да | да | нет | App Functionality |
| Identifiers: User ID | да | да | нет | App Functionality |
| User Content: Photos or Videos (снимки документов) | да | да | нет | App Functionality |
| User Content: Other User Content (файлы документов, сообщения) | да | да | нет | App Functionality |
| Financial Info | нет: суммы и статусы платежей показываются из записей компании, приложение платёжных данных не вводит и не хранит | | | |
| Location, Diagnostics, Usage Data, Purchases, Contacts, Health | нет | | | |

Required-reason API (манифест): FileTimestamp C617.1/0A2A.1/3B52.1, UserDefaults CA92.1, SystemBootTime 35F9.1,
DiskSpace E174.1/85F4.1: это объединение того, что объявляют React Native, expo-file-system, expo-constants,
expo-system-ui и async-storage. Доступ к камере и фото запрашивается только при действии пользователя
(тексты запросов на русском в `app.config.ts`).

### 6.2. Google Play: Data safety

| Раздел формы | Ответ |
|---|---|
| Приложение собирает или передаёт данные | Да |
| Все данные шифруются при передаче | Да (HTTPS) |
| Можно запросить удаление данных | Да: в приложении «Профиль → Удалить аккаунт» и по веб-ссылке (раздел 7) |
| Personal info: Name, Email address, Phone number, User IDs | Собираются; цель: App functionality, Account management; не передаются третьим лицам; не необязательные |
| Photos and videos | Собираются (снимки документов); App functionality; не передаются |
| Files and docs | Собираются (файлы документов); App functionality; не передаются |
| Messages: Other in-app messages | Собираются (чат с куратором); App functionality; не передаются |
| Financial info, Location, Contacts, Health, Web browsing, App activity, Device IDs, Crashes/Diagnostics | Не собираются |
| Передача третьим лицам | Нет (хостинг и почтовый сервис — обработчики по поручению компании, не «передача» по правилам Google) |

Разрешения Android в release-манифесте (проверено сборкой `processReleaseMainManifest`): `INTERNET`, `CAMERA`,
`VIBRATE`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`. Геолокации, биометрии, микрофона, галереи, оверлеев и
`ACCESS_LOCAL_NETWORK` нет; незашифрованный http в release запрещён (разрешён только в debug).

## 7. Удаление аккаунта (требование Google Play)

Google требует веб-ссылку на страницу удаления аккаунта вне приложения. Предлагается
**https://evoadmissions.com/ru/account-deletion/** (раздел сайта, не кабинета: страница должна открываться без входа).
Страницу нужно создать в репозитории сайта (`evoadmissions-website`); её содержание:

1. Название приложения и компании (должно совпадать с карточкой в Google Play).
2. Как удалить аккаунт: (а) в приложении «Профиль → Удалить аккаунт» или в кабинете на https://app.evoadmissions.com;
   (б) если доступа нет, написать на адрес поддержки (указать реальный адрес, он уже есть на `/ru/support/`) с
   логина и email аккаунта: личность подтверждается ответом на письмо.
3. Что удаляется (аккаунт, профиль, загруженные документы, чат) и что хранится по закону или по договору (договор,
   чеки, сроки хранения; уточнить у юриста/владельца) и сколько: срок обработки 30 дней (как в приложении).
4. Контакт по вопросам данных.

Ссылка в Play Console: App content → Data safety → Account deletion URL. В App Store отдельная ссылка не нужна:
пункт 5.1.1(v) закрыт кнопкой в приложении.

## 8. Заметки для App Review (Apple)

Приложение — закрытый кабинет клиентов компании: аккаунты создаёт компания, самостоятельной регистрации нет
(только по личной ссылке менеджера). Поэтому нужен демо-аккаунт.

```
Demo account (создаёт владелец на production, в Git не хранить):
  Login:    <логин демо-студента уровня «сопровождение»>
  Password: <пароль>
```

Текст заметки (English):

> EVO admissions is the client portal of EVO Admissions, an education consultancy. Accounts are issued by the company
> to its students; there is no public sign-up (registration works only through a personal invitation link
> sent by a manager). Please sign in with the demo account above. It contains sample documents, a contract, a
> chat with a curator and the university catalogue. No payment is taken inside the app. Account deletion is under
> Profile > Delete account. Camera and photo access are requested only when the user attaches a document.
> Support: https://evoadmissions.com/ru/support/

Что должен сделать владелец до отправки: создать на production демо-студента (уровень «сопровождение», синтетические
имя и документы, не реальный клиент), проверить вход, внести логин и пароль в поле App Review Information (не в Git
и не в этот файл), убедиться, что демо-аккаунт не получит рассылок. Для Google: тот же аккаунт в «App access».

## 9. План скриншотов

Тема светлая, язык русский, синтетические данные (локальный стенд, `test.assisted`). Готовые файлы:
`docs/mobile/store-screenshots/` (`ios-6.9/`, `android-phone/`), снимает `mobile/scripts/store-screenshots.mjs`
(Maestro на симуляторе и эмуляторе).

| № | Экран | Подпись для магазина (RU) |
|---|---|---|
| 1 | Главная | Весь путь поступления на одном экране |
| 2 | Документы | Чек-лист документов и статусы проверки |
| 3 | Сообщения (чат) | Куратор всегда на связи |
| 4 | Университеты (страна, города) | Каталог вузов по странам и городам |
| 5 | CSCA | Подготовка к CSCA |
| 6 | Профиль | Русский и кыргызский, светлая и тёмная тема |

Размеры:

| Магазин | Обязательный размер | Как получено |
|---|---|---|
| App Store, iPhone 6.9" | 1320 x 2868 (iPhone 17 Pro Max) или 1290 x 2796 | симулятор iPhone 17 Pro даёт 1206 x 2622 (6.3"); для 6.9" снять на iPhone 17 Pro Max (в наборе файлов см. примечание) |
| Google Play, телефон | 1080 x 1920 и больше, соотношение до 2:1 (JPEG или 24-bit PNG) | эмулятор `Medium_Phone_API_37.0` |

Apple принимает скриншоты одного размера для всех iPhone своего класса; 6.9" набор достаточен для всех экранов
iPhone. Планшетные скриншоты не нужны: `supportsTablet: false`.
