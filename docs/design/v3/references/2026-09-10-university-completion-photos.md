# Полное заполнение вузов: исследование фотографий, 10–11 сентября 2026

## Результат и реестр

Машиночитаемый результат — `src/lib/university-photo-library.json`: **144 записи**
с полями `path`, `caption`, `title`, `author`, `sourceUrl`, `license`,
`licenseUrl`. Это число фотоключей, а не утверждение о числе опубликованных вузов:
окончательный каталог использует собственное объединение учреждений и кампусов.
В JSON сохранены 14 существовавших фотографий; заполнены APU/City и новые ключи
из исследованных институциональных источников. Все обязательные поля заполнены,
все три адреса каждой записи используют HTTPS, повторяющихся `path` нет.

Проверка всех текущих `university-catalog-reviewed-*.json` дала 143 уникальные
карточки и 143 используемых фотоключа: пустых `photoKey` и ссылок на отсутствующее
фото нет. Единственный пока неиспользуемый ключ —
`harbin-institute-of-technology-shenzhen`: отдельный кампус объединён в карточке
HIT исследователем контента; фотография сохранена как атрибутированный резерв.

Не заменять реестр приблизительными URL из этого документа. JSON содержит
точные наблюдённые адреса и индивидуальную атрибуцию; часть названий намеренно
содержит кампус, здание или историческую дату.

## Граница исследования

Фотографии подбираются к конкретному учреждению и кампусу, а не только по похожему
названию. Исходные Notion-ссылки — кандидаты, не подтверждение прав или точной
географии. Проверяются первичная страница файла Wikimedia Commons, `imageinfo`
метаданные (автор, источник, лицензия, дата, размеры) и соответствие подписи.
Фотографии абитуриентов, переписка и папки корзины не анализируются. Исходные
архивы не меняются и не публикуются. Наличие скриншота в Google Takeout само по
себе не подтверждает авторские права EVO.

Для отображения использовать наблюдённые точные URL, атрибуцию, ссылку на исходник
и лицензию. Не выдавать доступный файл за материал со свободной лицензией.
Отсутствующий грант на перепубликацию честно отличать от Creative Commons.
Датированное историческое фото не должно обещать нынешний вид кампуса.

В существующих 16 редакционных карточках `photoKey=null` у **APU** и **City
University Malaysia**. У ZJUT и China University of Petroleum (East China) фото
уже определены; их не следует повторно заменять на основании неверной гипотезы.

## Уже подтверждённые дополнительные фотографии

| Ключ | Файл и автор | Лицензия | Точная подпись и ограничения |
| --- | --- | --- | --- |
| `apu` | [UCTI Exterior.jpg](https://commons.wikimedia.org/wiki/File:UCTI_Exterior.jpg), WPSamson | Public domain, PD-self | Исторический корпус UCTI (ныне APU), 2011. **Не нынешний кампус MRANTI**. Не использовать изображения японского Ritsumeikan APU. |
| `msu` | [MSU Main Campus.jpg](https://commons.wikimedia.org/wiki/File:MSU_Main_Campus.jpg), Drcool 25 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Главный кампус Management & Science University, 2015. Небольшое панорамное фото 851×315, не увеличивать сверх разумного размера. |
| `upm` | [Anjung Putra, UPM.jpg](https://commons.wikimedia.org/wiki/File:Anjung_Putra,_UPM.jpg), Wee Hong | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Въездной корпус Anjung Putra, Universiti Putra Malaysia, 2022. На фото именно пункт охраны, не основной учебный корпус. Визуально проверено. |
| `utm` | [Sultan Ibrahim Chancellor Building.jpg](https://commons.wikimedia.org/wiki/File:Sultan_Ibrahim_Chancellor_Building.jpg), Chongkian | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Sultan Ibrahim Chancellor Building, UTM, Skudai/Johor, 2018. Не кампус Куала-Лумпура. Визуально проверено. |
| `unikl` | [Universiti kuala lumpur city campus front.JPG](https://commons.wikimedia.org/wiki/File:Universiti_kuala_lumpur_city_campus_front.JPG), Daysra | Public domain, PD-user | Историческая фотография правильного городского кампуса UniKL, 2007; не MITEC. |
| `city-malaysia` | [Официальный сайт City University Malaysia](https://city.edu.my/), фотограф не указан | All rights reserved; только прямое встраивание источника | Реальная аэрофотография кампуса Cyberjaya; не рекламный коллаж Petaling Jaya. |

Точные проверенные прямые адреса:

- APU: `https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/UCTI_Exterior.jpg/960px-UCTI_Exterior.jpg`
- MSU: `https://upload.wikimedia.org/wikipedia/commons/0/0d/MSU_Main_Campus.jpg`
- UPM: `https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Anjung_Putra%2C_UPM.jpg/960px-Anjung_Putra%2C_UPM.jpg`
- UTM: `https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Sultan_Ibrahim_Chancellor_Building.jpg/960px-Sultan_Ibrahim_Chancellor_Building.jpg`

## Отбракованные и требующие уточнения кандидаты

- **UniKL:** Notion содержит [UniKL City Campus.jpg](https://commons.wikimedia.org/wiki/File:UniKL_City_Campus.jpg),
  но описание файла указывает Malaysian Institute of Industrial Technology
  (MITEC), а не городской кампус Куала-Лумпура. Не подписывать его как City Campus;
  точная замена — `Universiti kuala lumpur city campus front.JPG` в реестре.
- **INTI:** Notion-фото `Cmglee Inti College Penang.jpg` — Penang, а существующая
  карточка университета относится к Nilai. Сохранить уже проверенное фото Nilai.
- **BIT Zhuhai:** институциональная идентичность проверена исследователем
  китайских программ по официальным материалам BIT 2026. Фотоключ сохранён;
  подпись явно указывает кампус Чжухай, даже если карточка объединяет Пекин и
  Чжухай. Нельзя выдавать этот снимок за кампус Пекина.
- **APU:** актуальное фото в raw-папке `Universities/APU/.../Photos` не считается
  собственностью EVO только потому, что файл там сохранён. Исторический PD-self
  снимок выше имеет подтверждённый режим использования.
- **City:** [Commons-категория](https://commons.wikimedia.org/wiki/Category:City_University_Malaysia)
  содержит только материалы мероприятий. Они не подменяют внешний вид кампуса.
  [Официальный сайт](https://city.edu.my/) содержит фотографии кампусов, но
  [его правовой футер](https://city.edu.my/privacy-policy/) указывает All Rights
  Reserved; свободная лицензия или грант на перепубликацию не найдены.

Дополнительно исключены: рекламный коллаж City Petaling Jaya; логотипы и
портреты GBS Dubai; школьный `HFLSIC.jpg` как неподтверждённая замена ZISU;
кандидат Nanchang с неизвестным автором; снимок Zhejiang Gongshang с конфликтом
Jiaogong/Xiasha в названии и описании; неопределённый Commons `Imgpreview.jpg`
для Tongmyong. Для каждого из этих учреждений найдена точная замена.

## Официальные фотографии без свободной лицензии

При отсутствии подходящего Commons-файла выбран прямой URL опубликованной
официальной галереи. Это **не грант на скачивание, перепубликацию или свободное
распространение**. В реестре такие строки честно помечены `official-source
embedding` / `no reuse license stated`, а правообладатель или издатель назван.
`licenseUrl` у них ведёт к опубликованным условиям либо самой странице источника,
а не к вымышленной лицензии Creative Commons. В текущем выпуске применено
информационное встраивание внешнего источника; бинарные файлы не копировались в
репозиторий, Storage или raw-архив.

Такие записи: City Malaysia, China Jiliang, Guangzhou Huashang Vocational
College, SPD, CUT, ZISU, Shenyang Aerospace, GBS Dubai, Yibin, Cassino, EUC,
GBS Malta, Tongmyong, ICN, APAC. Их первичные страницы и правообладатели находятся
в JSON. Это не общая лицензия для будущего переиспользования.

Два уточнённых случая:

- **EMA:** фотография общего входа EMA/English Path опубликована
  [English Path Paris](https://www.englishpath.com/destinations/europe/paris/).
  На снимке видны обе вывески. [Контакты EMA](https://ema.education/en/contact-us/)
  независимо подтверждают адрес 98 Rue Didot, 75014 Paris; официальный материал
  [о кампусе](https://ema.education/en/news-list/discover-ema-your-future-starts-here-in-the-heart-of-paris/)
  подтверждает совместное использование с English Path. Подпись не утверждает,
  что все помещения English Path принадлежат EMA.
- **MLA College:** фотография пустого помещения в The Merchant, Plymouth,
  опубликована исполнителем интерьерного проекта
  [Engage Workplace](https://www.engageworkplace.co.uk/portfolio/mla-college-plymouth).
  Источник прямо называет клиента и объект. Запись имеет отдельную пометку
  `supplier-source embedding; no reuse license stated`, не выдается за снимок
  университета или свободно лицензированную работу. Год copyright футера не
  использован как дата съёмки. Это помещение дистанционного колледжа, не
  обещание очного университетского кампуса.

## Подписи и качество

- APU — исторический UCTI, не нынешний кампус MRANTI.
- Bologna — исторический Archiginnasio, ныне библиотека; Sapienza — исторический
  Palazzo della Sapienza/Sant’Ivo; Camerino — двор Palazzo Ducale.
- Schiller — историческая фотография кампуса Heidelberg 2012; USTC — бывшие
  ворота East Campus; SWUFE — ворота Guanghua **на кампусе Liulin**.
- UPM — входной корпус Anjung Putra; Tongmyong — кампус Пусан; Yibin — Lingang,
  вторая очередь, официальная галерея марта 2026; ICN — галерея Artem в Нанси.
- APAC — пустая танцевальная студия, не городской пейзаж. Подтверждённый адрес
  выдаёт небольшой портретный снимок (наблюдалось 326×421); нельзя обещать
  высокое разрешение или растягивать его на полноэкранный hero. В официальной
  разметке нет `srcset` или подтверждённой крупной версии. Дополнительная
  медиатека содержит студенческие фильмы, а не подходящую замену пустой студии;
  снимок следует показывать компактно, сохраняя пропорции. Проверка адреса без
  параметров завершилась неретрайным ограничением инструмента; обход и
  скачивание не выполнялись.
- Снимки MSU и Tongmyong также невелики; GBS Dubai/EUC — широкие панорамы;
  Cassino/GBS Malta — вертикальные кадры. При кадрировании не удалять признаки,
  по которым узнаётся нужное место, и сохранять подпись/атрибуцию в карточке.

## Полнота и текущий статус

Пакетная проверка прочла 95 Notion-файлов: 94 записи учреждений и одну явно
обозначенную карточку-шаблон. 67 ссылок на изображения успешно разрешились через
первичный Commons API. Это **метаданные кандидатов**, а не автоматическое
одобрение всех 67 фото. Записи без автора, несоответствующие кампусы и исторические
объекты потребовали отдельного решения. По недостающим вузам проверены первичные
Commons-страницы либо официальные институциональные галереи; окончательные
решения отражены в реестре, а не выводятся автоматически из Notion.

В настоящем браузере проверена выборка Commons-фотографий и все последние
официальные замены: реальное изображение, узнаваемое учреждение/кампус, отсутствие
подмены логотипом, портретом или чужим городом. APAC и MLA визуально проверены
параллельным исследователем. Это **не** утверждение, что все 144 изображения уже
загружались в production. Проверка всего каталога в приложении после интеграции
остаётся отдельным шагом выпуска: совпадение `photoKey`, загрузка внешнего URL,
правильный crop, подпись и доступная ссылка на автора/источник/лицензию.

Ни файлы абитуриентов, ни переписка, ни секреты в реестр не попадали. Генеративные
изображения кампусов, скачивание для обхода ограничений отображения и массовая
перепубликация raw-фотографий не использовались.

## 2026-09-11: проверка production и две замены источника

На принятом `88d0354f` все пять страниц дали143 уникальные карточки и251 программу;
141 изображение загрузилось в настоящем Chrome. Две записи таблицы выше
переопределены следующими результатами (ключи фото и опубликованные DTO прежние):

- **GBS Dubai:** старый `gbs.ac.ae/media/d0ejs0im/...` отвечает200, но выдаёт
  `Cross-Origin-Resource-Policy: same-origin`; в EVO показался честный fallback.
  Его не проксировали и не скачивали. [Официальная галерея English Path](https://www.englishpath.com/destinations/middle-east/dubai/)
  содержит другой [снимок фасада с вывеской GBS Dubai](https://www.englishpath.com/media/uaejybqu/ep-dubai-40.webp?width=1600&height=1200&quality=90&v=1dae895af5f23f0).
  [English Path подтверждает общий кампус и помещения с GBS](https://www.englishpath.com/young-learners-dubai/).
  Снимок реально открылся1600×1200; HEAD200 image/webp, CORP отсутствует.
- **Guangzhou Huashang Vocational College:** исходный `www.gzhsvc.edu.cn`
  выдаёт DNS ENOTFOUND/ESERVFAIL. Та же [фотография ворот](https://gbabs.hk/wp-content/uploads/2026/06/xiaomen.jpeg)
  с точной вывеской колледжа размещена на [странице связанной GBA Business School](https://gbabs.hk/school-overview/).
  Реально открылась1080×650; HEAD200 image/jpeg, CORP отсутствует.

У обеих фотографий видимы издатель/источник, свободная лицензия не заявлена.
Проверка прямого изображения не заменяет финальную проверку встраивания в EVO
после корректирующего выпуска; её результат фиксируется в
[production acceptance ledger](2026-09-11-university-catalog-production-acceptance.md).
