import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { correctTranscriptWithContext, type RawTranscriptSegment } from "@/lib/transcription/correction";
import { getJobDir, readJobRecord } from "@/lib/transcription/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TranscriptJson = {
  audio?: string;
  model?: string;
  language?: string | null;
  segments?: RawTranscriptSegment[];
};

function formatTimestamp(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function renderCorrectedMarkdown(result: Awaited<ReturnType<typeof correctTranscriptWithContext>>) {
  const lines = ["# Corrected Transcript", "", "## Transcript", ""];
  for (const segment of result.segments) {
    lines.push(`**[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}]** ${segment.correctedText}`);
  }
  lines.push("", "## Correction Report", "");
  if (result.correctionReport.length) {
    lines.push(...result.correctionReport.map((item) => `- ${item}`));
  } else {
    lines.push("- No major corrections reported.");
  }
  lines.push("", "## Uncertain Phrases", "");
  if (result.uncertainPhrases.length) {
    lines.push(...result.uncertainPhrases.map((item) => `- ${item}`));
  } else {
    lines.push("- None reported.");
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderReportMarkdown(result: Awaited<ReturnType<typeof correctTranscriptWithContext>>) {
  const lines = ["# Transcript Correction Report", "", "## Important Fixes", ""];
  lines.push(...(result.correctionReport.length ? result.correctionReport.map((item) => `- ${item}`) : ["- No major corrections reported."]));
  lines.push("", "## Low Confidence Segments", "");
  const lowConfidence = result.segments.filter((segment) => segment.confidence !== "high" || segment.notes);
  if (lowConfidence.length) {
    for (const segment of lowConfidence) {
      lines.push(
        `- [${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}] ${segment.confidence}: ${segment.notes || "review recommended"}`,
      );
    }
  } else {
    lines.push("- None reported.");
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const record = await readJobRecord(jobId);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (record.status !== "completed") {
    return NextResponse.json({ error: "job_not_completed" }, { status: 409 });
  }

  const jobDir = getJobDir(jobId);
  const transcriptPath = path.join(jobDir, "transcript.json");
  let transcript: TranscriptJson;
  try {
    transcript = JSON.parse(await readFile(transcriptPath, "utf8")) as TranscriptJson;
  } catch {
    return NextResponse.json({ error: "raw_transcript_missing" }, { status: 404 });
  }

  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (!segments.length) {
    return NextResponse.json({ error: "raw_segments_missing" }, { status: 400 });
  }

  try {
    const result = await correctTranscriptWithContext({
      audioName: path.basename(transcript.audio || record.audioPath),
      model: transcript.model || record.model,
      language: transcript.language,
      segments,
    });
    const outputs = {
      correctedJson: path.join(jobDir, "corrected_transcript.json"),
      correctedMd: path.join(jobDir, "corrected_transcript.md"),
      correctionReport: path.join(jobDir, "correction_report.md"),
    };
    await writeFile(outputs.correctedJson, JSON.stringify(result, null, 2), "utf8");
    await writeFile(outputs.correctedMd, renderCorrectedMarkdown(result), "utf8");
    await writeFile(outputs.correctionReport, renderReportMarkdown(result), "utf8");
    return NextResponse.json({ result, outputs });
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return NextResponse.json({ error: "not_configured" }, { status: 400 });
    }
    if (
      error instanceof Error &&
      [
        "zai_error",
        "zai_invalid_response",
        "zai_empty_response",
        "zai_timeout",
        "zai_overloaded",
        "correction_json_missing",
      ].includes(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Transcript correction error:", error);
    return NextResponse.json({ error: "correction_failed" }, { status: 500 });
  }
}
