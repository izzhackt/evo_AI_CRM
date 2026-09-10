# Университеты EVO: инвентаризация и расширение каталога, 10 сентября 2026

Статус: редакционные шаблоны для обычного Admin review, **не опубликованные
данные** и не автоматическая синхронизация. Сохранены исходные пять шаблонов
APU/Sunway/MMU/XJTLU/UNNC; добавлены **11** из согласованных 12 кандидатов.
Ocean University of China остаётся pending по описанной ниже причине.
Новая партия содержит 10 проверенных фотографий; у City фото отсутствует.
Партнёрство с EVO, зачисление, стипендия, виза или профессиональный допуск
не следуют из присутствия университета в каталоге.

## Область источников и границы

Источник инвентаризации — текущая `EVO_Знания`, не устаревший путь из старых
handover. Читались только институциональные заметки в двух каталогах:

- N: `Внутренняя база знаний ЭВО/Внутренние знания/Импорт из Ноушен/Материалы ЭВО Адмишнс/Университеты`;
- A: `Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ/Университеты`.

В N обнаружено **98 Markdown-файлов**: 94 основных записи, три явно помеченных
дубля и один пример-шаблон. Это количество заметок, не подтверждение 94 действующих
вариантов международного поступления. В A — 192 институциональные/программные
заметки; их содержание не импортировалось целиком. Дополнительные каталожные CSV
замечены по метаданным, не использованы как второй независимый источник.

Дополнительно прочитаны не содержащие личных данных справки репозитория:
`docs/business/knowledge-base/ready-to-upload/china-admissions-knowledge-base-ru.md`
и `malaysia-admissions-knowledge-base-ru.md`. Они объясняют связь выбранных вузов
с материалами EVO, но не заменяют текущие официальные требования.
Клиентская утверждённая заметка про APU не менялась; исторический конфликт её
календаря уже описан в [первом source memo](2026-09-10-university-catalog-sources.md).

Не читались личные дела абитуриентов, переписка, секреты, корзина/спам и сырые
вложения. В Git не переносятся их пути, текст, сканы или OCR.
Внутреннее одобрение материала не равно разрешению показать его Student:
публичные карточки содержат только отдельно проверенные безопасные факты.
Цены, рейтинги, контакты партнёров, договорные условия и обещания из старых заметок
не переносились.

## Полная обнаруженная номенклатура N и очередь

Ниже все 98 записи N, сгруппированные по указанной в заметке стране.
Это **инвентаризация источников**, не список уже опубликованных или полностью
проверенных вузов. Кроме текущих пяти и новой партии, всё остаётся pending:
нужна отдельная сверка названия/кампуса, международной программы и прав на фото.

- Китай (21): Beijing Institute of Technology, Zhuhai; Beijing Normal University;
  China University of Petroleum, East China; East China University of Science and
  Technology; Fudan University; Guangdong University of Technology; Hangzhou Normal
  University; Harbin Institute of Technology; Huazhong University of Science and
  Technology; Nanjing University; Ocean University of China; Peking University;
  Shanghai Jiao Tong University; South China University of Technology; Tsinghua
  University; University of Electronic Science and Technology of China; University
  of Science and Technology of China; Wuhan University; Xi’an Jiaotong-Liverpool
  University; Zhejiang University; Zhejiang University of Technology.
- Малайзия (10): APU; INTI International University; Management and Science
  University; Monash University Malaysia; Sunway University; Taylor’s University;
  UCSI University; Universiti Kuala Lumpur; Universiti Putra Malaysia; Universiti
  Teknologi Malaysia.
- Италия (24 записи): Bocconi; Ca’ Foscari University of Venice; IULM; Politecnico
  di Milano; Politecnico di Torino; Sapienza University of Rome; University of
  Bologna; University of Camerino; University of Cassino and Southern Lazio;
  University of Florence; University of Genoa; University of Macerata; University
  of Messina; University of Milan (Statale); University of Milan-Bicocca; University
  of Naples Federico II; University of Padova; University of Palermo; University
  of Pavia; University of Rome Tor Vergata; University of Turin; ещё три записи,
  явно помеченные дублями Bologna, Padua/Padova и Pavia.
- Кипр по исходной группировке (8): Cyprus University of Technology; Eastern
  Mediterranean University; European University Cyprus; Frederick University;
  Near East University; UCLan Cyprus; University of Cyprus; University of Nicosia.
  Юрисдикции и кампусы не нормализованы: до публикации проверять отдельно.
- Польша (11): AGH University of Krakow; Jagiellonian University; Kozminski
  University; Krakow University of Economics; Medical University of Gdańsk;
  Medical University of Warsaw; Poznań University of Technology; University of
  Warsaw; University of Wrocław; Vistula University; Warsaw University of Technology.
- Турция (11): Ankara University; Bahçeşehir University; Bilkent University;
  Boğaziçi University; Istanbul University; Koç University; METU/ODTÜ; Sabancı
  University; Yeditepe University; İstanbul Aydın University; İstanbul Teknik
  Üniversitesi.
- Чехия (10): Academy of Arts, Architecture and Design in Prague; Brno University
  of Technology; Charles University; Czech Technical University; Czech University
  of Life Sciences Prague; Masaryk University; Prague College; Technical University
  of Liberec; University of Chemistry and Technology Prague; University of Economics
  Prague. Название Prague College и возможное переименование ещё не проверены.
- Австрия (1): University of Vienna.
- ОАЭ (1): GBS / Global Banking School, Dubai Campus — статус учреждения/программы
  не проверен, не считать самостоятельным университетом без проверки.
- Без страны (1): «Шаблон университета (пример)» — исключён из кандидатов.

В A отдельно обнаружены материалы City University Malaysia, Xiamen University
Malaysia, Tongmyong University (Южная Корея), SPD (брошюры программ; точная
идентичность учреждения не установлена). City и XMUM вошли в новую партию;
Tongmyong и SPD остаются pending. Существующие MMU и UNNC опираются на первый
source memo, а не выдуманные отсутствующие записи N.

## Проверенные новые карточки

Для каждой карточки ниже — одна конкретная программа, а не утверждение о полноте
каталога университета. Все URL просмотрены 10.09.2026. Месяцы набора хранятся
текстом с `status=unknown`, пока не подтверждён конкретный цикл; они **не**
превращаются в точные даты. Английский язык страницы сам по себе не доказывает
английский язык обучения: неподтверждённые поля `language` остаются `null`.

| Ключ / университет | Программа и проверенные поля | Официальный источник |
| --- | --- | --- |
| `taylors` — Taylor’s University; Subang Jaya | Bachelor of International Hospitality Management (Honours); 3 года; язык уточняется | [Страница программы](https://university.taylors.edu.my/en/study/explore-all-programmes/hospitality-tourism-and-events/undergraduate/bachelor-of-international-hospitality-management.html) |
| `inti` — INTI International University; Nilai | Bachelor of Computer Science (Hons); 3 года; язык уточняется | [Страница программы](https://newinti.edu.my/programme/bachelor-of-computer-science-hons-coventry-uk/) |
| `ucsi` — UCSI University; Kuala Lumpur | Bachelor of Arts (Hons) in Business Administration; 3 года; язык уточняется | [Страница программы](https://www.ucsiuniversity.edu.my/programmes/bachelor-arts-hons-business-administration) |
| `city-malaysia` — City University Malaysia; Petaling Jaya / Cyberjaya | Bachelor of Information Technology (Honours); 36 месяцев; язык уточняется | [Страница программы](https://city.edu.my/bachelor-of-information-technology-hons/) |
| `xiamen-malaysia` — Xiamen University Malaysia; Sepang | Bachelor of Engineering in Computer Science and Technology (Honours); 4 года; Английский | [Страница программы](https://www.xmu.edu.my/index.php/courses/bachelor-engineering-computer-science-and-technology-honours) |
| `monash-malaysia` — Monash University Malaysia; Bandar Sunway | Bachelor of Computer Science; 3 года; язык уточняется | [Страница программы](https://www.monash.edu.my/study/undergraduate/information-technology/bachelor-computer-science) |
| `scut` — South China University of Technology; Guangzhou | International Foundation Program; срок уточняется; Китайский или английский — по маршруту | [Страница программы](https://www.scut.edu.cn/en/2025/1202/c607a58742/page.htm) |
| `zjut` — Zhejiang University of Technology; Hangzhou | Chemical Engineering and Technology; 4 года; Английский | [Страница программы](https://www.gjxy.zjut.edu.cn/ueditor/upload/file/20251125/1764050265176062.pdf) |
| `gdut` — Guangdong University of Technology; Guangzhou | International Economics and Trade; 4 года; Английский | [Страница программы](https://iec.gdut.edu.cn/info/1093/5324.htm) |
| `upc-east-china` — China University of Petroleum (East China); Qingdao | Petroleum Engineering; 4 года; Английский | [Страница программы](https://cie.upc.edu.cn/admission_cn/info/1095/1357.htm) |
| `ecust` — East China University of Science and Technology; Shanghai | Chemical Engineering and Technology; 4 года; Китайский | [Страница программы](https://cie.ecust.edu.cn/notices/518.html) |

### Важные различия и конфликты

- **INTI:** старая N-заметка университета в Nilai ссылается на фото Penang College.
  Оно исключено; выбран подтверждённый Nilai Student Centre. Программа не
  Swinburne 3+0 в INTI College Subang и не дистанционная версия.
- **UCSI:** BA (Hons) Business Administration в Kuala Lumpur не объединён с
  BBA (Honours) в Springhill. Месяцы январь/май/сентябрь относятся к выбранному BA.
- **City:** текущая страница прямо указывает Petaling Jaya **и** Cyberjaya.
  Нельзя выдавать один кампус за гарантированное место занятий. Разные формулировки
  требований к английскому не превращены в универсальный проходной балл.
  Дата 07/2030 возле аккредитации не является дедлайном поступления.
- **XMUM:** 4-летняя англоязычная BEng находится в Малайзии, не в Китае.
  Официальная страница предупреждает, что степень не входит в перечень инженерных
  направлений Board of Engineers Malaysia; это ограничение сохранено в карточке.
- **Monash:** базовый 3-летний Bachelor of Computer Science не равен отдельному
  одногодичному Honours после базовой степени.
- **SCUT:** выбран реальный International Foundation Program, а не произвольный
  бакалаврский предмет из общего списка. Продолжительность и даты на проверенной
  странице не указаны, поэтому `null`. Фото University Town не обещает размещение
  этого конкретного подготовительного набора в том же кампусе.
- **ZJUT:** [руководство 2026](https://www.gjxy.zjut.edu.cn/ueditor/upload/file/20251125/1764050265176062.pdf)
  подтверждает 4 года/английский/химическую инженерию; для английских программ
  предусмотрен минимальный набор группы. Срок **30.05.2026** явно исторический
  закрытый; возможные изменения отдельных программ оговорены. 2027 не выведен
  прибавлением года.
- **GDUT:** заголовок [руководства](https://iec.gdut.edu.cn/info/1093/5324.htm)
  говорит Spring Semester, но тело — осеннее начало и срок 30.06.2026. Программа,
  английский язык и 4 года подтверждены; следующий набор оставлен неизвестным.
  Спорный сезон не нормализован молча.
- **UPC East China:** [текущий раздел международного бакалавриата](https://cie.upc.edu.cn/rcpy/bksjy.htm)
  продолжает перечислять английскую Petroleum Engineering. Подробная страница
  2020 года — не доказательство текущих цен или нового дедлайна; они не импортированы.
  Не подменять университетом в Пекине или Shengli College.
- **ECUST:** [каталог 2026](https://cie.ecust.edu.cn/notices/518.html) отличает
  4-летнюю китайскоязычную Chemical Engineering and Technology от 3-летней
  англоязычной Intelligent Chemical Engineering / JMD. Выбрана первая.
  [Руководство приёма](https://cie.ecust.edu.cn/notices/514.html) задаёт
  self-sponsored deadline **10.07.2026** и отдельный scholarship deadline
  **30.04.2026**. Первый показан только как закрытый исторический срок; следующий
  цикл неизвестен. Это срок подачи на платное обучение, не срок оплаты.
- Цены/стипендии, устаревшие рейтинги и широкие обещания из Notion не приняты
  как текущие факты. Наличие внутренних материалов не доказывает партнёрство EVO.

### OUC: двенадцатый кандидат остаётся pending

[Официальный guide 2026](https://sie.ouc.edu.cn/english/2025/1212/c18081a513114/page.htm)
опубликован 12.12.2025, но встроенный PDF 42 MB не удалось полностью прочитать:
web parser не извлёк тело, две ограниченные попытки чтения завершились timeout/
оборванной передачей. Файлы на диск не сохранялись. Извлечённый из официальной
HTML-страницы [прямой URL PDF](https://sie.ouc.edu.cn/_upload/article/files/c8/7d/8c0b86714ca98c93c41804b6da7e/fedfe1a8-18eb-4b8d-93a3-fe1a601dc6e8.pdf)
сохранён для следующего проверяющего, но его содержание не объявляется прочитанным.
Страницы Haide College подтверждают реальные программы, но не достаточное
основание для утверждения их доступности иностранному абитуриенту.
Поэтому нет OUC-шаблона, программы-заглушки или заявки на публикацию.


## Изображения: проверенные права и точные объекты

Отдельный read-only исследователь визуально просмотрел превью и проверил primary
Commons file pages. Для всех десяти используемых изображений источник — Own work.
Никакие файлы не скачивались в репозиторий. Виджету разрешены только точные
наблюдённые URL; удалены лишь аналитические `utm_*` параметры. Произвольный URL
из формы Admin не становится адресом изображения. Атрибуция/ссылка на лицензию
и отметка о кадрировании остаются видимыми. Фото может отличаться от сегодняшнего
состояния кампуса; год указан в подписи. Обычная ошибка загрузки показывает честное
сообщение, не заменяет кампус вымышленным изображением.

| Ключ | Файл / автор | Лицензия | Точный кампус и дата |
| --- | --- | --- |
| `taylors` | [Taylor's Lakeside Campus, Subang Jaya, Malaysia.jpg](https://commons.wikimedia.org/wiki/File:Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg); Md Shaifuzzaman Ayon | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Корпуса Taylor’s University у озера, Lakeside Campus, Субанг-Джая, 2022 |
| `inti` | [INTI Nilai Student Centre.png](https://commons.wikimedia.org/wiki/File:INTI_Nilai_Student_Centre.png); Anthony5429 | [Public domain (PD-self)](https://commons.wikimedia.org/wiki/File:INTI_Nilai_Student_Centre.png) | Студенческий центр INTI в Нилае, 2007 |
| `ucsi` | [UCSI main gate Taman Connaught (231105).jpg](https://commons.wikimedia.org/wiki/File:UCSI_main_gate_Taman_Connaught_(231105).jpg); *angys* | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Главный въезд UCSI University в Taman Connaught, Куала-Лумпур, 2023 |
| `xiamen-malaysia` | [XMUM entrance (211127).jpg](https://commons.wikimedia.org/wiki/File:XMUM_entrance_(211127).jpg); *angys* | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Вход и корпуса малайзийского кампуса Xiamen University, Сепанг, 2021 |
| `monash-malaysia` | [Monash University Malaysia (221208) 01.jpg](https://commons.wikimedia.org/wiki/File:Monash_University_Malaysia_(221208)_01.jpg); *angys* | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Вход в Monash University Malaysia и соединённые переходом корпуса, 2022 |
| `scut` | [South China University of Technology South Campus.jpg](https://commons.wikimedia.org/wiki/File:South_China_University_of_Technology_South_Campus.jpg); LPS.1 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Корпуса SCUT у воды, University Town Campus, Гуанчжоу, 2012 |
| `zjut` | [20250423 Zhejiang Gongye Daxue.jpg](https://commons.wikimedia.org/wiki/File:20250423_Zhejiang_Gongye_Daxue.jpg); Yumeto | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Входной корпус Zhejiang University of Technology, Ханчжоу, 2025 |
| `gdut` | [广工大东风路校区南苑大门.jpg](https://commons.wikimedia.org/wiki/File:%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg); Lhzss8 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Вход в южную часть Dongfeng Road Campus, Guangdong University of Technology, 2025 |
| `upc-east-china` | [中国石油大学黄岛校区南侧.jpg](https://commons.wikimedia.org/wiki/File:%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg); Suginami | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Южная сторона кампуса UPC (East China), Хуандао, Циндао, 2023 |
| `ecust` | [ECUST gate Xuhui.jpg](https://commons.wikimedia.org/wiki/File:ECUST_gate_Xuhui.jpg); 4084470 0.smil | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Главный вход ECUST, Xuhui Campus, Шанхай, 2020 |

Особые оговорки: INTI — небольшой исторический снимок 704×528 (2007), автор
Anthony5429, а не загрузивший Karam.Anthony.K; PD-self не переименован в CC0.
У ZJUT конкретное название кампуса не подтверждено: не подписывать Pingfeng/
Moganshan. Старый `Teaching building ZJUT.jpg` исключён из-за Commons disputed
copyright. GDUT — Dongfeng Road, не University Town. ECUST — Xuhui, не Fengxian.
SCUT — University Town, не Wushan/Guangzhou International.

City: подходящего подтверждённого внешнего вида кампуса с разрешённой лицензией
не найдено, `photoKey=null`; фотографии мероприятий не выданы за кампус.
Для pending OUC найдено [OUC West Coast Campus library.jpg](https://commons.wikimedia.org/wiki/File:OUC_West_Coast_Campus_library.jpg),
автор Adam Sampson, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
26.04.2023, библиотека West Coast Campus, Huangdao/Qingdao. Изображение пока
**не добавлено** в runtime allowlist, поскольку соответствующая карточка pending.

Для CC BY-SA производные изображения сохраняют соответствующую лицензию.
Исходные университетские логотипы/официальные фото с All rights reserved не
копировались; нет AI-сгенерированных или стоковых «кампусов».

## Происхождение внутренних заметок (без публикации содержимого)

SHA-256 ниже — хеш прочитанной институциональной заметки, не исходного письма,
личного дела или скана. Пути относительны каталогам N/A выше.

| Кандидат | Заметка | SHA-256 |
| --- | --- | --- |
| Taylor’s | N / Taylor's University 39ada24313928166b191f17f276144fb.md | `01cc61d3b1c40a21fea52baa225e1b36010dbef95f8dd06a924f989c3b6fb106` |
| INTI | N / INTI International University 39ada24313928157affbe681aef758c1.md | `6ec172b7cf3191d5409c8541719a2c4746eaecfe4bca0e758eff8a442498591e` |
| UCSI | N / UCSI University 39ada243139281f2904fd24e4916da9e.md | `9dc748fd109b52520ef6d06455054d552b9086b749b7ad40e9c2b0e7fd392fc9` |
| Monash | N / Monash University Malaysia 39ada243139281ae8eb0c5ad0ce69b15.md | `be9937c421cfc08885043957cf2aaca2f715d436812f63c2a2972a1ad732317d` |
| SCUT | N / South China University of Technology (SCUT) 39eda243139281ed9fc7fdf4ea6e634d.md | `1ca191feef2c19478d02b420e0faddc062179e4b6248aec5d25dceda02b21730` |
| ZJUT | N / Zhejiang University of Technology (ZJUT) 39eda243139281ada6a2c6092477cf2a.md | `726126a3d8d045ea53274778aba20750abe40200fcda2ad48b01053dab91ca91` |
| GDUT | N / Guangdong University of Technology (GDUT) 39eda243139281e39e07f6b0ee41ac5b.md | `80ec3505685da69a18f6fbdf81a9b1da51a21322bed6d81c42cb0cc99d387c67` |
| UPC | N / China University of Petroleum, East China (UPC) 39eda2431392816e8cc2f3ec1eee3c30.md | `561505aade8b62f08622ff443d0da641f61bef01f0e73fd77940a850b8bc19d3` |
| OUC pending | N / Ocean University of China (OUC) 39eda243139281afad10ffdf36f24837.md | `864cb73aa6732238ad0dda9b0fd82d16ca3d427198848099ac25e514a050e595` |
| ECUST | N / East China University of Science and Technology (E 39eda2431392812e9c70c20292ccc0b0.md | `57618835cda15a1600c3c22d544c2d695b9473044b2b6afae0243dabe1bba6eb` |
| City | A / City University Malaysia в материалах EVO — d4dd7611cd87.md | `bf1258161caea013bcd910ef8c21beec219568bd4a38e7323385e0ccd4373bb6` |
| XMUM | A / Бакалаврские программы Xiamen University Malaysia — 12f8b82d530f.md | `c7aeb538f60ed92e06d060749311dff83f87a7274bbd1b2d0d3b4bc1670ccac1` |

Прочитана также A / «Программы Taylor's University — e169a52e5406.md»,
SHA-256 `30319cecf5522a0cc3afccded5854a7e9129faacb1be78adee296903f4b2a008`,
и A / «Рабочая таблица EVO по университетам Малайзии — 9891463fa713.md»,
SHA-256 `cfc8bab2a0ca0845c344b97ed6d37cc17267dde4dcedb2f59804585fd9b5e07f`.
Старые цены из них не перенесены. Original-source hashes в этих заметках сохраняют
их внутреннюю цепочку происхождения; raw originals не читались повторно.

## Технический путь и следующая публикация

Миграция **150** расширяет только конечный список допустимых фото в существующем
`platform_private.valid_university_content(jsonb)`. Exact-anchor guard запрещает
молча менять уже отличающийся валидатор. Сохраняются owner/ACL, остальные проверки,
RLS, source-registry056, immutable publication148 и действующие пять карточек.
Нет INSERT/UPDATE бизнес-данных, autofill, service-role publication или новых
доступов Student. Не редактировать применённую 148.

После обычных reviewed CI/schema/release gates реальный Admin открывает
`/v3/universities/manage`, выбирает **только новые 11** редакционных шаблонов,
проверяет содержимое, сохраняет draft и отдельно подтверждает публикацию.
Каждый шаблон — кандидат, не fallback опубликованного списка. При сетевой
неопределённости сначала проверить draft/receipt/каноническую карточку;
не создавать вторую запись наугад. Не переиздавать APU и остальные четыре.
OUC не публиковать, пока не прочитан достаточный официальный источник.

Этот memo не утверждает, что новые карточки уже находятся в production,
что все фото загрузились у пользователя или что Student live journey проверен.
Реальные результаты публикации и количества фиксирует root отдельно.
