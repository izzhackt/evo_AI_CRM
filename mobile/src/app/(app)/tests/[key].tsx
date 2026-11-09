import { useLocalSearchParams } from "expo-router";

import { AssessmentScreen } from "@/features/learning/tests/AssessmentScreen";

// `key`: english36 или orvis92; `attempt` открывает результат завершённой попытки.
export default function AssessmentRoute() {
  const { key, attempt } = useLocalSearchParams<{ key: string; attempt?: string }>();
  return <AssessmentScreen instrumentKey={key} attemptId={attempt ?? null} />;
}
