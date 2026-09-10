# Полный университетский каталог — run 2026-09-10

Статус: COMPLETE — ELIGIBLE INSTITUTIONAL SCOPE / 143 PUBLISHED / 143 PHOTOS VERIFIED,
11 сентября 2026. Приложение `892558b2` принято; 143 карточки опубликованы.
Полное чтение пяти страниц подтвердило 143 уникальных ID и 251 программу,
все 16 прежних ID сохранены. После корректирующего выпуска загрузились 143/143
фото. Пакетная сверка: 143 актуальны, 0 конфликтов, 0 оставшихся публикаций.
Неподтверждённые поля программ перечислены ниже; полнота учреждений не означает
полноту всех возможных программ, цен и наборов каждого вуза.
Доказательства: [production acceptance ledger](references/2026-09-11-university-catalog-production-acceptance.md).
Tracking: [issue725](https://github.com/izzhackt/evo_AI_CRM/issues/725).
Владелец просит заполнить университеты из всей доступной институциональной базы
ЭВО и сырого бизнес-архива, дополнить официальными источниками и реальными фото,
выложить в production и показать ту же версию через localhost SSH tunnel.

## Холодное продолжение

1. Читать AGENTS.md, CONTEXT.md, DESIGN.md, этот план и свежую запись PLAN_CHANGES.
2. GitHub main — общая истина. Первичная ветка `izzhackt/university-catalog-completion`
   объединена PR726 в `88d0354f`; корректировка двух фото объединена PR727
   в `892558b2`. Последующее docs-only закрытие не требует нового выпуска.
   Не трогать другую грязную рабочую копию/ветку Inbox.
3. Последний принятый app `892558b2`, schema001–151, каталог143; перед новой
   работой проверить живые SHA/ledger/arm. Release34530968045 attempt1 принят,
   arm=false. Не повторять уже применённые миграции или публикацию пакета.
4. Прочитать source-roster и country/photo research в `references/`; статус
   candidate не равен approved. Независимое ревью точного HEAD обязательно.
5. Одна интеграция → PR checks → exact-current-main full CI → проверенный
   additive schema tail, если нужен → guarded release → обычная Admin-публикация
   → полный readback каталога и фото → evidence/closeout.

## Инвентаризация и границы

- База: `EVO_Знания`, четыре существующие физические границы. Не перемещать и не
  менять оригиналы. Институциональные заметки и бизнес-брошюры допустимы.
- Исключить trash, переписку, персональные документы заявителей, секреты и
  внутренние коммерческие условия. В Git только публично-безопасные производные,
  относительный source path, SHA256 и источник проверки.
- Учитывать все самостоятельные институциональные материалы, дедуплицировать
  названия/кампусы. Начальный Notion inventory:94 вуза,3 дубля,1 шаблон;
  raw archive добавляет вузы. Итоговый denominator фиксирует source-roster.
- Исторические INTI transfer-destination lists не означают сотни новых прямых
  программ ЭВО; учитывать как отдельный тип источника, не выдумывать партнёрства.
- Перепроверять скопированные города/страны, переименования и юрисдикции. Не
  считать папку «Дубай» доказательством дубайского кампуса (пример Schiller).
- Каждому учреждению: официальный сайт, страна/город, содержательное описание,
  подтверждённые программы/уровни/язык/длительность, условия и ссылки на приём,
  источник/дата проверки, реальное корректно подписанное фото с provenance.
- Устаревшие цены/скидки/сроки не становятся текущими. Неизвестная дата остаётся
  неизвестной; закрытый набор не показывается открытым. Важные ограничения
  отражаются рядом с фактом. Не обещать признание диплома/визу/партнёрство.
- Фото: реальные университетские изображения, преимущественно лицензированные
  Commons; проверять именно кампус. Автор, первичный источник и лицензия видимы.
  Исторический снимок явно датируется; отсутствие прав не выдавать за лицензию.
  Никаких AI-картинок, чужих кампусов или придуманного photo-success.

## Исполнение и ownership

| Поток | Ответственность | Состояние |
| --- | --- | --- |
| U1 | Полный source inventory, дедупликация, provenance/exclusions | Done for eligible institutional scope |
| U2 | Malaysia13: official facts + reviewed JSON | Done: 13 /39 programmes |
| U3 | China + raw additions: official facts + reviewed JSON | Done: 47 /94, including27 language |
| U4 | Europe/Turkey/UAE/other: official facts + reviewed JSON | Done: 83 institutions |
| U5 | Фото всего итогового roster, license/identity/availability | Done: 143/143 live loaded; two replacements accepted in PR727/release892558b2 |
| U6 | Интеграция existing catalogue и быстрая Admin batch review | Implemented; ordinary Admin RPCs |
| U7 | Проверки, независимое ревью, PR/CI/schema/release/publication | Done: PR726/727, exact-main CI and guarded releases accepted; schema151 once, 136 mutations, seven already current |
| U8 | Full live readback, tunnel, честные remaining gaps | Done: 143/251/16 legacy IDs, all photos, zero pending publications; staff + bounded Admin Student preview |

## Итоговый подготовленный пакет

143 учреждения, 251 проверенная программа, 15 стран: CN47, MY13, IT34, PL11,
CZ10, TR11, CY8, FR2, AT/AE/KR/US/MT/GB/AU по1.
Не считать все специализации каждого вуза заполненными: в текущем пакете
78 программ с неподтверждённым языком, 76 с неподтверждённой длительностью,
112 без подтверждённых данных о наборе. Эти поля не заменены догадками.
Три исторические китайские языковые программы явно требуют переподтверждения.

Non-MY roster:84 основных Notion-карточки +42 archive candidates; HIT Shenzhen
и BIT Beijing объединены с соответствующими институциями, не отдельные вузы.
Дополнительно сохранён ранее принятый UNNC. Malaysia13 и пять учреждений из
отдельных GEDU-брошюр дают финальные143. Transfer/recognition directory,
English Path как языковая школа, школы среднего образования и неназванные
предложения не становятся университетскими карточками.

Один новый runtime package в шести country/group JSON вместо прежнего initial
reviewed-content.json. Из прежней версии в tests оставлен только реальный
snapshot16 canonical identities. История исходного файла сохраняется в Git.
144 photo records:143 используются, HIT Shenzhen остаётся проверенным резервом.
Для APAC подтверждён небольшой снимок студии326×421: показывать компактно,
без растягивания. Исторические подписи видны под фотографией.

Исследование дополнено [Europe/international](references/2026-09-11-university-completion-europe-international.md),
[Other](references/2026-09-11-university-completion-other-research.md),
[Turkey](references/2026-09-10-university-completion-turkey-research.md).
Публикация, реальные версии, фото в браузере и release receipt подтверждены
отдельно в [acceptance ledger](references/2026-09-11-university-catalog-production-acceptance.md).
Подготовленный пакет сам по себе не был доказательством живых данных.

## Результат выпуска

- Основной PR726: managed migration151 применена один раз, 136 обычных Admin
  публикаций (127 новых /9 обновлений), семь карточек уже были актуальны.
- Корректирующий PR727: только два внешних фотоисточника; full CI34530087316
  и release34530968045 attempt1 прошли на точном `892558b2`. Повторной записи
  каталога или миграции не было. Healthy/restarts0, pending отсутствует,
  публичный HTTPS200, acceptance hash проверен, release arm=false.
- Свежий browser readback на принятом образе: 30/30/30/30/23 карточки,
  143 уникальных ID, 251 программа, 143 загруженных фото. Обе заменённые
  фотографии открылись также в read-only Admin Student preview.
- [Каталог через SSH tunnel](http://localhost:3000/v3/universities) и
  [production](https://evo-crm.72.62.119.112.sslip.io/v3/universities)
  показывают одну серверную версию/базу. Туннель должен оставаться запущенным.

## Минимальная техническая доработка

Продолжить existing UniversityContent, canonical institutions и immutable
publication revisions. Не создавать второй каталог/базу/синхронизацию с архивом.
Country JSON — editorial templates, никогда published fallback.

Для большого каталога добавить ограниченный Admin-only экран пакетной проверки:
видимые выбранные учреждения/изменения и явное подтверждение; последовательные
normal `stage_university_catalog_publication` / `review_university_catalog_publication`
под действующей Admin-сессией. Сохранять live authorization, exact baseVersion,
строгую валидацию, immutable identity и idempotency. Успех только по проверенной
квитанции; остановка/повтор не создаёт дубль. Никакой публикации при GET, прямого
SQL импорта, service-role обхода или изменения чужих незавершённых draft.
Существующую canonical identity не переписывать по неподтверждённой заметке;
необходимые identity corrections выносить отдельно, не обходить invariant.

Новые photo keys требуют coordinated forward migration151: расширить
проверенную библиотеку и добавить честный non-degree уровень `language`
(«Языковая программа») для реальных языковых программ из китайского архива;
это не foundation и не обещание дальнейшего зачисления. Сохранить все остальные
валидаторы и ACL. Применённые
148/150 не редактировать. Если исследование требует иной schema scope, сначала
дописать PLAN_CHANGES и получить review, не расширять незаметно.

UI сохраняет DESIGN.md: краткие карточки, поиск/страны/уровни, детали на отдельной
странице, понятный прогресс публикации. Не превращать каталог в плотную таблицу.

## Быстрая проверка и выпуск

- Реальный parser на всех кандидатах: unique keys/identity, HTTPS источники,
  даты, размеры, фото-key↔registry↔SQL, программы и отсутствие непубличных данных.
- Только затронутые contract tests, TypeScript/ESLint и schema compile по риску;
  затем один обязательный полный exact-main CI. Не плодить фиктивные сценарии.
- Независимое exact-head review; ни review, ни CI не заменяют реальные публикации.
- Один persistent Supabase, Auth включён. Standing owner decision: без новой
  backup/rehearsal, не спрашивать повторно. Остальные release gates сохраняются.
- Перед выпуском проверять arm; после release disarm/readback. Публичный HTTPS,
  accepted pointer, app image/restarts, pending state и ledger — отдельные факты.
- Порядок изменения живого каталога: schema151 → acceptance нового приложения
  → Admin-публикация. До публикации прежний образ `32693abb` совместим с прежними
  данными. После публикации новых photo keys / уровня `language` старый reader
  может отклонить целую страницу каталога: слепой откат к этому образу больше
  не является совместимым восстановлением. Нужен forward fix с новым reader
  либо отдельно проверенный совместимый rollback. Не переписывать immutable
  publication revisions и не ослаблять parser ради отката.
- Admin batch публикует только просмотренный frozen manifest; затем сверить
  все страницы/версии/уникальные identity и загрузку фото, staff + Admin preview.
  Не выдавать Admin preview за настоящий Student/private-session acceptance.
- `localhost:3000` — SSH tunnel к той же app на Hermes; не запускать вторую DB.

## Технические первоисточники

Проверены 2026-09-10: Supabase [RPC](https://supabase.com/docs/reference/javascript/rpc)
и [Database Functions](https://supabase.com/docs/guides/database/functions).
Используем именованные параметры существующих функций и их проверки доступа;
наличие RPC не предоставляет права. Context7 отказал из-за monthly quota,
поэтому прочитаны прямые официальные документы. Источники вузов и изображений
фиксируются отдельно по каждому учреждению, не заменяются этой ссылкой.

## Definition of done

Все eligible самостоятельные вузы имеют проверенную карточку и фото либо точный
задокументированный blocker; нет пропавших без статуса источников/дубликатов.
`Complete` для всех ставить только если blockers отсутствуют. Production data
подтверждены readback, код принят release, tunnel открыт; источники/решения/gaps
и точные SHA/run IDs сохранены в GitHub, а не только в локальном worktree.
