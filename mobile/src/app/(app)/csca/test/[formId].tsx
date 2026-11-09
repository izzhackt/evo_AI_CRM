import { useLocalSearchParams } from "expo-router";

import { TestScreen } from "@/features/learning/test-runner/TestScreen";

// `attempt` открывает итог завершённой попытки (как веб `?attempt=`).
export default function CscaTestRoute() {
  const { formId, attempt } = useLocalSearchParams<{ formId: string; attempt?: string }>();
  return <TestScreen formId={formId} attemptId={attempt ?? null} />;
}
