import { useLocalSearchParams } from "expo-router";

import { LessonScreen } from "@/features/learning/csca/LessonScreen";

export default function CscaLessonRoute() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  return <LessonScreen lessonId={lessonId} />;
}
