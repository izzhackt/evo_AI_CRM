# Страница App Store: английский (дополнительная локализация)

Тексты на английском для второй локализации. Интерфейс приложения только на русском и кыргызском, поэтому описание прямо это говорит и даёт русские подписи кнопок в «ёлочках» с переводом.

## Какую английскую локаль выбрать (решение владельца)

По таблице Apple витрины Кыргызстана, Казахстана, Узбекистана и Таджикистана поддерживают для метаданных только English (U.K.). Apple пишет: локализованные ключевые слова ищутся в странах, где витрина поддерживает этот язык, а где подходящей локализации нет, страница показывается на основном языке.

- **English (U.S.)**, рекомендация. В витрине Кыргызстана нет нашей English (U.K.), поэтому там работает основной русский язык и, по логике правила Apple, русские ключевые слова. Пользователь с английским языком устройства увидит английский текст.
- **English (U.K.)**. Витрина Кыргызстана будет индексировать английские ключевые слова этой локали, а не русские. Для русскоязычного поиска в Кыргызстане это хуже.

Как именно Apple индексирует основной язык в витрине без подходящей локали, в документации прямо не сказано. После выпуска стоит проверить поиск по русским словам в App Store Кыргызстана. Тексты ниже написаны в американском написании; для English (U.K.) поменять catalog/catalogue, program/programme, favorites/favourites.

## Счётчики

| Поле | Длина | Лимит Apple |
| --- | --- | --- |
| Название | 14 | 30 |
| Подзаголовок | 27 | 30 |
| Рекламный текст | 159 | 170 |
| Описание | 2368 | 4000 |
| Ключевые слова | 91 симв., 91 байт | 100 байт |

## Name

```
EVO Admissions
```

## Subtitle

```
Study abroad student portal
```

## Promotional Text

```
University catalog with a map, English lessons from zero, tests and career cards. EVO clients follow their case, documents, charges and messages with the team.
```

## Description

```
EVO supports students applying to universities abroad. The EVO Admissions app opens the same personal account as app.evoadmissions.com: one login and the same data on your phone and in the browser.

The app interface is in Russian and Kyrgyz.

HOW TO GET ACCESS
You need an EVO account to sign in. New users tap «Подать анкету» (Apply) and answer questions about countries, start date, education, study areas, English and budget. Then they confirm their email. The EVO team reviews the application. Until a decision is made, the app shows only the application status. After approval, the account opens.
If EVO has sent you an invitation, tap «У меня есть приглашение» (I have an invitation) and paste the link or code from the email.

UNIVERSITIES
• University catalog as a list and on a map.
• Search by name, filters by country and study level.
• University card: campus photo with its source, programs, intakes and application deadlines with a link to the source.
• Favorites and comparison of saved universities.
• Consultation request: an EVO manager will contact you.

ENGLISH
• Lessons for complete beginners, explained in Russian or Kyrgyz.
• Answers are checked right away. Tasks you got wrong go to a review list.
• The English test shows results by topic with advice. It is not a language level certificate.

CAREERS
• Career cards: a day in the job, skills, what is interesting and what is hard, a sample task.
• Where to study for the career and matching programs in the EVO catalog.
• The interests test shows which areas of work suit you.

Only you see your test answers and results. You can pause a test and continue later.

FOR STUDENTS WITH EVO SUPPORT
• My admission: case status, current stage and your next step.
• Documents: checklist, comments from the EVO team, upload of PDF, JPG or PNG files from the Files app.
• Preparation for the chosen program: requirements and program documents.
• Payments: charges under your contract, due dates and status. You cannot pay in the app.
• Messages: chat with the EVO team about your case.
• Notifications: decisions on documents and payment deadlines, shown inside the app. There are no push notifications.

PROFILE
• Interface language: Russian or Kyrgyz. Your choice is saved to your account and applies on all your devices.
• Sign out and account deletion request.

Questions: evoadmissions@gmail.com
```

## Keywords

```
university,college,applicant,english,lessons,test,career,professions,campus,bachelor,master
```

Слов из названия и подзаголовка (EVO, admissions, study, abroad, student, portal) нет. Названий других приложений и компаний нет.

## Категории, ссылки, Copyright

Те же, что в listing-ru.md: Education и Reference; Support URL https://evoadmissions.com/ru/support/, Privacy Policy URL https://evoadmissions.com/ru/privacy/, Marketing URL https://evoadmissions.com/ru/, Copyright «2026 EVO Admissions». Support URL и Marketing URL можно задать отдельно для этой локали, если появятся английские страницы сайта; сейчас указаны русские.

## Источники (проверено 07.10.2026)

- Лимиты полей, правило 100 байт для ключевых слов, требования к Support URL и Copyright: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Название и подзаголовок до 30 символов, категории, Privacy Policy URL: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- Правила метаданных 2.3.7, 2.3.8, 2.3.10: https://developer.apple.com/app-store/review/guidelines/
- Определения категорий: https://developer.apple.com/app-store/categories/
- Языки витрин и правило показа локализаций: https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations и https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information/
- Факты о приложении: книга продукта `output/app-store/inputs/book.json` в основной папке, вне Git (главы «Приложение для iPhone» и «Кабинет студента»), код ветки `izzhackt/ios-app-store-1-0`: `ios/project.yml`, `ios/EVOAdmissions/Resources/Localizable.xcstrings`, `ios/EVOAdmissions/Views/*.swift`.
