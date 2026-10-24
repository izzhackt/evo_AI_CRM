# App Review notes: шаблон

Куда вставлять: App Store Connect → «Apps» → EVO Admissions → страница версии 1.1 → раздел «App Review Information». Поле «Notes» принимает до 4000 байт, текст можно писать на любом языке; ниже он на английском. Логин и пароль review-аккаунта вводятся в поля «Sign-In Information», а не в «Notes». Тот же текст подходит для «Test Information» в TestFlight при внешнем тестировании.

Перед отправкой заменить все места `[[...]]`. Готовый текст с именами, телефоном и данными review-аккаунта в Git не коммитить: он живёт только в App Store Connect. Сейчас блок занимает 3961 байт из 4000, с подставленным именем разработчика и часами ответа 3955 байт, или 3985 байт, если переводы строк считаются как CRLF (пересчёт 25.10.2026 после фразы об ИИ-помощниках в разделе «WHO PUBLISHES THE APP»: +51 байт к значениям 21.10.2026; чтобы уложиться, раздел «CONTACT» убран, контакт стоит в полях «Contact», а список подписей сокращён). После замены `[[...]]` проверить, что лимит не превышен: запас около 15 байт даже при CRLF, одна кириллическая буква занимает 2 байта. Пункты в `[[...]]` зависят от решений владельца из owner-checklist.md. Срок удаления (30 дней) и хранение договоров и платёжных записей решены владельцем 07.10.2026 (Р4), не заглушка.

Сверено с кодом сводной ветки `izzhackt/ios-1-1-integration` (PR #1215, 17.10.2026): все подписи в «ёлочках» есть в `ios/EVOAdmissions/Resources/Localizable.xcstrings` или `CSCA.xcstrings`, путь к удалению из `ios/EVOAdmissions/Views/AccountDeletionView.swift` (`AccountDeletionContent`, `AccountDeletionModel.send`; секция «Удаление аккаунта» подключена в `ProfileView.swift`, лист `AccountDeletionSheet` на экранах анкеты, статуса заявки и ожидания доступа).

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
| Attachment | скан письма-разрешения компании (`authorization-letter.md`), если App Store Connect показывает поле для вложения |

## Текст для поля Notes

```
ABOUT THE APP
EVO Admissions is the iPhone client of the EVO student portal (app.evoadmissions.com). EVO is an education consultancy for students applying to universities abroad. The app has an admission path by country, a university catalog, English lessons, CSCA math exam prep and career cards. EVO clients also follow their case: documents, charges and messages with the EVO team.

WHO PUBLISHES THE APP
I am [[developer name]], CTO of EVO Admissions LLC (Bishkek, Kyrgyz Republic), the company that provides the EVO service. I publish the company's app from my individual developer account, with the company's written permission to use the EVO Admissions name, logo and content; the signed letter from the company director is available on request. The company controls the personal data, as the privacy policy says. Files uploaded in the app (such as passport scans or bank statements) are stored on EVO's server and are visible to the student, EVO staff with access to their case and, if the student allows it, the AI assistants staff use. The app itself sends nothing to universities; students submit applications themselves or, if they ask, via their EVO curator.

SIGN-IN
The app requires an EVO account. New users can send an application form («Подать анкету»), but EVO staff approve each form manually, so a new sign-up cannot be used during review. Please use the account in Sign-In Information: a real student account in our production system with test data and an active EVO case, so every tab is visible. It does not expire. There is no demo mode and no sign-in bypass.

LANGUAGE
The interface is in Russian (default) and Kyrgyz; with an English device language it shows Russian. Key labels:
«Главная» Home, «Моё поступление» My admission
«Документы» Documents, «Оплата» Payments, «Сообщения» Messages
«Университеты» Universities, «Английский» English
«Профессии» Careers, «Профиль» Profile

WHERE TO FIND FEATURES
1. Home, «Путь поступления»: admission steps for the student's country. «Сменить страну» changes the country.
2. Universities tab: pick a country, then cities («Города») or «Карта» (map). A university card shows programs, intakes and costs.
3. English tab: «CSCA» at the top opens CSCA math prep (lessons, timed tests, «Ошибки» = mistakes); English lessons follow.
4. Home, «Все тесты и результаты»: English and interests tests. Only the student sees answers and results.
5. My admission tab: case status and next step. Open «Документы», tap «Загрузить новый файл» and pick a PDF, JPG or PNG in Files. EVO staff review the files.
6. «Сообщения»: messages go to EVO staff. People reply, not a bot, [[on working days, Bishkek time (UTC+6)]].
7. «Оплата»: read-only list of charges for EVO admission support under a contract signed outside the app. These are real-world services paid outside the app (guideline 3.1.3(e)); the app sells nothing and has no in-app purchases.

ACCOUNT DELETION
Profile tab, «Удаление аккаунта» (Account deletion), «Удалить аккаунт», then «Да, удалить аккаунт». The same button is on the application status and access-pending screens. EVO deletes the account and its personal data within 30 days. Contract and payment records are kept without personal data as long as the law requires, as the screen explains. The review account will not be deleted during review.

PRIVACY
Privacy policy: Profile tab, «Политика конфиденциальности», and https://evoadmissions.com/ru/privacy/
No ads, no tracking, no analytics or crash SDKs. The app asks for no device permissions: files come from the Files picker; the map does not use location. Notifications are in-app only; no push notifications.
```

## Что подготовить до отправки

- Review-аккаунт создаёт владелец в рабочей системе обычным путём (анкета или приглашение из CRM, одобрение в CRM). Обхода входа и демо-режима в приложении нет по замыслу.
- Чтобы проверяющий увидел «Моё поступление», «Документы», «Оплату» и «Сообщения», аккаунту нужно дело с сопровождением. Без дела видны только «Главная», «Университеты», «Профессии», «Английский» и «Профиль». Правило 2.1 требует показать все функции, а раздел «SIGN-IN» в Notes утверждает, что у аккаунта есть дело с сопровождением: Notes не отправлять, пока такой review-аккаунт не создан (Р3, шаг 14).
- Пункт «ACCOUNT DELETION» описывает выпущенную функцию удаления аккаунта по запросу (#1177, миграция 280, выпуск 15.10.2026): Notes обещает удаление в течение 30 дней и обезличенное хранение договоров и платёжных записей. Письма об удалении в версии 1.1 нет (Resend не настроен, PLAN_CHANGES 2026-10-15, решения C2, п. 2), поэтому Notes письма не обещает; если появится письмо, Notes и экран обновляются вместе. Перед отправкой сверить Notes с экраном и с политикой конфиденциальности на сайте: везде одни и те же 30 дней и хранение по закону. Подробности в owner-checklist.md, решение Р4.
- Решение 21.10.2026 (owner-checklist.md, Р1 и шаг 2.1): Notes в этом виде идут и на Beta App Review, и на публичную проверку с аккаунта Individual. Раздел «WHO PUBLISHES THE APP» отвечает на правила 5.1.1(ix) и 5.2.1. До отправки директор подписывает письмо-разрешение (`authorization-letter.md`). Пока письмо не подписано (в том числе для внешнего TestFlight, шаг 13), в Notes заменить «with the company's written permission to use» на «with the company's permission to use» и убрать «; the signed letter from the company director is available on request». PR сайта №26 с абзацем о публикации выпускать только после подписания письма.
- Факты раздела «WHO PUBLISHES THE APP» подтвердил владелец 21.10.2026: файлы из приложения видят только студент и сотрудники EVO с доступом к его делу (доступ к документам в базе проверяется по делу, `private.platform_can_read_document_full`). **Требует повторного подтверждения владельцем до отправки (25.10.2026):** это подтверждение дано до согласия на ИИ-помощников. Теперь, если студент разрешил, документы и переписку читают ещё и ИИ-помощники сотрудников (Anthropic Claude и Google Gemini), поэтому слова «только» в этом факте и в Notes больше не верны; в Notes они заменены фразой «visible to the student, EVO staff with access to their case and, if the student allows it, the AI assistants staff use», владелец подтверждает эту формулировку; приложение само ничего не отправляет университетам, визовым центрам и посольствам (как в политике), заявки студенты подают сами или, по их просьбе, через куратора EVO. Формулировка совпадает с разделом «Кому мы передаём данные» политики на сайте (PR сайта №26), где сказано, что по просьбе студента кураторы подают заявления и документы в университеты. Файлы хранятся на сервере EVO (Supabase на собственном сервере с 20.10.2026). Если практика изменится, раздел нужно переписать до следующей отправки: неверное утверждение в Notes опаснее отказа.
- Если Apple откажет по 5.1.1(ix), запасной путь описан в owner-checklist.md, шаг 2.1, пункт 4.
- Согласие на ИИ-помощников (25.10.2026, правило 5.1.2(i)): карточка «ИИ-помощники EVO» на «Главной» и строка «ИИ-помощники» в «Профиле» (`AIConsentViews.swift`). В блоке Notes ИИ-помощники названы одной фразой в разделе «WHO PUBLISHES THE APP» (см. пункт выше про повторное подтверждение: прежнее «visible only to the student and EVO staff» после согласия на ИИ неверно, и Apple сверит Notes с карточкой). Отдельный абзац о согласии в блок не вписан: блок занимает 3961 байт из 4000 до подстановки `[[...]]` (3985 с подстановкой и CRLF), а абзац весит 290 байт, поэтому добавить его можно, только сократив другое место примерно на 280 байт, и пересчитать байты. Черновик на английском: `AI HELPERS: EVO staff use AI assistants (Anthropic Claude, Google Gemini) on a student's messages and case documents. The app asks for explicit permission on Home («ИИ-помощники EVO») and in Profile; if declined, the assistants do not read that student's documents or messages.` (290 байт). Карточку и строку видит только студент с делом EVO (с сопровождением): самостоятельный студент без дела не видит ни того, ни другого, поэтому review-аккаунт обязан быть с делом (так и требует Р3). У review-аккаунта с делом карточка видна, пока не выбран ответ; выбор записывается в рабочую систему, его можно сменить в «Профиле». Это зависит от миграции 320 (общий контракт согласия): до её выкатки RPC нет, и строка в «Профиле» покажет «Не удалось загрузить выбор».
- Пункт «PRIVACY» ссылается на ссылку в «Профиле» и под согласием в анкете (сделано в PR #1215, `PrivacyPolicyLink`). 17.10.2026 сама страница https://evoadmissions.com/ru/privacy/ отвечает 404: отправлять только после выпуска PR сайта №26 (owner-checklist.md, шаг 11, пункт 2).
- Во время проверки кто-то из команды должен отвечать в CRM на сообщения от review-аккаунта и не удалять его по запросу удаления.
- Проверяющий может отправить новую анкету с адреса Apple. Такие анкеты не одобрять; доставку письма подтверждения нужно проверить заранее (см. owner-checklist.md).

## Источники (проверено 07.10.2026)

- Поля App Review Information, лимит 4000 байт, требования к демо-аккаунту: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Правила 2.1 (демо-аккаунт), 3.1.1, 3.1.3(e), 5.1.1(i), 5.1.1(v), 5.1.1(ix), 5.2.1 (текст 5.1.1(ix) и 5.2.1 сверен 21.10.2026): https://developer.apple.com/app-store/review/guidelines/
- Удаление аккаунта: https://developer.apple.com/support/offering-account-deletion-in-your-app/
