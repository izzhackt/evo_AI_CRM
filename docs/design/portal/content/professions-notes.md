# Профессии — стартовый набор PORT-4 (24 карточки)

Дата: 2026-09-19. Источник решения: `docs/design/portal/port-0-contracts.md`
(«Решение: покрытие профессий») и план §6. Файл данных:
`docs/design/portal/content/professions-draft.json` — черновик контента; он
становится версионируемым источником для движка профессий в следующем слайсе
(без миграций и seed в этом PR).

## Покрытие шкал ORVIS

Идентификаторы шкал — из `supabase/assessment-content/orvis-v1.json`
(`metadata.scales`). Первая шкала в `orvis_scales` — основная; каждая шкала
основная ровно у 3 карточек, все 8 шкал покрыты.

| Карточка | Шкалы (основная — первая) |
| --- | --- |
| project-manager | leadership, organization |
| marketing-manager | leadership, creativity |
| hotel-manager | leadership, organization |
| accountant | organization |
| logistics-specialist | organization, leadership |
| financial-analyst | organization, analysis |
| language-teacher | altruism, erudition |
| nurse | altruism |
| physician | altruism, analysis |
| graphic-designer | creativity |
| interface-designer | creativity, analysis |
| architect | creativity, production |
| software-developer | analysis |
| data-scientist | analysis, organization |
| cybersecurity-specialist | analysis, organization |
| mechanical-engineer | production, analysis |
| chemical-engineer | production, analysis |
| aerospace-engineer | production, analysis |
| maritime-officer | adventure, production |
| paramedic | adventure, altruism |
| tour-guide | adventure, leadership |
| translator | erudition |
| international-relations-analyst | erudition, analysis |
| lawyer | erudition, leadership |

Итог по шкалам (основная/всего упоминаний): leadership 3/6, organization 3/7,
altruism 3/4, creativity 3/4, analysis 3/10, production 3/5, adventure 3/3,
erudition 3/4.

Набор соотнесён с направлениями каталога (143 опубликованных вуза, CN/IT/MY/
PL/TR/CZ и др.): инженерия, IT, медицина, бизнес/финансы, дизайн,
гостеприимство, языки и образование, право и международные отношения.

## Политика источников

- **Описания профессий.** Каждая карточка опирается на сводку соответствующей
  профессии O*NET OnLine (задачи, рабочий контекст, навыки); URL указан в поле
  `sources`, все страницы реально открыты и просмотрены 2026-09-19. Паттерн
  атрибуции тот же, что уже принят в `orvis-v1.json`
  (`metadata.professionAttribution`): O*NET® Database, USDOL/ETA, CC BY 4.0;
  EVO перевела, сократила и адаптировала описания, добавила «день из жизни»,
  среду, пробные задания и учебные направления; USDOL/ETA эти изменения не
  проверяло. При выводе карточек в UI атрибуция обязательна (лицензия
  CC BY 4.0: https://creativecommons.org/licenses/by/4.0/).
- **Зарплаты и работодатели.** Поля намеренно опущены во всех 24 карточках.
  O*NET публикует только зарплаты по США — для аудитории EVO (Кыргызстан,
  учёба в CN/MY/EU/TR) это вводило бы в заблуждение; надёжного регионального
  источника с провенансом в этом слайсе не открывалось. По PORT-0 поля
  необязательные и пустыми не публикуются.
- **Связи с программами.** `linked_program_refs` ссылаются только на реальные
  записи ревью-каталога (`src/lib/server/university-catalog-reviewed-*.json`):
  `institution_photo_key` = `content.photoKey`, `program_hint` — точное
  название программы из `programs[].title` (проверено скриптом при сборке
  файла). Ссылка по названию, а не по id программы: id внутри JSONB
  нестабильны между версиями публикации (решение PORT-0 по избранному
  распространяется и сюда); резолвер движка должен сопоставлять по
  (photoKey, title) на момент публикации и деградировать в «программа не
  найдена», а не падать.
- **Пробные задания и «день из жизни»** — оригинальный редакционный контент
  EVO по мотивам задач и рабочего контекста O*NET; это варианты для
  исследования интересов, а не валидированный профподбор
  (`professionGuidance` из orvis-v1 применим и здесь).
- **Языки.** RU — основной, KY — полный перевод всех пользовательских полей
  (title, day_in_work, environment, skills, interesting, hard, trial_task,
  study_directions). Названия программ и вузов остаются на языке каталога
  (английский) — это имена собственные, каталог их не переводит.

## Честные ограничения связей с каталогом

- **nurse, paramedic** — каталог не содержит профильных программ «фельдшер»;
  честные ссылки ограничены Medical University of Gdańsk (Nursing +
  Premedical Course) как путями в медицину. Для paramedic это редакционная
  связь «ступень к профессии», а не прямая программа обучения фельдшеров.
- **maritime-officer** — единственный честный вуз: MLA College (2 программы
  одного вуза). Прямых программ судовождения в каталоге нет; MLA —
  морские операции.
- **tour-guide** — одна честная ссылка (Taylor's Hospitality Management).
  Прямых программ туризма/гидов в каталоге нет.
- **logistics-specialist** — в каталоге нет программ «логистика/supply
  chain»; ссылки ведут на International Business / Industrial Management как
  ближайшие честные направления (отражено и в study_directions).
- Требование «≥2 ссылки на карточку, где честно возможно» выполнено для 23 из
  24 карточек; tour-guide — единственная карточка с одной ссылкой.

## Пропуски и открытые вопросы

1. **Шкала adventure** — самая бедная по честным связям с каталогом:
   спорт, авиация (пилоты), силовые структуры не представлены программами.
   Если каталог пополнится (авиационные/спортивные программы), добавить
   карточки «пилот», «тренер».
2. **Чистая наука** (биотехнологии, физика) не имеет отдельной карточки;
   ближайшие — chemical-engineer, physician, data-scientist. Кандидаты на
   расширение: «биотехнолог» (Camerino Biosciences and Biotechnology, USTC
   Physics в каталоге уже есть).
3. **Существующий блок `metadata.professions` в orvis-v1.json** (16 коротких
   карточек) остаётся источником для экрана результатов теста; данный набор —
   отдельный, более глубокий контент раздела «Профессии». При посадке движка
   решить: сводить ли их к одному источнику (9 профессий пересекаются по
   O*NET-кодам, id намеренно совместимы по стилю, но не идентичны).
4. **KY-перевод** выполнен редакционно (в репозитории нет прежних KY-строк для
   сверки терминологии); перед публикацией нужен вычитывающий носитель
   кыргызского — отдельный шаг ревью, зафиксировать в PORT-6.
5. **Ссылки в пробных заданиях** (marinetraffic.com, haveibeenpwned.com) —
   внешние бесплатные сервисы, упомянуты как инструмент задания; при
   реализации UI открывать как внешние ссылки, доступность не гарантируется.
6. `verified_on` для источников описаний = 2026-09-19 (дата открытия страниц
   O*NET в этом слайсе); поле на уровне карточки не добавлялось, дата общая
   для файла — при переносе в движок закрепить её в версии контента.
