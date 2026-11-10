// Строки среза «Профиль» (M6), которых нет в общих словарях веба (profile, accountDeletion, aiConsent).
// Всё остальное (пароль, удаление, согласие на ИИ) берётся из веба слово в слово.
// KY: needs native proofreading, как и в вебе.

export const PROFILE_RU = {
  "profile.myData": "Мои данные",
  "profile.nameLabel": "Имя",
  "profile.emailLabel": "Почта",
  "profile.dataNoteApproved": "Телефон и имя меняет менеджер: напишите в поддержку EVO, и он исправит.",
  "profile.languageNote": "Язык сохраняется в вашем аккаунте и на всех устройствах.",
  "profile.passwordOthers": "После смены пароля вы выйдете из аккаунта на других устройствах. Здесь вход сохранится.",
  "profile.passwordOpen": "Сменить пароль",
  "profile.passwordCancel": "Свернуть",
  "profile.passwordWrongCurrentHint": "Если вы только что сменили пароль, введите новый.",
  "profile.aboutHeading": "О приложении",
  "profile.privacy": "Политика конфиденциальности",
  "profile.support": "Поддержка EVO",
  "profile.licenses": "Лицензии сторонних библиотек",
  "profile.version": "Версия {version}",
  "profile.openFailed": "Не удалось открыть ссылку.",
  "profile.deleteSignOut": "Выйти и стереть данные на этом устройстве",
  "profile.deleteSignOutHint": "Аккаунт продолжит работать до удаления. С этого устройства вы выйдете, скачанные файлы и сохранённые настройки будут стёрты.",
  "profile.retry": "Повторить",
  "licenses.title": "Лицензии сторонних библиотек",
  "licenses.intro": "Приложение использует открытые библиотеки, шрифты и данные карты. Ниже их лицензии.",
  "licenses.search": "Поиск по названию",
  "licenses.count": "Записей: {count}",
  "licenses.empty": "Ничего не найдено.",
  "licenses.noText": "Текст лицензии в пакете не приложен. Лицензия по описанию пакета: {license}.",
  "licenses.close": "Закрыть",
  "licenses.openSite": "Открыть страницу проекта",
} as const;

export type ProfileStringKey = keyof typeof PROFILE_RU;

export const PROFILE_KY: Readonly<Record<ProfileStringKey, string>> = {
  "profile.myData": "Менин маалыматтарым",
  "profile.nameLabel": "Аты-жөнү",
  "profile.emailLabel": "Почта",
  "profile.dataNoteApproved": "Телефонду жана атыңызды менеджер өзгөртөт: EVO колдоо кызматына жазыңыз, ал оңдойт.", // KY: needs native proofreading
  "profile.languageNote": "Тил аккаунтуңузда жана бардык түзмөктөрдө сакталат.",
  "profile.passwordOthers": "Сырсөздү өзгөрткөндөн кийин башка түзмөктөрдөгү аккаунтуңуздан чыгасыз. Бул жерде кирип турасыз.",
  "profile.passwordOpen": "Сырсөздү өзгөртүү",
  "profile.passwordCancel": "Жыйноо",
  "profile.passwordWrongCurrentHint": "Эгер сырсөздү жаңы эле өзгөрткөн болсоңуз, жаңысын киргизиңиз.", // KY: needs native proofreading
  "profile.aboutHeading": "Колдонмо жөнүндө",
  "profile.privacy": "Купуялык саясаты",
  "profile.support": "EVO колдоо кызматы",
  "profile.licenses": "Үчүнчү тараптын китепканаларынын лицензиялары",
  "profile.version": "Версия {version}",
  "profile.openFailed": "Шилтеме ачылган жок.",
  "profile.deleteSignOut": "Чыгуу жана бул түзмөктөгү маалыматтарды өчүрүү",
  "profile.deleteSignOutHint": "Аккаунт өчүрүлгөнгө чейин иштей берет. Бул түзмөктөн чыгасыз, жүктөлгөн файлдар жана сакталган жөндөөлөр өчүрүлөт.",
  "profile.retry": "Кайталоо",
  "licenses.title": "Үчүнчү тараптын китепканаларынын лицензиялары",
  "licenses.intro": "Колдонмо ачык китепканаларды, шрифттерди жана карта маалыматтарын колдонот. Алардын лицензиялары төмөндө.",
  "licenses.search": "Аталышы боюнча издөө",
  "licenses.count": "Жазуулар: {count}",
  "licenses.empty": "Эч нерсе табылган жок.",
  "licenses.noText": "Пакетте лицензиянын тексти жок. Пакеттин сүрөттөмөсү боюнча лицензия: {license}.",
  "licenses.close": "Жабуу",
  "licenses.openSite": "Долбоордун баракчасын ачуу",
};
