import "server-only";

import type { AssessmentQuestion, StudentAssessmentKey } from "../student-assessment-contract";

type AuthoredAssessmentContent = {
  instrumentKey: string;
  version: string;
  locale: string;
  metadata: { title: string; description: string; instructions: string[]; limitations: string[] };
  questions: AssessmentQuestion[];
};

export type StudentPortalAssessmentPreview = {
  instrumentKey: StudentAssessmentKey;
  version: string;
  locale: string;
  title: string;
  description: string;
  instructions: string[];
  limitations: string[];
  questions: AssessmentQuestion[];
};

/** Only authored public question fields cross the Server/Client boundary. */
export function projectAssessmentPreviewContent(content: AuthoredAssessmentContent): StudentPortalAssessmentPreview {
  if (content.instrumentKey !== "english36" && content.instrumentKey !== "orvis92") {
    throw new Error("Unsupported assessment preview content");
  }
  return {
    instrumentKey: content.instrumentKey,
    version: content.version,
    locale: content.locale,
    title: content.metadata.title,
    description: content.metadata.description,
    instructions: content.metadata.instructions.map(instruction => instruction),
    limitations: content.metadata.limitations.map(limitation => limitation),
    questions: content.questions.map(question => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options.map(option => ({ id: option.id, label: option.label })),
      ...(question.passage ? { passage: question.passage } : {}),
    })),
  };
}
