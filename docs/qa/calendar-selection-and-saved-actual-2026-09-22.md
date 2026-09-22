# Calendar: TaskChip и один saved lifecycle — local actual

Actual source: `0fa4f7871af1aa0151f0bd40b1c70b5c053b39b5` (#1031).
Один существующий обычный Admissions, local schema239; production не затронута.
Исходный before снят до единственного login, полностью равен принятому A1030
handoff. Installed catalog `e55b9565` совпал с независимым create-chain review.

## Фактически выполнено

- Один1440px contrast batch: существующая TaskChip → детали → закрытие.
  ARIA/details/focus сохранены. Вычисленный transitionProperty=border-color;
  selected фон #d70217/белый текст даёт5.37:1, unselected #e7e7e7 с заголовком
  #202020 —13.18:1 и подписью #5f5f5f —5.16:1. Два PNG просмотрены.
  Немедленный кадр после click ещё был unselected и сохранён как diagnostic;
  первый семантически selected sample проверен без ожидания нужного цвета.
  Continuous/high-FPS timing не измерялся.
- Prepare прочитал настоящий DOM request UUID и видимые поля. Read-only prewrite
  подтвердил exact original-before hashes трёх таблиц и отсутствие request effects.
  Ровно один ordinary submit создал self-assigned follow_up/open/normal без срока,
  скрытую от Student задачу по существующему разрешённому делу. Данные задачи
  оставлены. Saved disabled lock/поля сохранены после close/reopen; «Создать ещё»
  использовал возвращённый action UUID, очистил title и восстановил focus.
  Второго submit не было.
- Неизменный scoped verifier подтвердил ровно +1case_task/+1case_task_event/
  +1audit_event с точной actor/request/FK связью и сохранением всех прежних рядов.
  Остальные287 business tables, notifications, Storage, catalog/ACL/ledger и
  исходные sessions/refresh/AMR не изменились. Из33Auth/Storage таблиц отличаются
  только own sign-in metadata и два собственных login/logout audit.
- Local logout204, own browser закрыт, единственный own process group SIGTERM,
  реальный child reap exit0, порт отказал в соединении. Только собственный
  совпавший Auth capture удалён после строгой итоговой сверки.

## Доказательства и пределы

Private original before `24a08afc`, final `111ec2bd`, strict verifier `b7436c76`;
independent actual/visual/closure review `b8e5ddf8` принят ROOT. Авторитетный
handoff `d88cd4da` released ROOT_COORDINATOR; следующий QA owner назначается ROOT.

Исходный readiness STOP сохранён: наш SELECT использовал resource `case` вместо
`student_case`; точная исправленная readonly проверка подтвердила доступное дело.
До launch обнаружено и исправлено только отсутствие hash-переменной operation
binding в child env; старый supervisor/tuple сохранён. Это не продуктовые Auth
или write failures, actual submit не повторялся. After-ui сохранён как raw;
известное промежуточное AMR сравнение не запускалось, final проверен после logout.

Исторические #1028 UI/STOP доказательства не переименованы в этот запуск.
Не повторялись responsive/picker/draft матрицы; нет новых claims для stale,
unknown, hard reload, cross-identity, второго create, native или production.
Весь item16/22 и программа1–36 не закрыты. Source checkpoint остаётся историческим;
final-head integration/docs review и protected CI требуются отдельно до merge.
