import { TranscriptionLab } from "@/components/transcription/TranscriptionLab";
import { requireAdminPage } from "@/lib/guards";

export const metadata = {
  title: "Live MP3 Transcription Lab — EVO",
};

export default async function TranscriptionLabPage() {
  await requireAdminPage();
  return <TranscriptionLab />;
}
