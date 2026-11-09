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
  },
  web: { output: "single", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
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
