import type { ExpoConfig } from "expo/config";

// Идентификатор проекта EAS (владелец создаёт проект после `eas login` / `eas init`):
// задаётся переменной EAS_PROJECT_ID (EAS environment variable или локальный env), в Git не хранится.
// Пока его нет, EAS Update выключен и сборка работает с вшитым бандлом.
const easProjectId = process.env.EAS_PROJECT_ID?.trim() || undefined;

// Конфиг сборки. Значения Supabase и портала сюда НЕ попадают: они читаются
// только из EXPO_PUBLIC_* в src/config.ts (см. .env.example).
const config: ExpoConfig = {
  name: "EVO admissions",
  slug: "evo-admissions",
  version: "2.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "evoadmissions",
  userInterfaceStyle: "automatic",
  runtimeVersion: { policy: "fingerprint" },
  updates: easProjectId
    ? {
        url: `https://u.expo.dev/${easProjectId}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  extra: easProjectId ? { eas: { projectId: easProjectId } } : {},
  ios: {
    bundleIdentifier: "com.evoadmissions.app",
    supportsTablet: false,
    icon: {
      light: "./assets/images/icon.png",
      dark: "./assets/images/icon-dark.png",
      tinted: "./assets/images/icon-tinted.png",
    },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    // Манифест приватности (Apple). Required-reason API: объединение того, что объявляют сами зависимости
    // (React Native, expo-file-system, expo-constants, expo-system-ui, async-storage), потому что Apple не
    // читает манифесты статических pod-ов. Сторонний трекинг и рекламные SDK не используются.
    // Собираемые данные согласованы с docs/mobile/STORE_LISTING.md (App Privacy): всё связано с пользователем,
    // цель только «функциональность приложения», для трекинга не используется.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
        },
      ],
      NSPrivacyCollectedDataTypes: [
        "NSPrivacyCollectedDataTypeName",
        "NSPrivacyCollectedDataTypeEmailAddress",
        "NSPrivacyCollectedDataTypePhoneNumber",
        "NSPrivacyCollectedDataTypeUserID",
        "NSPrivacyCollectedDataTypePhotosorVideos",
        "NSPrivacyCollectedDataTypeOtherUserContent",
      ].map((type) => ({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
      })),
    },
    // Universal links: личная ссылка регистрации https://app.evoadmissions.com/apply?invite=…
    // открывает приложение. Файл /.well-known/apple-app-site-association на сервере появится
    // позже (нужен Team ID): см. docs/mobile/APP_LINKS.md. До тех пор работает схема evoadmissions://.
    associatedDomains: ["applinks:app.evoadmissions.com"],
  },
  android: {
    package: "com.evoadmissions.app",
    adaptiveIcon: {
      backgroundColor: "#D70217",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // App Links (autoVerify): проверка идёт по https://app.evoadmissions.com/.well-known/assetlinks.json
    // (нужен SHA-256 подписи, см. docs/mobile/APP_LINKS.md). Открываются только пути /apply.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "app.evoadmissions.com", path: "/apply" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    // Остаются INTERNET, CAMERA (снимок документа), VIBRATE и ACCESS_NETWORK_STATE/WIFI_STATE (MapLibre).
    // Выбор фото идёт через системный Photo Picker без доступа ко всей галерее; микрофон, геолокация
    // (карта показывает только тайлы, «моё местоположение» не используется), биометрия и оверлеи не нужны:
    // лишние разрешения закрыты, release-манифест проверен в docs/mobile/STORE_LISTING.md.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  web: { output: "single", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    // Карта «Университетов»: MapLibre Native, тайлы OpenFreeMap как в вебе, без ключей (iOS и Android).
    "@maplibre/maplibre-react-native",
    "./plugins/with-scene-config",
    // Тексты запросов iOS на русском (основной язык кабинета); пустой микрофон отключает RECORD_AUDIO.
    [
      "expo-image-picker",
      {
        photosPermission: "EVO использует выбранные вами фото, чтобы загрузить документы для поступления.",
        cameraPermission: "EVO использует камеру, чтобы вы могли сфотографировать документ и загрузить его.",
        microphonePermission: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        // Цвета из токенов (lightTokens.bg / darkTokens.bg), знак EVO: scripts/generate-brand-assets.mjs.
        backgroundColor: "#f3f4f6",
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        dark: { backgroundColor: "#141311", image: "./assets/images/splash-icon-dark.png" },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
