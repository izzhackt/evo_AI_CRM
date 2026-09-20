# Воронка — сброс сотрудника, 21 сентября 2026

База `f97122e83ca65013eeac3eb51919477b9b0e16bd`; контракт до кода
`310b9c4d6bc60bfd76c4f9f1ceb540b27149e07e`; runtime
`effebf499285ff1fd9965328bf357853e1fe6b80`.

Одна строка привязывает lifecycle owner select к применённому URL owner.
После клиентского reset или Back/Forward defaultValue снова соответствует
выдаче. Страница, доска, остальные формы, readers/SQL и разрешения не меняются.
Это остаток фильтра из пунктов 6/10, не завершение всей мобильной воронки.

## Реальный путь

Существующая ordinary Local QA Sales, собственный localhost33221, локальная БД.
Только GET/навигация и незаписанный текст. Никаких мутаций, новых записей,
Auth/role changes, provider или production действий.

- Baseline повторно доказан A на source35ce5c0, побайтно совпадающем с base:
  после reset URL чистый и7карточек, но видимый Local Admin остаётся; следующий
  поиск снова отправляет старого owner. Private receipt/изображение:
  `/private/tmp/evo-owner-filter-reset-{baseline,followup}.json`,
  `/private/tmp/evo-owner-filter-reset-baseline.png`.
- После исправления: Local Admin → Найти =1карточка; «Сбросить всё» =
  «Все сотрудники»,7карточек и URL `/v3/pipeline`.
- Незаписанное поле «Имя» соседней формы лида сохраняется после reset.
  Использован только временный QA-текст, затем очищен без сохранения.
- Back возвращает Local Admin/1карточку; Forward — все/7карточек.
- Последующий поиск существующего `Local QA sale following` возвращает1карточку,
  owner остаётся пустым. GET form сериализует `owner=`, который существующий
  parser нормализует в null; прежнего owner ID больше нет.
- Ссылки «Новый» и «Сегодня» сохраняют query и друг друга; owner пуст.
  Reset очищает query/stage/due и возвращает7карточек.
- Actual mobile390: innerWidth/clientWidth/scrollWidth=390, поле доступно,
  изменения layout отсутствуют. Клавиатурный Enter на reset работает.
  Один pointer-клик после переключения Chrome mobile emulation не завершил
  переход и оставил фокус в поиске; он не засчитан. После свежего snapshot
  проверен фактический keyboard transition. Эмуляция затем отключена.

ESLint изменённого файла, `npm run typecheck`, `git diff --check` PASS.
Impeccable detector изменённого файла:0findings. Лог типов:
`/tmp/evo-pipeline-filter-reset-types.log`.
Новый тест, зеркалящий единственную JSX-строку, не добавлялся; реальный путь
проверен выше. Недоступные owner options/другие роли не создавались и не
перепроверялись: соответствующие ветви исходников не изменены.
