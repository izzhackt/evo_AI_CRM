import { useLocalSearchParams } from "expo-router";

import { EnglishLessonScreen } from "@/features/learning/english/EnglishLessonScreen";

export default function EnglishLessonRoute() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  return <EnglishLessonScreen lessonId={lessonId} />;
}
