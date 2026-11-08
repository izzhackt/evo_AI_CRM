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

- INTI: на страницах цена «From RM …» без подписи, годовая или за всю программу; записана как стоимость всей программы (сумма совпадает с полным сроком), нужно подтвердить.
- MMU: прайс июня 2026 показывает у foundation и магистратуры рядом «Now» и общую цену; записана общая цена программы.
- UCSI, UPM, UniKL: где официальный источник даёт два варианта (с подготовительным курсом и без; 2 или 3 года; два уровня семестровой платы), показан диапазон от и до.
- Sunway: официальные страницы дают для иностранцев только ориентировочную сумму в USD за год (оплата в MYR по курсу), она записана в USD.
- Во всех строках суммы без налога SST 6% и без регистрационных, визовых и страховых сборов, если источник не говорит иное.
