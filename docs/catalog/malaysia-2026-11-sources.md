# Малайзия: источники карточек и программ (07.11.2026)

Данные собраны с официальных сайтов университетов 07.11.2026 (UTC) для карточек `src/lib/server/university-catalog-reviewed-malaysia.json`. Строки стоимости: `scripts/catalog/data/malaysia-2026-11/programme-costs.json` (каждая строка с официальной ссылкой на страницу или PDF-прайс и датой проверки). Агрегаторы (EasyUni и подобные) не использовались; таблицы EVO в `EVO_Знания` использованы только для сверки названий. Применение: `scripts/catalog/malaysia-universities-sql.mjs` (см. комментарий в начале файла), миграция 350 снимает предел 30 программ в карточке.

| Карточка | Город | Программ | Со стоимостью | Официальный сайт | Охват по данным исследования |
|---|---|---|---|---|---|
| Asia Pacific University of Technology & Innovation | Kuala Lumpur | 112 | 111 | https://www.apu.edu.my | Full: enumerated from the official site's Courses navigation menu (139 programme pages, identical to sitemap.xml course list) and every programme page was fetched for duration, intake dates, and international fees. |
| Sunway University | - | 105 | 91 | https://sunwayuniversity.edu.my | Enumerated from official sitemap.xml plus /courses/diploma, /undergraduate, /postgraduate listing pages, then each programme page fetched (title, intakes, duration, fee). |
| Multimedia University | Cyberjaya | 79 | 76 | https://www.mmu.edu.my | About 95 percent. Enumerated from the official programmes-by-campus pages (Cyberjaya and Melaka undergraduate and postgraduate), cross-checked with the June 2026 undergraduate and postgraduate international fee PDFs. |
| Taylor’s University | Subang Jaya | 88 | 88 | https://university.taylors.edu.my | Full: 95 programme pages enumerated from the official Explore All Programmes listing (server-embedded JSON plus programme pages), 88 included, 7 excluded. |
| INTI International University | Nilai | 74 | 74 | https://newinti.edu.my | Complete as far as the official site shows: enumerated all 149 programme pages from the official sitemap https://newinti.edu.my/wp-sitemap-posts-product-1.xml, parsed each page (campus list, intakes, |
| UCSI University | Kuala Lumpur | 172 | 163 | https://www.ucsiuniversity.edu.my | Complete: enumerated all 179 /programmes/ pages from the official sitemap.xml (plus the Kuala Lumpur listing page, no extras), fetched each page (intakes, duration, campus, mode) and matched tuition |
| City University Malaysia | Petaling Jaya / Cyberjaya | 3 | 0 | https://city.edu.my | Карточка не менялась (3 программы, прежний пакет). |
| Xiamen University Malaysia | Sepang | 3 | 0 | https://www.xmu.edu.my | Карточка не менялась (3 программы, прежний пакет). |
| Monash University Malaysia | Bandar Sunway | 64 | 61 | https://www.monash.edu.my | Full list of the official 'Study' menu: Diploma and Pathway (3), Undergraduate by faculty pages (36 degrees incl. |
| Management and Science University | Shah Alam | 3 | 0 | https://www.msu.edu.my | Карточка не менялась (3 программы, прежний пакет). |
| Universiti Kuala Lumpur | Kuala Lumpur | 154 | 130 | https://www.unikl.edu.my | About 95 percent of the official programme listings: enumerated from the four official listing pages (apply/foundation, apply/diploma, apply/bachelor, apply/master-phd), each programme page fetched |
| Universiti Putra Malaysia | Serdang | 154 | 138 | https://www.upm.edu.my | Undergraduate: 1 foundation + all 71 Serdang bachelor-level rows (incl. |
| Universiti Teknologi Malaysia | Johor Bahru | 270 | 228 | https://www.utm.my | Undergraduate: all 44 bachelor programmes on the official international 'All Courses' list captured (status shown there is Closed/Apply per intake, not a programme exclusion). |
| Universiti Malaya | Kuala Lumpur | 252 | 252 | https://www.um.edu.my | High. Enumerated from the official Study@UM site: foundation, diploma, 17 undergraduate faculty pages and 20 postgraduate faculty pages (each programme page fetched for international tuition fee, |
| International Islamic University Malaysia | Kuala Lumpur | 186 | 71 | https://www.iium.edu.my | Medium. Bachelor and postgraduate lists come from the official MQA-02 'Details of all programmes currently conducted' list on office.iium.edu.my (Dec 2025; all rows Active) merged with the CPS |
| ALFA University College | Subang Jaya | 53 | 0 | https://alfa.edu.my | Full list taken from the official Programmes page https://alfa.edu.my/programmes/ (all categories SKM, DKM, Foundation, Diploma, Bachelor, Masters, PhD), and every programme page fetched for |
| INTI International College Subang | Subang Jaya | 39 | 39 | https://newinti.edu.my | Complete as far as the official site shows: enumerated all 149 programme pages from the official sitemap https://newinti.edu.my/wp-sitemap-posts-product-1.xml, parsed each page (campus list, intakes, |
| INTI International College Penang | Bayan Lepas, Penang | 28 | 28 | https://newinti.edu.my | Complete as far as the official site shows: enumerated all 149 programme pages from the official sitemap https://newinti.edu.my/wp-sitemap-posts-product-1.xml, parsed each page (campus list, intakes, |
| INTI College Sabah | Kota Kinabalu | 6 | 6 | https://newinti.edu.my | Complete as far as the official site shows: enumerated all 149 programme pages from the official sitemap https://newinti.edu.my/wp-sitemap-posts-product-1.xml, parsed each page (campus list, intakes, |
| Taylor’s College | Subang Jaya | 17 | 17 | https://college.taylors.edu.my/en.html | Full: the official Explore All Programmes page and Key Intakes page list 7 foundations, GCE A Level and SACE, 7 diplomas and 2 professional programmes; each programme page was fetched (duration, intakes). |
| Sunway College | Bandar Sunway | 5 | 0 | https://sunwaycollege.edu.my | Enumerated from official sitemap.xml plus /courses/diploma, /undergraduate, /postgraduate listing pages, then each programme page fetched (title, intakes, duration, fee). |

## Расшифровка «IUM»

«IUM» из отзыва владельца 07.11 означает International Islamic University Malaysia (IIUM): подтверждено владельцем 08.11.2026. Карточка IIUM остаётся в каталоге; отдельная карточка International University of Malaya-Wales не добавляется. Вопрос закрыт.

## Что не включено и что не подтверждено

Исключены онлайн и дистанционные программы, программы только для граждан Малайзии, краткие курсы и сертификаты, программы с переводом за рубеж. Названия, найденные только в таблицах EVO или у агрегаторов и не подтверждённые официальным сайтом, не импортированы.

| Университет | Исключено | Не подтверждено официально (не импортировано) |
|---|---|---|
| ALFA University College (AUC) | 11 | 2 |
| Asia Pacific University of Technology & Innovation (APU) | 28 | 3 |
| International Islamic University Malaysia (IIUM) | 20 | 4 |
| INTI International University Nilai | 36 | 0 |
| Multimedia University | 4 | 0 |
| Monash University Malaysia | 3 | 0 |
| Sunway University | 21 | 2 |
| Taylor's University | 9 | 2 |
| Taylor's College | 2 | 1 |
| UCSI University | 10 | 4 |
| Universiti Malaya (University of Malaya) | 15 | 5 |
| Universiti Kuala Lumpur | 2 | 3 |
| Universiti Putra Malaysia | 6 | 6 |
| Universiti Teknologi Malaysia | 37 | 4 |

## INTI: города кампусов

Official campuses page https://newinti.edu.my/campuses/ lists exactly four degree/diploma-awarding campuses plus INTI Education Counselling Centres (not a campus). No Kuala Lumpur campus is listed. Кампуса в Kuala Lumpur на официальной странице кампусов, страницах программ и в sitemap нет; слово «Kuala Lumpur» есть только в списке штатов формы заявки. Кампусы:
- INTI International University: Nilai (https://newinti.edu.my/campuses/inti-international-university/)
- INTI International College Subang: Subang Jaya (https://newinti.edu.my/campuses/inti-international-college-subang/)
- INTI International College Penang: Bayan Lepas (Bukit Jambul), Penang (https://newinti.edu.my/campuses/inti-international-college-penang/)
- INTI College Sabah: Kota Kinabalu (https://newinti.edu.my/campuses/inti-college-sabah/)

## Оговорки по ценам

- INTI: на страницах цена «From RM …» / «Approx.» без указания периода оплаты (за год или за всю программу). Суммы сохранены как есть (совпадают с полным сроком), но все 147 строк INTI помечены в note_ru/note_ky: «Ориентировочно; период оплаты на сайте не указан». Нужно подтвердить у INTI.
- UTM, магистр философии (24 строки по 25 400 MYR): на странице https://admission.utm.my/fees-pg-inter/ сумма дана по области обучения (колонка Research), конкретная программа не названа и период не указан. Суммы сохранены, строки помечены в note_ru/note_ky как ориентировочные; нужно подтвердить у UTM.
- MMU: прайс июня 2026 показывает у foundation и магистратуры рядом «Now» и общую цену; записана общая цена программы.
- UCSI, UPM, UniKL: где официальный источник даёт два варианта (с подготовительным курсом и без; 2 или 3 года; два уровня семестровой платы), показан диапазон от и до.
- Sunway: официальные страницы дают для иностранцев только ориентировочную сумму в USD за год (оплата в MYR по курсу), она записана в USD.
- Во всех строках суммы без налога SST 6% и без регистрационных, визовых и страховых сборов, если источник не говорит иное.

## Фото карточек (08.11.2026)

Фото берутся только из Wikimedia Commons с открытой лицензией (автор, лицензия и страница файла записаны в `src/lib/university-photo-library.json` и `scripts/portal/university-photos-manifest.json`); с сайтов университетов и из поисковиков фото не берутся.

| Карточка | Ключ фото | Файл на Commons | Автор | Лицензия |
|---|---|---|---|---|
| Universiti Malaya | `um` | Universiti_Malaya_KL_gate.jpg | *angys* | CC BY-SA 4.0 |
| International Islamic University Malaysia | `iium` | Iiumcampus.jpg | پوویا | CC BY-SA 3.0 |
| ALFA University College | `alfa` | Alfa_University_College_building.jpg | Alfa university | CC0 |
| INTI International College Subang | `inti-subang` | INTI_Subang_-_Mapillary_(FrFeVDhUppVU9dh1EVMB5W).jpg | kaart_1 @ Mapillary.com | CC BY-SA 4.0 |
| INTI International College Penang | `inti-penang` | Cmglee_Inti_College_Penang.jpg | Cmglee | CC BY-SA 4.0 |
| Taylor’s College | `taylors` (общий с Taylor’s University) | Taylor's_Lakeside_Campus,_Subang_Jaya,_Malaysia.jpg | Md Shaifuzzaman Ayon | CC BY-SA 4.0 |
| Sunway College | `sunway` (общий с Sunway University) | Cmglee_Sunway_University_new_building.jpg | Cmglee | CC BY-SA 4.0 |
| INTI College Sabah | нет | свободной фотографии на Commons не найдено | | |

Taylor’s College (адрес на https://college.taylors.edu.my: Block E, Taylor’s Lakeside Campus) и Sunway College (https://sunwaycollege.edu.my: No. 2, Jalan Universiti, Bandar Sunway, рядом с Sunway University) стоят на кампусах своих университетов, поэтому общее фото честно, но это фото университета, не колледжа. Фото INTI Nilai (официальное, без права повторного использования) для кампусов INTI не годится.
