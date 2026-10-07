# Возрастной рейтинг: ответы на анкету Apple

Итог: **4+**. Ни один ответ ниже не поднимает рейтинг выше 4+.

Где заполнять: App Store Connect → «Apps» → EVO Admissions → в боковой панели «General» → «App Information» → под «Age Ratings» кнопка «Set Up Age Ratings». Анкета действует с 31.01.2026 в новой системе рейтингов Apple (4+, 9+, 13+, 16+, 18+).

Основание: код ветки `izzhackt/ios-app-store-1-0` (PR #1172), книга продукта (`output/app-store/inputs/book.json` в основной папке, вне Git), учебный контент в `supabase/migrations/136_platform_student_assessment_content.sql` и `199_platform_learning_content_v1.sql`.

## Шаг 1. In-App Controls

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Parental Controls | No | В приложении нет родительского контроля |
| Age Assurance | No | Приложение не проверяет возраст и не вызывает Declared Age Range API |

## Шаг 1. Capabilities

| Вопрос | Ответ | Влияние | Почему |
| --- | --- | --- | --- |
| Unrestricted Web Access | None | нет | Встроенного браузера и WebView нет. Ссылки на источник срока подачи, лицензию фото и источники карточек профессий открываются в Safari (`Link` в `UniversityDetailView.swift`, `ProfessionsView.swift`, `ProgramDocumentView.swift`) |
| User-Generated Content | None | нет | Apple понимает под этим «broad distribution» контента пользователей. Сообщения и документы студента видит только он сам и сотрудники EVO по его делу. Другие студенты их не видят, ленты и публичных публикаций нет |
| Social Media | None | нет | Ленты, лайков, комментариев и подписок нет |
| Social Media Disabled for Users Under 13 | None | нет | Социальных функций нет |
| Messaging and Chat | **Yes**, рекомендация | остаётся 4+ | Студент пишет команде EVO в «Сообщения» по своему делу. Студенты друг с другом не переписываются. Apple определяет пункт как общение пользователей «with one another»; сотрудники EVO работают в CRM, а не в приложении, поэтому можно ответить и None. Ответ Yes честнее для проверяющего и по таблице Apple оставляет 4+ |
| Advertising | None | нет | Рекламы и платного продвижения нет. Карточки вузов это каталог EVO, а не оплаченная реклама |

## Mature Themes

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Profanity or Crude Humor | None | Тексты уроков, тестов и карточек профессий нейтральные |
| Horror/Fear Themes | None | Нет |
| Alcohol, Tobacco, or Drug Use or References | None | Поиск по учебному контенту (136, 199) не нашёл упоминаний алкоголя, табака и наркотиков |

## Medical or Wellness

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Medical or Treatment Information | None | Приложение не даёт медицинских советов. Карточки профессий описывают работу, а не лечение. Загрузка медицинской справки по требованию вуза это документ дела, а не медицинская информация в приложении |
| Health or Wellness Topics | None | Нет советов о питании, спорте, самочувствии |

## Sexuality or Nudity

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Mature or Suggestive Themes | None | В тесте интересов есть утверждения «Быть сотрудником полиции» и «Выдвигать свою кандидатуру на политическую должность»: это выбор профессии, а не тема преступлений или политического конфликта |
| Sexual Content or Nudity | None | Нет |
| Graphic Sexual Content and Nudity | None | Нет |

## Violence

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Cartoon or Fantasy Violence | None | Нет |
| Realistic Violence | None | Нет |
| Prolonged Graphic or Sadistic Realistic Violence | None | Нет |
| Guns or Other Weapons | None | Нет |

## Chance-Based Activities

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Gambling | None | Нет ставок и денег в приложении |
| Simulated Gambling | None | Нет |
| Contests | None | Тесты и уроки личные: результат видит только студент, рейтингов, наград и соревнования с другими нет. Даже ответ Infrequent оставил бы 4+; ответ Frequent дал бы 13+, он не соответствует приложению |
| Loot Boxes | None | Покупок нет |

## Шаг 6. Additional Information

| Поле | Ответ | Почему |
| --- | --- | --- |
| Made for Kids | Не выбирать | Приложение для абитуриентов и студентов, а не для детской категории. Выбор нельзя отменить после одобрения |
| Override to Higher Age Rating | Не выбирать | Причин поднимать рейтинг нет |
| Age Suitability URL | Пусто | Поле необязательное |

## Результат

- Рейтинг Apple: **4+**.
- Региональные рейтинги (Австралия, Бразилия, Корея и другие) App Store Connect считает сам из тех же ответов.
- Правило 2.3.8: скриншоты и иконка должны подходить для 4+ при любом рейтинге. Снимки экрана с демо-стенда этому соответствуют.

## Когда ответы придётся пересмотреть

- Если появится общение студентов между собой, общий чат или публичные отзывы: User-Generated Content или Social Media, плюс требования правила 1.2 (жалобы, блокировка, фильтр).
- Если в приложение добавят встроенный браузер: Unrestricted Web Access даёт 16+.
- Если в учебные тексты попадут темы алкоголя, насилия или медицины: пересчитать по таблице Apple.

## Источники (проверено 07.10.2026)

- Вопросы, определения и рейтинги: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions
- Где и как заполнять, Made for Kids, Override, Age Suitability URL: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating
- Срок 31.01.2026 и новая система рейтингов: https://developer.apple.com/news/upcoming-requirements/
- Правила 1.2, 2.3.6, 2.3.8: https://developer.apple.com/app-store/review/guidelines/
