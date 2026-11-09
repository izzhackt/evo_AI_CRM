import { Text as RNText, type TextProps, type TextStyle } from "react-native";

import { monoFont, sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";

export type TextVariant = "display" | "title" | "heading" | "body" | "secondary" | "caption" | "tab" | "data";

type Props = TextProps & { variant?: TextVariant; tone?: "text" | "text2" | "accent" | "error" | "ok" | "onAccent"; bold?: boolean };

export function Text({ variant = "body", tone = "text", bold, style, ...rest }: Props) {
  const { tokens } = useTheme();
  const base: Record<TextVariant, TextStyle> = {
    display: { fontFamily: sansFont("bold"), fontSize: tokens.sizeDisplay, lineHeight: tokens.sizeDisplay * 1.12, letterSpacing: -0.025 * tokens.sizeDisplay },
    title: { fontFamily: sansFont("semibold"), fontSize: tokens.sizeTitle, lineHeight: tokens.sizeTitle * 1.2 },
    heading: { fontFamily: sansFont("semibold"), fontSize: tokens.sizeHeading, lineHeight: tokens.sizeHeading * 1.25 },
    body: { fontFamily: sansFont(), fontSize: tokens.sizeBody, lineHeight: tokens.sizeBody * tokens.leading },
    secondary: { fontFamily: sansFont(), fontSize: tokens.sizeSecondary, lineHeight: tokens.sizeSecondary * tokens.leading },
    caption: { fontFamily: sansFont(), fontSize: tokens.sizeCaption, lineHeight: tokens.sizeCaption * tokens.leading },
    tab: { fontFamily: sansFont("medium"), fontSize: tokens.sizeTab, lineHeight: tokens.sizeTab * 1.3 },
    data: { fontFamily: monoFont(), fontSize: tokens.sizeSecondary, lineHeight: tokens.sizeSecondary * tokens.leading },
  };
  const color = tone === "text" ? tokens.text : tone === "text2" ? tokens.text2 : tone === "accent" ? tokens.accent : tone === "error" ? tokens.error : tone === "ok" ? tokens.ok : tokens.onAccent;
  return <RNText {...rest} style={[base[variant], { color }, bold ? { fontFamily: sansFont("semibold") } : null, style]} />;
}
