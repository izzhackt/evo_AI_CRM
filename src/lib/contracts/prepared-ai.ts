import type { DateTimeString, EntityId } from "../domain";

export const PREPARED_AI_ALLOWED_REASON = "user_requested_first_presentation" as const;

export type AiUseCase = "whatsapp_reply" | "client_summary";

export type PreparedAiContext = {
  readonly presentationMode: "first_presentation" | "normal_operation";
  readonly userExplicitlyRequestedPreparedResponses: boolean;
  readonly useCase: AiUseCase;
};

export type LiveAnthropicAiResponse = {
  readonly source: "live_anthropic";
  readonly useCase: AiUseCase;
  readonly text: string;
  readonly model: string;
  readonly generatedAt: DateTimeString;
};

export type PreparedAiResponse = {
  readonly source: "prepared_first_presentation";
  readonly useCase: AiUseCase;
  readonly text: string;
  readonly allowedReason: typeof PREPARED_AI_ALLOWED_REASON;
  readonly mustDisplayPreparedLabel: true;
  readonly preparedByUserId: EntityId | null;
  readonly preparedAt: DateTimeString;
};

export type AiBlockedResponse =
  | {
      readonly source: "blocked";
      readonly useCase: AiUseCase;
      readonly reason: "anthropic_not_configured";
    }
  | {
      readonly source: "blocked";
      readonly useCase: AiUseCase;
      readonly reason: "prepared_response_not_allowed";
    };

export type AiGenerationContractResult = LiveAnthropicAiResponse | PreparedAiResponse | AiBlockedResponse;

export function isPreparedAiAllowed(context: PreparedAiContext): boolean {
  return context.presentationMode === "first_presentation" && context.userExplicitlyRequestedPreparedResponses;
}
