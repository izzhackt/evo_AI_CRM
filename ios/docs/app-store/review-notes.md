# App Review notes: шаблон

Куда вставлять: App Store Connect → «Apps» → EVO Admissions → страница версии 1.0 → раздел «App Review Information». Поле «Notes» принимает до 4000 байт, текст можно писать на любом языке; ниже он на английском. Логин и пароль review-аккаунта вводятся в поля «Sign-In Information», а не в «Notes». Тот же текст подходит для «Test Information» в TestFlight при внешнем тестировании.

Перед отправкой заменить все места `[[...]]`. Готовый текст с именами, телефоном и данными review-аккаунта в Git не коммитить: он живёт только в App Store Connect. Сейчас блок занимает 3691 байт из 4000; после замены оставшихся `[[...]]` проверить, что лимит не превышен. Пункты в `[[...]]` зависят от решений владельца из owner-checklist.md. Срок удаления (30 дней) и хранение договоров и платёжных записей решены владельцем 07.10.2026 (Р4), не заглушка.

Сверено с кодом ветки `izzhackt/ios-app-store-1-0` (PR #1172): все подписи в «ёлочках» есть в `ios/EVOAdmissions/Resources/Localizable.xcstrings`, путь к удалению из `ios/EVOAdmissions/Views/ProfileView.swift` (секция «Удаление аккаунта», `ProfileViewModel.requestDeletion`).

## Поля App Review Information

| Поле | Что ввести |
| --- | --- |
| Sign-in required | включить |
| User name | email review-аккаунта `[[review email]]` |
| Password | пароль review-аккаунта (не меньше 12 символов) |
| Contact: First name, Last name | `[[имя и фамилия контактного лица]]` |
| Contact: Phone | `[[+996 ...]]`, в международном формате с плюсом |
| Contact: Email | evoadmissions@gmail.com |
| Notes | текст ниже |

## Текст для поля Notes

```
ABOUT THE APP
EVO Admissions is the iPhone client of the EVO student portal (app.evoadmissions.com). EVO is an education consultancy that supports students applying to universities abroad. In the app, students browse a university catalog, take English lessons and tests, read career cards and, if they have an EVO support contract, follow their admission case: documents, charges and messages with the EVO team. Web and app use the same account and the same data.

SIGN-IN
The app requires an EVO account. New users can send an application form in the app («Подать анкету»), but an EVO staff member approves each form manually before the account opens, so a new sign-up cannot be used during review. Please use the account in Sign-In Information. It is a real student account in our production system, filled with test data for review. It does not expire. The app has no demo mode and no sign-in bypass.
The review account has [[EVO support access: all tabs including «Моё поступление» / general access without a case]].

LANGUAGE
The interface is in Russian (default) and Kyrgyz. With an English device language the app shows Russian. Key labels:
«Войти» Sign in
«Главная» Home
«Моё поступление» My admission
«Документы» Documents, «Оплата» Payments, «Уведомления» Notifications, «Сообщения» Messages
«Университеты» Universities, «Карта» Map, heart icon = Favorites
«Английский» English, «Повторить ошибки» Review mistakes
«Профессии» Careers, «Тест интересов» Interests test
«Профиль» Profile, «Удаление аккаунта» Account deletion
The language can be switched in Profile; the app applies it fully after a restart.

WHERE TO FIND FEATURES
1. Universities tab: search, country and level filters, «Карта» map. Tap a university to open its card.
2. English tab: open a lesson and answer the tasks. Answers are checked on our server.
3. Home, «Все тесты и результаты»: English test and interests test. Only the student sees answers and results.
4. My admission tab: case status, stage and next step. Open «Документы» and tap «Загрузить новый файл» to pick a PDF, JPG or PNG in the Files app. Files go to EVO staff for review.
5. «Сообщения»: messages go to EVO staff. People reply, not a bot, [[on working days, Bishkek time (UTC+6)]].
6. «Оплата»: read-only list of charges for EVO admission support under a contract signed outside the app. These are real-world consulting services paid outside the app (guideline 3.1.3(e)). The app sells nothing, has no in-app purchases and unlocks no digital content for payment.

ACCOUNT DELETION
Profile tab, scroll to «Удаление аккаунта», tap «Отправить запрос на удаление», then confirm. The EVO team deletes the account and its personal data within 30 days of the request and confirms by email. Contract and payment records are kept in anonymized form for as long as the law requires, as the screen explains. The review account will not be deleted while the review is in progress.

PRIVACY
Privacy policy: [[Profile tab, «Политика конфиденциальности»]] and https://evoadmissions.com/ru/privacy/
No ads, no tracking, no analytics or crash SDKs. The app asks for no device permissions: files come from the system Files picker, and the map does not use location. Notifications appear inside the app only; there are no push notifications.

CONTACT
[[Name]], [[+996 phone]], evoadmissions@gmail.com
```

## Что подготовить до отправки

- Review-аккаунт создаёт владелец в рабочей системе обычным путём (анкета или приглашение из CRM, одобрение в CRM). Обхода входа и демо-режима в приложении нет по замыслу.
- Чтобы проверяющий увидел «Моё поступление», «Документы», «Оплату» и «Сообщения», аккаунту нужно дело с сопровождением. Без дела видны только «Главная», «Университеты», «Профессии», «Английский» и «Профиль». Правило 2.1 требует показать все функции, поэтому рекомендую аккаунт с сопровождением.
- Пункт «ACCOUNT DELETION» нельзя отправлять, пока не выпущен PR «Удаление аккаунта по запросу»: Notes обещает удаление в течение 30 дней, подтверждение письмом и обезличенное хранение договоров и платёжных записей, а сегодняшний экран обещает только закрыть доступ, и Apple считает отключение аккаунта недостаточным. Перед отправкой сверить Notes с экраном и с политикой конфиденциальности на сайте: везде одни и те же 30 дней и хранение по закону. Подробности в owner-checklist.md, решение Р4.
- Notes в этом виде отправляются на публичную проверку только после перевода членства в Organization (owner-checklist.md, Р1 и шаг 2.1). Для Beta App Review (внешний TestFlight) в аккаунте Individual текст тот же.
- Пункт «PRIVACY» ссылается на ссылку в «Профиле», которой в коде пока нет. Агенты добавят её до сборки; если нет, оставить только адрес сайта.
- Во время проверки кто-то из команды должен отвечать в CRM на сообщения от review-аккаунта и не удалять его по запросу удаления.
- Проверяющий может отправить новую анкету с адреса Apple. Такие анкеты не одобрять; доставку письма подтверждения нужно проверить заранее (см. owner-checklist.md).

## Источники (проверено 07.10.2026)

- Поля App Review Information, лимит 4000 байт, требования к демо-аккаунту: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Правила 2.1 (демо-аккаунт), 3.1.1, 3.1.3(e), 5.1.1(i), 5.1.1(v), 5.1.1(ix): https://developer.apple.com/app-store/review/guidelines/
- Удаление аккаунта: https://developer.apple.com/support/offering-account-deletion-in-your-app/
