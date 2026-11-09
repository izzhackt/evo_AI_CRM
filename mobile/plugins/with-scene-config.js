// Expo SDK 58 (prebuild-шаблон) пишет в Info.plist UISceneDelegateClassName
// "$(PRODUCT_MODULE_NAME).SceneDelegate" без UISceneClassName, а класс объявлен как
// @objc(SceneDelegate). На iOS 26.5 при этом окно не создаётся и приложение остаётся
// чёрным экраном без запуска React Native (проверено на симуляторе iPhone 17 Pro).
// Плагин задаёт имя класса и тип сцены явно. Убрать, когда Expo исправит шаблон.
// ПЕРЕПРОВЕРИТЬ при смене SDK (сейчас SDK 58, iOS 26.5): откройте ios/*/Info.plist после
// prebuild; если шаблон уже задаёт UISceneClassName, плагин не нужен.
const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withSceneConfig(config) {
  return withInfoPlist(config, (cfg) => {
    const configs = cfg.modResults.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    if (!Array.isArray(configs) || configs.length === 0) {
      console.warn("[with-scene-config] UIApplicationSceneManifest не найден: шаблон SDK изменился, плагин ничего не сделал. Проверьте запуск на iOS 26.");
    }
    if (Array.isArray(configs)) {
      for (const entry of configs) {
        entry.UISceneDelegateClassName = "SceneDelegate";
        entry.UISceneClassName = "UIWindowScene";
      }
    }
    return cfg;
  });
};
