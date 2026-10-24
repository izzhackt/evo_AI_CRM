# Страница App Store: английский (дополнительная локализация)

Тексты на английском для второй локализации. Интерфейс приложения только на русском и кыргызском, поэтому описание прямо это говорит и даёт русские подписи кнопок в «ёлочках» с переводом. Содержание совпадает с listing-ru.md (версия 1.1, первая отправка в App Store; код слит PR #1215, обновлено 17.10.2026).

## Какую английскую локаль выбрать (решение владельца)

По таблице Apple (проверено 07.10.2026) витрины Кыргызстана, Казахстана, Узбекистана, Таджикистана и всех остальных стран из списка владельца (`owner-checklist.md`, шаг 9: СНГ и Азия без ЕС и Китая) поддерживают для метаданных English (U.K.). Отличаются две витрины: в России основной язык русский (плюс English (U.K.) и украинский), в Японии основной японский, а английский указан как English (US); это единственная витрина списка с English (US). Apple пишет: локализованные ключевые слова ищутся в странах, где витрина поддерживает этот язык, а где подходящей локализации нет, страница показывается на основном языке.

- **English (U.S.)**, рекомендация. В витрине Кыргызстана нет нашей English (U.K.), поэтому там работает основной русский язык и, по логике правила Apple, русские ключевые слова. Интерфейс приложения только русский и кыргызский, поэтому для СНГ русские ключевые слова важнее. Цена: в азиатских витринах списка английская локаль U.S. не совпадает с их English (U.K.), и страница там может показываться на основном русском языке; как именно Apple это решает, она не описывает.
- **English (U.K.)**. Совпадает с витринами Азии из списка и даёт им английский текст и ключевые слова. Витрина Кыргызстана и другие витрины СНГ с одним English (U.K.) будут индексировать английские ключевые слова этой локали, а не русские. Для русскоязычного поиска в Кыргызстане это хуже. Если владелец хочет искать по-английски в Азии, выбирать этот вариант.

Как именно Apple индексирует основной язык в витрине без подходящей локали, в документации прямо не сказано. После выпуска стоит проверить поиск по русским словам в App Store Кыргызстана и по английским в одной азиатской витрине (например, Малайзии). Тексты ниже написаны в американском написании; для English (U.K.) поменять catalog/catalogue, program/programme, favorites/favourites.

## Счётчики

| Поле | Длина | Лимит Apple |
| --- | --- | --- |
| Название | 14 | 30 |
| Подзаголовок | 27 | 30 |
| Рекламный текст | 149 | 170 |
| Описание | 3275 | 4000 |
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
Admission path by country, universities with a map and costs, English from zero and CSCA prep. EVO clients follow their case, documents and messages.
```

## Description

```
EVO supports students applying to universities abroad. The EVO Admissions app opens the same personal account as app.evoadmissions.com: one login and the same data on your phone and in the browser.

The app interface is in Russian and Kyrgyz.

HOW TO GET ACCESS
You need an EVO account to sign in. New users tap «Подать анкету» (Apply) and answer questions about countries, start date, education, study areas, English and budget. Then they confirm their email. The EVO team reviews the application. Until a decision is made, the app shows only the application status. After approval, the account opens.
If EVO has sent you an invitation, tap «У меня есть приглашение» (I have an invitation) and paste the link or code from the email.

ADMISSION PATH
• On Home: the admission steps for the country you choose, approximate timing, what to do at each step and when the step is done.
• Change the country at any time with «Сменить страну» (Change country).

UNIVERSITIES
• Catalog by country and city: country and city overviews, interesting facts, the universities of each city.
• Map of the universities in a country.
• Search for a university by name.
• University card: campus photo with its source, programs, intakes and application deadlines with a link to the source, approximate tuition and accommodation costs with their source and check date.
• Favorites and comparison of saved universities.
• Consultation request: an EVO manager will contact you.

ENGLISH
• Lessons for complete beginners, explained in Russian or Kyrgyz.
• Answers are checked right away. Tasks you got wrong go to a review list.
• The English test shows results by topic with advice. It is not a language level certificate.

CSCA PREPARATION
• The «CSCA» section in the English tab: math in English for the CSCA exam taken by applicants to universities in China.
• Lessons with formulas and graphs, practice with explanations, a diagnostic test and a timed mock test.
• Mistakes come back after 1, 3, 7 and 14 days; Progress shows topics and pace.
• Calendar of CSCA sessions with dates from csca.cn.
• The tasks are written by the EVO team. A test result is EVO's estimate on our tasks, not a CSCA score.

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
• Privacy policy and open source licenses.
• Sign out and account deletion request.

Questions: evoadmissions@gmail.com
```

## Keywords

```
university,college,applicant,english,lessons,test,career,professions,campus,bachelor,master
```

Слов из названия и подзаголовка (EVO, admissions, study, abroad, student, portal) нет. Названий других приложений и компаний нет.

## Категории, ссылки, Copyright

Те же, что в listing-ru.md: Education и Reference; Support URL https://evoadmissions.com/ru/support/, Privacy Policy URL https://evoadmissions.com/ru/privacy/, Marketing URL https://evoadmissions.com/ru/, Copyright «2026 EVO Admissions LLC». Support URL и Marketing URL можно задать отдельно для этой локали, если появятся английские страницы сайта; сейчас указаны русские. PR сайта №26 готовит и английские страницы `/privacy/` и `/support/`; после его выпуска их можно указать здесь (решение владельца). 17.10.2026 все эти адреса отвечают 404, это блокер отправки (listing-ru.md, «Что проверить до отправки»).

## Источники (проверено 07.10.2026)

- Лимиты полей, правило 100 байт для ключевых слов, требования к Support URL и Copyright: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Название и подзаголовок до 30 символов, категории, Privacy Policy URL: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- Правила метаданных 2.3.7, 2.3.8, 2.3.10: https://developer.apple.com/app-store/review/guidelines/
- Определения категорий: https://developer.apple.com/app-store/categories/
- Языки витрин и правило показа локализаций: https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations и https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information/
- Факты о приложении: книга продукта `output/app-store/inputs/book.json` в основной папке, вне Git (главы «Приложение для iPhone» и «Кабинет студента»), код сводной ветки `izzhackt/ios-1-1-integration` (PR #1215): `ios/project.yml`, `ios/EVOAdmissions/Resources/Localizable.xcstrings`, `ios/EVOAdmissions/Resources/CSCA.xcstrings`, `ios/EVOAdmissions/Views/*.swift`, `ios/EVOAdmissions/Views/CSCA/*.swift`.
