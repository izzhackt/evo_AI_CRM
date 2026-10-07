# EVO Admissions 1.0: документы для App Store Connect

Тексты и ответы, которые владелец вставляет в App Store Connect, и чеклист выпуска. Сверены с кодом ветки `izzhackt/ios-app-store-1-0` (PR #1172) 07.10.2026. Черновики писались в `output/app-store/store-docs/` основной папки (вне Git); в Git лежат эти версии.

| Файл | Что внутри | Куда в App Store Connect |
| --- | --- | --- |
| `owner-checklist.md` | Решения владельца Р1..Р12, шаги от вступления в Apple Developer Program до выпуска, кто что делает | Весь путь |
| `listing-ru.md` | Название, подзаголовок, рекламный текст, описание, ключевые слова, категории, ссылки (основной язык) | «App Information», страница версии |
| `listing-en.md` | То же на английском и выбор английской локали | Локализация English |
| `app-privacy.md` | Ответы App Privacy, их соответствие файлу приватности, карта «данные, экран, код» | «App Privacy» |
| `age-rating.md` | Ответы анкеты возрастного рейтинга, итог 4+ | «App Information» → «Age Ratings» |
| `review-notes.md` | Шаблон «App Review Information» и текст «Notes» для проверяющего | Страница версии, «App Review Information» |

Правила:

- `app-privacy.md` и `ios/EVOAdmissions/Resources/PrivacyInfo.xcprivacy` совпадают один к одному: 12 типов данных, все связаны с аккаунтом, без tracking, цель только App Functionality. Меняются в одном PR.
- Версия в App Store Connect `1.0.0`, ровно как `MARKETING_VERSION` в `ios/project.yml`.
- Заполненный `review-notes.md` (имя, телефон, данные review-аккаунта), Team ID, ключи и пароли в Git не попадают.
- Публичный контакт во всех текстах: evoadmissions@gmail.com.
- Порядок сборки и загрузки: `ios/README.md`, «Выпуск в App Store».
