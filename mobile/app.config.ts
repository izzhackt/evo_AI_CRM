import type { ExpoConfig } from "expo/config";

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
  ios: {
    bundleIdentifier: "com.evoadmissions.app",
    supportsTablet: false,
    icon: "./assets/expo.icon",
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: "com.evoadmissions.app",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // Только CAMERA (снимок документа). Выбор фото идёт через системный Photo Picker без
    // доступа ко всей галерее, микрофон не нужен: лишние разрешения закрыты.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.RECORD_AUDIO",
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
        backgroundColor: "#f3f4f6",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
        dark: { backgroundColor: "#141311" },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
