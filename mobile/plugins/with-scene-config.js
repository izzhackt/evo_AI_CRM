// Expo SDK 58 (prebuild-шаблон) пишет в Info.plist UISceneDelegateClassName
// "$(PRODUCT_MODULE_NAME).SceneDelegate" без UISceneClassName, а класс объявлен как
// @objc(SceneDelegate). На iOS 26.5 при этом окно не создаётся и приложение остаётся
// чёрным экраном без запуска React Native (проверено на симуляторе iPhone 17 Pro).
// Плагин задаёт имя класса и тип сцены явно. Убрать, когда Expo исправит шаблон.
const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withSceneConfig(config) {
  return withInfoPlist(config, (cfg) => {
    const configs = cfg.modResults.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    if (Array.isArray(configs)) {
      for (const entry of configs) {
        entry.UISceneDelegateClassName = "SceneDelegate";
        entry.UISceneClassName = "UIWindowScene";
      }
    }
    return cfg;
  });
};
