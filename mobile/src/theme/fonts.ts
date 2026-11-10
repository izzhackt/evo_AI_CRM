// Golos Text (интерфейс) и JetBrains Mono (данные): те же гарнитуры, что у веба.
// Лицензия обеих SIL OFL 1.1, тексты в assets/fonts/OFL-*.txt.
export const FONT_FILES = {
  "GolosText-Regular": require("../../assets/fonts/GolosText_400Regular.ttf"),
  "GolosText-Medium": require("../../assets/fonts/GolosText_500Medium.ttf"),
  "GolosText-SemiBold": require("../../assets/fonts/GolosText_600SemiBold.ttf"),
  "GolosText-Bold": require("../../assets/fonts/GolosText_700Bold.ttf"),
  "JetBrainsMono-Regular": require("../../assets/fonts/JetBrainsMono_400Regular.ttf"),
  "JetBrainsMono-Medium": require("../../assets/fonts/JetBrainsMono_500Medium.ttf"),
  "JetBrainsMono-Bold": require("../../assets/fonts/JetBrainsMono_700Bold.ttf"),
} as const;

export type Weight = "regular" | "medium" | "semibold" | "bold";

const SANS: Record<Weight, string> = {
  regular: "GolosText-Regular",
  medium: "GolosText-Medium",
  semibold: "GolosText-SemiBold",
  bold: "GolosText-Bold",
};
const MONO: Record<Weight, string> = {
  regular: "JetBrainsMono-Regular",
  medium: "JetBrainsMono-Medium",
  semibold: "JetBrainsMono-Medium",
  bold: "JetBrainsMono-Bold",
};

export const sansFont = (weight: Weight = "regular") => SANS[weight];
export const monoFont = (weight: Weight = "regular") => MONO[weight];
