export type TranscriptionModelOption = {
  id: string;
  label: string;
  shortLabel: string;
  quality: string;
  speed: string;
  description: string;
};

export const TRANSCRIPTION_MODELS = [
  {
    id: "mlx-community/whisper-large-v3-mlx",
    label: "Local MLX Whisper Large v3",
    shortLabel: "Quality local",
    quality: "Better",
    speed: "Local",
    description: "Full large-v3 model for higher-quality local transcripts. Free after the first model download.",
  },
] as const satisfies readonly TranscriptionModelOption[];

export type TranscriptionModelId = (typeof TRANSCRIPTION_MODELS)[number]["id"];

export const DEFAULT_TRANSCRIPTION_MODEL = TRANSCRIPTION_MODELS[0].id;

export function isSupportedTranscriptionModel(model: string) {
  return TRANSCRIPTION_MODELS.some((option) => option.id === model);
}
