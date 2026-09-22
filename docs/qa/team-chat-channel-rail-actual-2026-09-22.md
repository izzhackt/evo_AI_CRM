# A15 channel rail — фактическая проверка, 22.09.2026

Проверен неизменный product source `bab531ae242e91f8f9f75a0aaa5576baeda62891`
на изолированном локальном стенде schema001–238 с существующим Admin через
обычный браузерный вход. Это техническое подтверждение ограниченного среза
PR#1020; production, native app и весь item15 не объявляются принятыми.
Независимый source review: `4df3007e50b0ef84d12f7fa3c5186de57ea6b9b9f9a521a677023090ca797db6`.

## Фактические результаты

- На390/320 сохранены три разрешённых канала, их порядок, ссылки, selected и
  реальные unread51/1/0. Все строки показывают canonical latest preview:
  два live и один confirmed empty.13px preview/ellipsis,69.59px высота строк,
  отсутствие горизонтального overflow подтверждены измерениями и снимками.
- Клавиатурный вход в текущий канал, поиск существующего сообщения, переход
  к контексту и обратно, закрытие поиска и возврат к каналам сохраняют latest
  previews. Собственный несохранённый черновик сохранился и затем был очищен.
- На320 при фактическом offline фоновой загрузке показаны точная ошибка и
  «Повторить обновление», принятые previews сохранены. Один ручной повтор
  использовал тот же general changes cursor71. Записаны «Повторяем…» с
  disabled=true и возврат к доступной кнопке. После online настоящий ответ200
  убрал alert; подмен ответов и программной рассылки событий не было.
- На1440 conversation видна, rail ровно288px, preview13px/ellipsis и высота строк ≥44px
  сохранены, горизонтального overflow нет. Чтение старого feed не изменяет
  preview последней записи другого/текущего канала.

Первый проход сохранил STOP на ошибочной проверке ровно одного role=alert
**на всей странице**. Его успешные390/320/search/context/draft результаты
переиспользованы, а исходный STOP оставлен. После независимого review отдельное
продолжение выполнило только недостающие320 error/retry/recovery и1440 — два
новых снимка. Текущая диагностика увидела global2: один alert внутри чата и
`__next-route-announcer__` Next.js вне чата. Внутри workspace/nav ровно1/1,
в скрытой conversation0. Это фактическая диагностика продолжения; точное
число alert первого остановленного прохода не было записано. Production-код
ради этой ошибки тестового сценария не менялся, framework announcer сохранён.

## Сохранность и закрытие

Оба прохода сверены отдельно. В продолжении before517d9391 → finalbb212951:
все290 business tables, scope/canonical/catalog/effects неизменны, seen additions0.
Все33 Auth/Storage таблицы учтены: прежние sessions/refresh/AMR/identities и
Storage восстановлены точно; допустимы лишь два собственных audit события
login/logout и обычные timestamps собственного пользователя. Logout204,
именной браузер закрыт, собственная cookie capture удалена после strictfinal.

Собственный app process завершился с фактическим exit0, launcher дождался его.
Первоначальный bounded cleanup зафиксировал STOP: порт оставался недоступен
для bind после завершения процесса,98 ошибок errno48 за10s. Этот STOP сохранён.
Последующее отдельное read-only наблюдение22:51:14UTC подтвердило отсутствие
группы процесса и успешный прямой bind своего порта; отдельная factual receipt
ссылается на исходные данные. Дополнительных сигналов/рестартов не было;
причина задержки освобождения порта не установлена. Это не превращает исходный
cleanup STOP в PASS. Перед after snapshot успешное продолжение unmount чата
выполнено; strictfinal подтверждает отсутствие поздних business изменений.

Независимые review metadataecf3e0ad и concrete UI bindingc65250aa выполнены
до запуска. Independent actual review: `2de97c08071f47e05fb873951bf9e6be85ef40decce3a11e9d5d6b9c8d6376d2`
(APPROVED_BOUNDED_UI_AND_CLOSURE_RELEASABLE_TO_ROOT, 42 проверки и просмотр
четырёх PNG)..

## Точные proof pins

Private continuation packet:
`/private/tmp/evo-a1020-final-ui-extension-inert-20260922/ui-proof`.

| Артефакт | SHA256 |
|---|---|
| actual-summary.json | `551bd01f28c0ac1713ebcc1e8c917bd995f6b754bc79952736ebb8e98a1d17b7` |
| batch-result.json | `e04fc975cbb59d170662ca61e6e63cecb624783639bdefe1b833f59e5a2b95c7` |
| before.json | `517d93911719f098d1f744a487f348748970ab9b8c4525db714f324dc59fe205` |
| final.json | `bb2129511f54c323c5892d6400529c2cba76461c1e87ced52600dc096517bf31` |
| final-verification.json | `9cb318d29f6b959ff5cccd14e7427124ae5ef232850736cfa1991f5604bcd946` |
| rail-final-320-background-error.png | `2a4050c2f99e352b4de913d0887cbe195eb9a08c90bf6a11cefb177b81cbb760` |
| rail-final-1440.png | `b390d718f54a681e8447827c60e38489a50d43e2ad07b1f0e5df795406e78c81` |
| server-stop-STOP.json | `c8494d1db83a4c43bd7cba0530c8e9868be86e648694199e5f9f78e1d91c85fd` |
| server-absence-observation.json | `c987b0e87aa9933e6e369e728d22e902831e580c349904a2c53702d2dac7c5c0` |
| server-stopped.json | `2d2ea35a780df9eeafd7e7ddbdf55e78016d9717cba7f3c1b3fcbe99861a946f` |
| auth-removal.json | `2a7ef1c0930f8e49376544e9813606f123197b84a52e00d8ff80a9cd3815379e` |

Прежний packet `/private/tmp/evo-a1020-final-ui-inert-20260922/ui-proof`:
summary `894cfa8440f947e1892d61e67d14f9650417e963502bf1281e911dc96dade828`,
raw UI STOP `4e210f8e5880ae97e2a965baa5371885a507cb07a82a3b5556d302b3ff9d37ed`,
390 PNG `8678340797021954163dd11181e1abd086b5c879d8873d043513646d4d159d37`,
320 PNG `acd8593262918fe213fb4184b9b69b233a33a70072aa70732d6d9e56276a68fc`.
Свежие scope/canonical продолжения полностью совпали с прежним before;
исторические результаты не названы новым прогоном.

## Пределы

Нет существующего tombstone preview в этом стенде, принудительного forbidden,
malformed metadata или конкурентной доставки. Эти варианты имеют source/pure
protocol evidence в прежних точных ревизиях, но новый UI-проход их не доказывает.
Нет live provider/native/production или complete item15 acceptance. Новых
messages, preferences, grants, данных или миграций в этом блоке не создавали.
Следующие согласованные срезы item15 — operation-specific command feedback и
время latest preview; они не входят в этот PR. Итоговый merge остаётся у ROOT.


## Передача QA и интеграция main

После независимого review ресурсы переданы ROOT, который назначил следующее
окно B1018. Исходный summary и raw final не переписаны. Отдельная accepted
receipt `549b81f05d6bc0ff7e16846e703b14ecbf216a48fe1353448ec916191bfcb123`
связывает их с review. Original handoff ROOT:
`7c7fb9698dd73672b48eaedf3a578a0b1953234344572b85b3787289db3695ef`;
отдельная связанная нормализация nextOwner=B1018:
`75bfdaa66f17f440ed583c76914fdf70f0a48933219c3fdc3addb43537b91113`.
assignedNextWindow=B1018 и все state/catalog/effects/AuthStorage поля сохранены.

После закрытия окна интегрирован main `e8fc98dc1712f30e2b8bbae1cdc2f0d000ddece9`
(включая #1019/#1021/#1022/#1023); merge commit
`e4c74b52a2c36a023659e49b911d3cda8ee0074e`. Два конфликта append-only журналов
разрешены сохранением точного общего префикса и полных окончаний обеих веток.

Файловая сверка 43 файлов source/tests/SQL и dependencies:
`cd75ebe624a874af1af9a7bd42b6fadc4ec40d87dce6c6639d187583e128db3c`
(`/private/tmp/evo-a1020-final-documentation-20260922/integration-parity.json`).
Все chat-файлы, package/lock и globals CSS побайтно равны проверенному bab531ae.
Единственное отличие в этой выборке — две принятые mobile spacing classes
AppShell из #1021: logo py3→py2, actions min-h16/py2→min-h14/py1
с прежними md значениями. Их [отдельная фактическая проверка](crm-mobile-header-spacing-actual-2026-09-22.md)
имеет source e999d8c0 и independent review441f869a. Снимки bab не выдаются за
новый проход объединённого интерфейса. ROOT разрешил не повторять UI; итоговые
exact-head review и защищённые короткие CI проверки остаются отдельным merge gate.
