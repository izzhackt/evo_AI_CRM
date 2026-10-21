# Письмо-разрешение компании для App Review: шаблон

Зачем: решение владельца 21.10.2026 (`owner-checklist.md`, Р1 и шаг 2.1). Приложение публикуется с аккаунта Apple Developer Program типа Individual, который принадлежит техническому директору ОсОО «ЭВО Адмишнс». Правило 5.2.1 просит, чтобы приложение подавал владелец прав на бренд или тот, кто получил на них лицензию; правило 5.1.1(ix) просит, чтобы приложение с чувствительными данными подавала компания, которая оказывает услугу. Письмо подтверждает, что услугу оказывает компания, данные принадлежат ей, а разработчик публикует приложение по её поручению и с лицензией на бренд.

Как оформить:

1. Скопировать текст ниже в документ на бланке компании, заменить все `[[...]]`. Реквизиты взять из свидетельства о государственной регистрации, они же стоят на странице политики конфиденциальности сайта.
2. Подписывает директор; печать по желанию. Строку «С условиями письма согласен» подписывает технический директор. Один документ, русский и английский текст на одной или двух страницах.
3. Скан в PDF хранится у владельца. Заполненное и подписанное письмо в Git и в чат не попадает.
4. Приложить в App Store Connect к «App Review Information», если там есть поле для вложения, или отправить в ответ на вопрос App Review (`review-notes.md`).

Текст написан без утверждения о зарегистрированном товарном знаке: «EVO Admissions» в нём называется наименованием и брендом компании. Если товарный знак будет зарегистрирован, в пункт 3 можно добавить номер свидетельства. Пункт 5 закрепляет, что будет после отзыва (срок 30 дней можно изменить); строка «С условиями письма согласен» подписывает технический директор, чтобы обязательства были двусторонними. Права на само приложение (код и интерфейс) письмо не описывает: если владелец подтвердит, что приложение принадлежит компании, в пункт 4 можно добавить «и приложение».

## Русский текст

```
Общество с ограниченной ответственностью «ЭВО Адмишнс»
ИНН [[ИНН]], регистрационный номер [[регистрационный номер]]
[[юридический адрес]]

Исх. № [[номер]] от [[дата]]

Apple Inc., App Review

ПИСЬМО-РАЗРЕШЕНИЕ

Общество с ограниченной ответственностью «ЭВО Адмишнс» (далее Компания) в лице директора [[ФИО директора]], действующего на основании Устава, подтверждает следующее.

1. Компания оказывает услуги по сопровождению поступления в зарубежные университеты под наименованием EVO Admissions. Компания является оператором (владельцем записей) персональных данных пользователей мобильного приложения «EVO Admissions» (идентификатор com.evoadmissions.app) и сервиса app.evoadmissions.com.

2. Компания поручает и разрешает своему техническому директору [[ФИО разработчика в дательном падеже]] публиковать, обновлять и сопровождать приложение «EVO Admissions» в App Store с личного аккаунта технического директора в Apple Developer Program. В App Store технический директор выступает от собственного имени как держатель этого аккаунта, по поручению и в интересах Компании.

3. Компания предоставляет [[ФИО разработчика в дательном падеже]] безвозмездную неисключительную лицензию на использование наименования и бренда EVO Admissions, логотипа и материалов Компании в этом приложении и на его странице в App Store на весь срок действия настоящего письма. Лицензия включает право предоставить Apple права, необходимые для распространения приложения и его содержания через App Store.

4. Права на наименование, бренд, логотип, материалы и данные пользователей остаются за Компанией.

5. Разрешение действует до его письменного отзыва Компанией. После отзыва [[ФИО разработчика]] прекращает использовать наименование, бренд и логотип Компании и по требованию Компании в течение 30 дней передаёт приложение на аккаунт Apple Developer Program, который укажет Компания (App Transfer), либо снимает его с публикации в App Store.

Директор ____________________ / [[ФИО директора]] /
М.П.

С условиями письма согласен: ____________________ / [[ФИО разработчика]] /
```

## English text

```
EVO Admissions Limited Liability Company (ОсОО «ЭВО Адмишнс»)
Taxpayer number (INN) [[INN]], state registration number [[registration number]]
[[registered address]]

Ref. No. [[number]], [[date]]

Apple Inc., App Review

LETTER OF AUTHORIZATION

EVO Admissions Limited Liability Company (EVO Admissions LLC, the Company), represented by its Director [[director full name]], acting under the Charter, confirms the following.

1. The Company provides university admission support services under the name EVO Admissions. The Company is the controller of the personal data of the users of the mobile app "EVO Admissions" (bundle ID com.evoadmissions.app) and of the service app.evoadmissions.com.

2. The Company instructs and authorizes its Chief Technology Officer, [[developer full name]], to publish, update and maintain the "EVO Admissions" app on the App Store from the Chief Technology Officer's own Apple Developer Program account. On the App Store the Chief Technology Officer acts in their own name as the holder of that account, on the instructions and in the interests of the Company.

3. The Company grants [[developer full name]] a royalty-free, non-exclusive license to use the EVO Admissions name and brand, logo and Company materials in this app and on its App Store page for as long as this letter remains in effect. The license includes the right to grant Apple the rights needed to distribute the app and its content through the App Store.

4. All rights to the name, brand, logo, materials and user data remain with the Company.

5. This authorization remains in effect until the Company revokes it in writing. After revocation, [[developer full name]] will stop using the Company's name, brand and logo and, at the Company's request and within 30 days, will transfer the app to an Apple Developer Program account designated by the Company (App Transfer) or remove it from the App Store.

Director ____________________ / [[director full name]] /
Seal

Acknowledged and agreed: ____________________ / [[developer full name]] /
```
