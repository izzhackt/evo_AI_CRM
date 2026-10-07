# App Privacy: ответы для App Store Connect

Основание: код ветки `izzhackt/ios-app-store-1-0` (PR #1172), iOS-клиент `ios/`, серверные маршруты `src/app/api/portal/*`, миграции `supabase/migrations/*`. Ссылки на код ниже даны по именам функций, а не по номерам строк: строки меняются с каждым PR.

Эти ответы и файл приватности приложения `ios/EVOAdmissions/Resources/PrivacyInfo.xcprivacy` совпадают один к одному: те же типы данных, у каждого «связан с пользователем: да», «tracking: нет», цель только App Functionality. Меняете одно, меняйте и другое в том же PR. Таблица соответствия в разделе 2.

Названия полей ниже даны как в английском интерфейсе App Store Connect. Если интерфейс открыт на русском, порядок вопросов тот же.

Где заполнять: App Store Connect → «Apps» → EVO Admissions → в боковой панели «App Privacy» → «Get Started». После всех ответов нажать «Publish». Ответы относятся ко всему приложению, а не к одной версии.

## 1. Главный вопрос

**Do you or your third-party partners collect data from this app?** → **Yes, we collect data from this app.**

Почему «да»: приложение отправляет на сервер EVO анкету, переписку, документы, ответы тестов и уроков, и сервер их хранит. По определению Apple это и есть сбор: данные покидают устройство и хранятся дольше, чем нужно для ответа на один запрос.

## 2. Что отметить

Для каждого отмеченного типа ответы одинаковые:

- **Linked to the user's identity:** Yes. Всё хранится в аккаунте студента. В файле приватности `NSPrivacyCollectedDataTypeLinked = true`.
- **Used for tracking:** No. Рекламы, рекламных SDK, IDFA и передачи брокерам данных нет. В файле приватности `NSPrivacyCollectedDataTypeTracking = false`, `NSPrivacyTracking = false`, список `NSPrivacyTrackingDomains` пуст.
- **Purposes:** только **App Functionality**. В файле приватности `NSPrivacyCollectedDataTypePurposeAppFunctionality`.

| Категория | Тип данных | Ключ в `PrivacyInfo.xcprivacy` | Что именно |
| --- | --- | --- | --- |
| Contact Info | Name | `NSPrivacyCollectedDataTypeName` | Имя и фамилия из анкеты |
| Contact Info | Email Address | `NSPrivacyCollectedDataTypeEmailAddress` | Email для входа, регистрации и «Забыли пароль?» |
| Contact Info | Phone Number | `NSPrivacyCollectedDataTypePhoneNumber` | Телефон из анкеты |
| Health & Fitness | Health | `NSPrivacyCollectedDataTypeHealth` | Медицинские документы, если их требует программа (например, Health Declaration Form) и студент загружает их в «Документы». Решение владельца, раздел 7 |
| Financial Info | Other Financial Info | `NSPrivacyCollectedDataTypeOtherFinancialInfo` | Бюджет на обучение и источник оплаты из анкеты; финансовые документы (выписки, письма спонсора), если студент их загружает |
| User Content | Emails or Text Messages | `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | Сообщения студента команде EVO в «Сообщения» |
| User Content | Photos or Videos | `NSPrivacyCollectedDataTypePhotosorVideos` | Файлы JPG и PNG, загруженные в «Документы»: фото студента, сканы |
| User Content | Customer Support | `NSPrivacyCollectedDataTypeCustomerSupport` | Запрос на консультацию: комментарий до 500 символов и выбранный вуз |
| User Content | Other User Content | `NSPrivacyCollectedDataTypeOtherUserContent` | Файлы PDF в «Документы»; ответы тестов и уроков; отправка комплекта документов |
| Identifiers | User ID | `NSPrivacyCollectedDataTypeUserID` | ID аккаунта (Supabase Auth) и участника; каждый запрос идёт с токеном этого аккаунта |
| Usage Data | Product Interaction | `NSPrivacyCollectedDataTypeProductInteraction` | Избранные вузы, прогресс уроков и попыток тестов, отметки «прочитано» в уведомлениях, выбранный язык, выбор программы для подготовки |
| Other Data | Other Data Types | `NSPrivacyCollectedDataTypeOtherDataTypes` | Ответы анкеты без контактов: страны, начало учёбы, уровень образования, средний балл и шкала, направления, ступень, гражданство, английский (экзамен и балл или самооценка), согласие и его версия |

Итого 12 типов, в файле приватности 12 записей. После публикации карточка в App Store покажет блок «Data Linked to You» с категориями: Contact Info, Health & Fitness, Financial Info, User Content, Identifiers, Usage Data, Other Data. Блока «Data Used to Track You» не будет.

## 3. Что не отмечать и почему

| Тип данных | Ответ | Основание в коде |
| --- | --- | --- |
| Physical Address, Other User Contact Info | Не собирается | В анкете нет адреса и других контактов (`StudentApplicationDraft` в `Services/ApplicationIntakeModels.swift`) |
| Payment Info, Credit Info | Не собирается | Оплаты в приложении нет. Экран «Оплата» только читает начисления, которые сотрудники ведут в CRM (`SupabaseService.studentPortalFinance`, RPC `student_portal_finance_v2`) |
| Purchases (Purchase History) | Не собирается | Покупок в приложении нет; начисления создаёт не приложение, а сотрудники |
| Precise Location, Coarse Location | Не собирается | Карта на MapKit показывает только точки кампусов из библиотеки `src/lib/university-geo-library.json`; CoreLocation и разрешения на геолокацию нет (`Views/UniversitiesMapView.swift`, в `Info.plist` нет ключей `NSLocation*`) |
| Sensitive Info | Не собирается | Приложение не спрашивает этническую принадлежность, религию, взгляды, биометрию. Гражданство это не этническая принадлежность в смысле Apple |
| Contacts | Не собирается | Доступа к контактам нет |
| Audio Data, Gameplay Content | Не собирается | Нет записи звука и игр |
| Browsing History | Не собирается | Внешние ссылки (источник срока, лицензия фото) открываются в Safari, встроенного браузера нет |
| Search History | Не собирается | Поисковая строка каталога уходит в `student_university_catalog` в теле POST только для ответа; функция `STABLE` и ничего не записывает (`SupabaseService.studentUniversityCatalog`, `supabase/migrations/148_platform_university_catalog_publication.sql`) |
| Device ID | Не собирается | IDFA, IDFV и App Tracking Transparency в коде нет |
| Advertising Data, Other Usage Data | Не собирается | Рекламы и аналитики нет |
| Crash Data, Performance Data, Other Diagnostic Data | Не собирается | SDK аналитики и сбора сбоев нет; зависимости только `supabase-swift` и его пакеты (`Package.resolved`). Отчёты о сбоях, которые собирает сама Apple, Apple не требует указывать. Заголовок `X-Client-Info` от `supabase-swift` содержит версию SDK и версию iOS: это техническая строка запроса, EVO её не сохраняет и не использует (см. раздел 7, пункт 4) |
| Fitness, Surroundings, Body | Не собирается | Нет HealthKit, Motion, ARKit |
| Пароль | Не указывается | Supabase Auth хранит только хеш пароля. По определению Apple сбор означает хранение «in a readable form» |

На устройстве, без отправки на сервер: черновик анкеты в `UserDefaults` (`Views/ApplicationWizardView.swift`), выбранный язык в `UserDefaults` под ключом `AppleLanguages` (`ProfileViewModel.saveLanguage` в `Views/ProfileView.swift`), сессия входа в Keychain (`Services/SupabaseService.swift`, заголовочный комментарий), ожидающие отправки документы и комплекты в Application Support (`Services/ApplicationDocumentPending.swift`, `Services/ApplicationPackagePending.swift`). Это не сбор по определению Apple.

## 4. Карта: ответ и код, который отправляет данные

Пути относительно `ios/EVOAdmissions/`.

| Ответ | Экран | Код отправки | Куда уходит |
| --- | --- | --- | --- |
| Name, Phone Number, Other Financial Info (бюджет, источник оплаты), Other Data Types (анкета) | «Подать анкету», 9 шагов | Поля `StudentApplicationDraft` в `Services/ApplicationIntakeModels.swift`; создание аккаунта `SupabaseService.registerStudentAccount` (тело `StudentRegistrationPayload`); отправка анкеты `SupabaseService.submitStudentApplication` | `POST https://app.evoadmissions.com/api/portal/registration`, затем RPC `submit_student_application_v1` |
| Email Address | «Войти», «Забыли пароль?», анкета | `Views/SignInView.swift` → `SupabaseService.signIn`, `SupabaseService.requestPasswordReset`; `SupabaseService.registerStudentAccount`. По приглашению email уже есть в аккаунте, который создали сотрудники: `InviteEntryView` отправляет только код ссылки (`SupabaseService.verifyStudentInviteToken`) и новый пароль (`updateOwnPassword`) | Supabase Auth; маршрут регистрации |
| User ID | Все экраны после входа | Токен сессии в каждом RPC; `SupabaseService.currentAccessToken` для маршрутов документов и приглашения | Supabase, `app.evoadmissions.com/api/portal/*` |
| Emails or Text Messages | «Моё поступление» → «Сообщения» | `MessagesThreadView` (`send`) → `SupabaseService.postPortalCaseChatMessage` | RPC переписки по делу (миграция 200) |
| Customer Support | «Записаться на консультацию» в «Профиле» и карточке вуза | `ConsultationRequestSheet` (`submit`) → `SupabaseService.createConsultationRequest` | RPC `create_portal_consultation_request_v1`, очередь «Заявки» CRM |
| Photos or Videos, Other User Content (PDF), Health, Other Financial Info (документы) | «Документы», документы программы | Выбор файла `.fileImporter` в `Views/AdmissionDocumentsView.swift` и `Views/ProgramDocumentView.swift` (только `.pdf`, `.jpeg`, `.png` из «Файлов»); загрузка `PortalDocumentTransfer.uploadRequest` и `Services/ApplicationDocumentUpload.swift`; отправка `SupabaseService.submitApplicationDocument`, `submitApplicationPackage` в `Services/ApplicationPackageService.swift` | `POST /api/portal/document-slots/{id}/versions`, `POST /api/portal/application-document-uploads`, затем приватное хранилище Supabase |
| Other User Content (ответы тестов) | «Тест по английскому», «Тест интересов» | `SupabaseService.startAssessment`, `saveAssessmentAnswers`, `completeAssessment` | RPC `start/save/complete_student_assessment_…_v1` (миграция 135, доступ только у самого студента) |
| Other User Content (ответы уроков), Product Interaction (прогресс) | «Английский», урок, «Повторить ошибки» | `SupabaseService.startLearningLesson`, `saveLearningAnswer`, `completeLearningLesson`, `checkLearningReviewAnswer` | RPC уроков (миграция 198) |
| Product Interaction (избранное) | Сердечко в каталоге и карточке вуза | `FavoritesStore.toggle` → `SupabaseService.setUniversityFavorite` | RPC избранного (миграция 195) |
| Product Interaction (язык) | «Профиль» → язык | `ProfileViewModel.saveLanguage` → `SupabaseService.setOwnPortalLanguage` | `set_own_portal_language_v1` (миграция 196) |
| Product Interaction (прочитано) | «Уведомления» | `SupabaseService.markNotificationRead` | `mark_own_student_portal_notification_read_v2` |
| Product Interaction (выбор программы) | «Начать подготовку» в карточке вуза | `SupabaseService.selectCatalogIntake`, `initializeApplicationRequirements` | RPC подготовки программы |
| Запрос на удаление аккаунта | «Профиль» → «Удаление аккаунта» | `ProfileViewModel.requestDeletion` → `SupabaseService.requestAccountDeletion` | `request_account_deletion_v1`; сам вызов ничего не удаляет |

## 5. Файл приватности: API с обязательной причиной и SDK

Apple требует указать причину для каждой группы API из списка «required reason API». Код приложения проверен поиском по всем группам списка (проверено 07.10.2026):

| Группа Apple | Что есть в коде | Запись в `PrivacyInfo.xcprivacy` |
| --- | --- | --- |
| User defaults (`UserDefaults`) | Черновик анкеты (`ApplicationWizardView.swift`, `ApplicationStatusView.swift`) и язык интерфейса `AppleLanguages` (`ProfileView.swift`), всё в собственном `UserDefaults.standard` приложения | `NSPrivacyAccessedAPICategoryUserDefaults`, причина `CA92.1`: чтение и запись данных, доступных только самому приложению |
| File timestamp (`creationDate`, `modificationDate`, `contentModificationDateKey`, `stat` и другие) | Нет. Файлы читаются через `resourceValues` с ключами `.fileSizeKey`, `.contentTypeKey`, `.isRegularFileKey`, они не входят в список | Нет записи |
| System boot time (`systemUptime`, `mach_absolute_time`) | Нет | Нет записи |
| Disk space (`volumeAvailableCapacityKey`, `statfs` и другие) | Нет | Нет записи |
| Active keyboards (`activeInputModes`) | Нет | Нет записи |

Пакеты из `Package.resolved` проверены тем же поиском по исходникам:

- `supabase-swift` 2.55.2 (ревизия `40344fb3`) **не содержит** своего `PrivacyInfo.xcprivacy`. В его исходниках нет вызовов API из списка Apple; сессия хранится в Keychain, это не API с обязательной причиной. Данные, которые проходят через SDK, уже описаны в файле приватности приложения как данные самого приложения. Если новая версия SDK добавит свой файл приватности или такие вызовы, файл приложения нужно пересмотреть.
- `swift-crypto` 4.5.2 приносит свои файлы приватности (пустые: без сбора и без API с причиной); в собранном `.app` лежит `swift-crypto_Crypto.bundle/PrivacyInfo.xcprivacy`.
- `swift-asn1`, `swift-clocks`, `swift-concurrency-extras`, `swift-http-types`, `xctest-dynamic-overlay`: файлов приватности нет, вызовов API из списка в исходниках нет.

Отчёт Xcode: после архива «Window» → «Organizer» → правый клик по архиву → «Generate Privacy Report». Отчёт собирает файлы приватности приложения и пакетов; сверить его с разделом 2 до заполнения App Store Connect.

## 6. Кто ещё обрабатывает данные (для политики конфиденциальности)

Сторонних SDK сбора данных в приложении нет. Данные обрабатывают поставщики инфраструктуры EVO:

- Supabase: база данных, вход (Auth) и хранилище документов.
- Веб-сервер EVO на VPS (`app.evoadmissions.com`): маршруты регистрации, приглашения, загрузки и скачивания документов.
- Resend: отправка писем подтверждения, приглашений и восстановления пароля (почтовый сервер Supabase Auth).
- Apple: карта MapKit. Данные, которые собирает Apple, по правилам Apple не указываются.
- Wikimedia Commons и сайты вузов: с их адресов загружаются фото кампусов. Эти сайты видят IP-адрес устройства при загрузке картинки, EVO эти данные не получает.

Правило 5.1.1(i) требует, чтобы политика конфиденциальности называла собираемые данные, третьих лиц с доступом к ним, срок хранения и способ запросить удаление. Список выше нужно передать команде, которая готовит страницу https://evoadmissions.com/ru/privacy/.

## 7. Что подтверждает владелец

1. **Health.** Отмечен и в этих ответах, и в файле приватности. Правила Apple относят к Health «any other user provided health or medical data». В плейбуках поступления есть медицинские документы (например, Health Declaration Form для Малайзии, `supabase/migrations/138_platform_admissions_playbook_content.sql`). Если EVO никогда не просит медицинские документы через кабинет, Health снимается в обоих местах одним PR.
2. **Маркетинг.** Ответы выше верны, если контакты из анкеты используются только для заявки и сопровождения. Если EVO будет отправлять по ним рекламные рассылки или продающие сообщения, для Name, Email Address и Phone Number нужно добавить цель **Developer's Advertising or Marketing** (в файле приватности `NSPrivacyCollectedDataTypePurposeDeveloperAdvertising`).
3. **Аналитика.** Если команда разбирает ответы анкеты в сводных отчётах для планирования (страны, бюджеты, аудитория), Apple считает это целью **Analytics**. Тогда её нужно добавить к Other Data Types и Other Financial Info (в файле приватности `NSPrivacyCollectedDataTypePurposeAnalytics`).
4. **IP-адреса и заголовки в серверных журналах.** Apple не требует указывать IP-адрес и технические заголовки, если они не хранятся и не используются. Если журналы Supabase или веб-сервера хранят IP и `X-Client-Info` дольше, чем нужно для ответа, это покрывается уже отмеченным Other Data Types с целью App Functionality (безопасность). Настройки хранения журналов в рабочей системе не проверялись.

## Источники (проверено 07.10.2026)

- Определения сбора, типов данных, целей, tracking и linked data: https://developer.apple.com/app-store/app-privacy-details/
- Ключи файла приватности и список типов данных: https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- API с обязательной причиной и коды причин: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Правила 5.1.1(i), 5.1.1(ii), 5.1.1(iii), 5.1.2(i): https://developer.apple.com/app-store/review/guidelines/
- Поле Privacy Policy URL: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- Код: ветка `izzhackt/ios-app-store-1-0`, функции и файлы указаны в таблицах.
