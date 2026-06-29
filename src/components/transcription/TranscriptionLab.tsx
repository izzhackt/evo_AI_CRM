"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUploadCard } from "./FileUploadCard";
import { LightSpeedCanvas } from "./LightSpeedCanvas";
import { RobotBackdrop } from "./RobotBackdrop";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODELS,
  type TranscriptionModelId,
} from "@/lib/transcription/models";

type Segment = {
  start: number;
  end: number;
  text: string;
};

type OutputPaths = {
  txt?: string;
  json?: string;
  md?: string;
  events?: string;
};

type CorrectionOutputs = {
  correctedJson?: string;
  correctedMd?: string;
  correctionReport?: string;
};

type CorrectionSegment = {
  start: number;
  end: number;
  rawText: string;
  correctedText: string;
  confidence: "high" | "medium" | "low";
  notes: string;
};

type CorrectionResult = {
  correctedTranscript: string;
  correctionReport: string[];
  uncertainPhrases: string[];
  segments: CorrectionSegment[];
};

type StreamEvent = {
  event: string;
  timestamp?: string;
  jobId?: string;
  audioName?: string;
  durationSeconds?: number;
  totalChunks?: number;
  chunkIndex?: number;
  progress?: number;
  language?: string;
  text?: string;
  segments?: Segment[];
  outputs?: OutputPaths;
  elapsedSeconds?: number;
  error?: string;
};

type JobResponse = {
  jobId: string;
  eventsUrl: string;
  statusUrl: string;
  provider: string;
  model: string;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function TranscriptionLab() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "running" | "completed" | "failed">("idle");
  const [message, setMessage] = useState("Ready for an MP3 call.");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [progress, setProgress] = useState(0);
  const [language, setLanguage] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputPaths | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<TranscriptionModelId>(DEFAULT_TRANSCRIPTION_MODEL);
  const [improving, setImproving] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<CorrectionResult | null>(null);
  const [correctionOutputs, setCorrectionOutputs] = useState<CorrectionOutputs | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const running = status === "uploading" || status === "running";
  const transcriptText = useMemo(() => segments.map((segment) => segment.text).join(" ").trim(), [segments]);

  useEffect(() => {
    if (!startedAt || !running) return;
    const interval = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500);
    return () => window.clearInterval(interval);
  }, [running, startedAt]);

  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  function resetForFile(nextFile: File) {
    sourceRef.current?.close();
    setFile(nextFile);
    setJob(null);
    setStatus("idle");
    setMessage("Ready to start local transcription.");
    setSegments([]);
    setProgress(0);
    setLanguage(null);
    setOutputs(null);
    setStartedAt(null);
    setElapsed(0);
    setError(null);
    setImproving(false);
    setCorrectionError(null);
    setCorrection(null);
    setCorrectionOutputs(null);
  }

  function handleEvent(event: StreamEvent) {
    if (event.event === "job_started") {
      setStatus("running");
      setMessage(`Processing ${event.totalChunks ?? 1} chunk${event.totalChunks === 1 ? "" : "s"} locally.`);
    }
    if (event.event === "chunk_started") {
      setStatus("running");
      setMessage(`Listening to chunk ${event.chunkIndex ?? "?"}...`);
    }
    if (event.event === "chunk_transcribed") {
      setStatus("running");
      setLanguage(event.language || null);
      setProgress(event.progress || 0);
      setMessage(`Transcript updated from chunk ${event.chunkIndex ?? "?"}.`);
      if (event.segments?.length) {
        setSegments((current) => [...current, ...event.segments!]);
      } else if (event.text) {
        setSegments((current) => [...current, { start: 0, end: 0, text: event.text! }]);
      }
    }
    if (event.event === "job_completed") {
      setStatus("completed");
      setProgress(1);
      setLanguage(event.language || language);
      setOutputs(event.outputs || null);
      setCorrection(null);
      setCorrectionOutputs(null);
      setCorrectionError(null);
      setMessage("Transcript saved and ready for LLM summarization.");
      sourceRef.current?.close();
    }
    if (event.event === "job_failed") {
      setStatus("failed");
      setError(event.error || "Transcription failed.");
      setMessage("The worker stopped before finishing.");
      sourceRef.current?.close();
    }
  }

  async function improveWithContext() {
    if (!job || improving || status !== "completed") return;
    setImproving(true);
    setCorrectionError(null);
    try {
      const response = await fetch(`/api/transcription/jobs/${job.jobId}/improve`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        const message =
          payload?.error === "not_configured"
            ? "Z.ai API key is not configured. Set ZAI_API_KEY or Z_AI_API_KEY, then restart the dev server."
            : payload?.error === "zai_error"
              ? "Z.ai returned an error while improving the transcript."
              : payload?.error === "zai_overloaded"
                ? "Z.ai is temporarily overloaded. Retry in a minute."
              : payload?.error === "zai_timeout"
                ? "Z.ai timed out while improving the transcript. Try a shorter call or retry."
              : payload?.error === "zai_invalid_response" || payload?.error === "zai_empty_response"
                ? "Z.ai returned an unreadable response."
                : payload?.error === "correction_json_missing"
                  ? "Z.ai did not return the required correction JSON."
            : payload?.error || "Could not improve transcript.";
        throw new Error(message);
      }
      setCorrection(payload.result);
      setCorrectionOutputs(payload.outputs);
    } catch (nextError) {
      setCorrectionError(nextError instanceof Error ? nextError.message : "Could not improve transcript.");
    } finally {
      setImproving(false);
    }
  }

  async function startTranscription() {
    if (!file || running) return;
    if (!file.name.toLowerCase().endsWith(".mp3")) {
      setError("Please choose an MP3 file.");
      setStatus("failed");
      return;
    }

    sourceRef.current?.close();
    setStatus("uploading");
    setStartedAt(Date.now());
    setElapsed(0);
    setMessage("Uploading MP3 and starting local worker...");
    setSegments([]);
    setProgress(0);
    setOutputs(null);
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("provider", "mlx-whisper");
    formData.set("model", selectedModel);

    try {
      const response = await fetch("/api/transcription/jobs", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Could not start transcription.");
      }
      setJob(payload);
      setStatus("running");
      setMessage("Worker started. Waiting for first transcript chunk...");
      const source = new EventSource(payload.eventsUrl);
      sourceRef.current = source;
      source.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(event.data) as StreamEvent);
        } catch {
          setMessage("Received an unreadable worker event.");
        }
      };
      source.onerror = () => {
        if (status !== "completed") {
          setMessage("Live stream disconnected. Check saved job files or retry.");
        }
      };
    } catch (nextError) {
      setStatus("failed");
      setError(nextError instanceof Error ? nextError.message : "Could not start transcription.");
      setMessage("Upload or worker start failed.");
    }
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-5 py-5 sm:px-7 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-100 pb-5">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.01em] text-slate-950">Live MP3 Transcription Lab</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-slate-500">
              Upload one Evo admissions call and watch the local MLX Whisper transcript appear while the MP3 is processed.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700">
            <span className={["h-2 w-2 rounded-full", running ? "animate-pulse bg-blue-600" : "bg-blue-300"].join(" ")} />
            {TRANSCRIPTION_MODELS.find((option) => option.id === selectedModel)?.shortLabel ?? "Local MLX Whisper"}
          </div>
        </header>

        <section className="relative mt-6 flex flex-1 overflow-hidden rounded-[22px] border border-blue-100 bg-[#f8fbff] shadow-[0_30px_90px_-58px_rgba(30,64,175,0.65)]">
          <LightSpeedCanvas active={running} />
          <div className="relative z-10 grid w-full gap-5 p-4 lg:grid-cols-[410px_1fr] lg:p-6">
            <aside className="flex flex-col gap-4">
              <FileUploadCard file={file} disabled={running} onFile={resetForFile} />
              <div className="rounded-[16px] border border-blue-100 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="mb-4">
                  <div className="mb-2 text-[12px] font-bold text-slate-800">Model</div>
                  <div className="grid gap-2">
                    {TRANSCRIPTION_MODELS.map((option) => {
                      const selected = option.id === selectedModel;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={running}
                          onClick={() => setSelectedModel(option.id)}
                          className={[
                            "rounded-[12px] border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-70",
                            selected ? "border-blue-500 bg-blue-50 shadow-sm" : "border-blue-100 bg-white hover:border-blue-300",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-slate-900">{option.label}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-blue-700">
                              {option.quality}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-slate-500">
                            {option.speed} · {option.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="font-semibold text-slate-400">File</div>
                    <div className="mt-1 truncate font-semibold text-slate-800">{file ? file.name : "No file selected"}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-400">Size</div>
                    <div className="mt-1 font-semibold text-slate-800">{file ? formatBytes(file.size) : "—"}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-400">Elapsed</div>
                    <div className="mt-1 font-semibold text-slate-800">{formatTime(elapsed)}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-400">Language</div>
                    <div className="mt-1 font-semibold text-slate-800">{language || "Detecting"}</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!file || running}
                  onClick={startTranscription}
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-blue-600 px-4 text-[13px] font-bold text-white shadow-[0_16px_36px_-24px_rgba(37,99,235,0.95)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
                >
                  {running ? "Transcribing..." : "Start transcription"}
                </button>
                <button
                  type="button"
                  disabled={!job || status !== "completed" || improving}
                  onClick={improveWithContext}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-blue-200 bg-white px-4 text-[12px] font-bold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {improving ? "Improving with context..." : "Improve with context"}
                </button>
              </div>
            </aside>

            <section
              className={[
                "relative min-h-[620px] overflow-hidden rounded-[18px] border border-blue-100 p-5 shadow-sm backdrop-blur-xl transition-colors duration-300",
                running ? "bg-white/66" : "bg-white/88",
              ].join(" ")}
            >
              <RobotBackdrop sceneUrl={process.env.NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL} />
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[18px] font-bold text-slate-950">Live transcript</h2>
                  <p className="mt-1 text-[13px] text-slate-500">{message}</p>
                </div>
                <div className="min-w-[180px] rounded-full border border-blue-100 bg-white px-3 py-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-right text-[11px] font-semibold text-blue-700">{Math.round(progress * 100)}%</div>
                </div>
              </div>

              {error && (
                <div className="relative z-10 mt-4 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
                  {error}
                </div>
              )}
              {correctionError && (
                <div className="relative z-10 mt-4 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                  {correctionError}
                </div>
              )}

              <div
                className={[
                  "relative z-10 mt-5 h-[430px] overflow-y-auto rounded-[14px] border border-blue-100 p-4 font-[var(--font-jbmono)] text-[13px] leading-7 text-slate-800 transition-colors duration-300",
                  running ? "bg-white/72 shadow-[inset_0_0_42px_rgba(219,234,254,0.76)]" : "bg-white/88",
                ].join(" ")}
              >
                {segments.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center font-[var(--font-golos)] text-[13px] leading-6 text-slate-400">
                    Transcript lines will appear here as each audio chunk finishes.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {segments.map((segment, index) => (
                      <p key={`${segment.start}-${index}`}>
                        <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">
                          {segment.start || segment.end ? `${formatTime(segment.start)}-${formatTime(segment.end)}` : "live"}
                        </span>
                        {segment.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative z-10 mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
                <div className={["rounded-[14px] border border-blue-100 p-3", running ? "bg-blue-50/60 backdrop-blur" : "bg-blue-50/70"].join(" ")}>
                  <div className="text-[12px] font-bold text-blue-900">LLM-ready text</div>
                  <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-blue-800/75">
                    {transcriptText || "After completion, use the saved .md or .txt file for summarization and quality review."}
                  </p>
                </div>
                <div className={["rounded-[14px] border border-blue-100 p-3", running ? "bg-white/64 backdrop-blur" : "bg-white/85"].join(" ")}>
                  <div className="text-[12px] font-bold text-slate-800">Saved outputs</div>
                  <div className="mt-1 space-y-1 text-[11px] leading-5 text-slate-500">
                    <div className="truncate">TXT: {outputs?.txt || "—"}</div>
                    <div className="truncate">JSON: {outputs?.json || "—"}</div>
                    <div className="truncate">MD: {outputs?.md || "—"}</div>
                  </div>
                </div>
              </div>

              {correction && (
                <div className="relative z-10 mt-4 rounded-[14px] border border-blue-100 bg-white/88 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-bold text-slate-900">Context-improved transcript</div>
                      <p className="mt-1 text-[12px] leading-5 text-slate-500">
                        Raw text is preserved. Review low-confidence lines before using numbers, names, dates, prices, or commitments.
                      </p>
                    </div>
                    <div className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                      {correction.segments.length} segments
                    </div>
                  </div>
                  <div className="mt-3 max-h-[260px] overflow-y-auto rounded-[12px] border border-blue-100 bg-white p-3 text-[13px] leading-6 text-slate-800">
                    <div className="space-y-3">
                      {correction.segments.map((segment, index) => (
                        <div key={`${segment.start}-${index}`} className="grid gap-1 border-b border-blue-50 pb-3 last:border-0 last:pb-0">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                              {formatTime(segment.start)}-{formatTime(segment.end)}
                            </span>
                            <span
                              className={[
                                "rounded px-1.5 py-0.5",
                                segment.confidence === "high"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : segment.confidence === "medium"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-red-50 text-red-700",
                              ].join(" ")}
                            >
                              {segment.confidence}
                            </span>
                            {segment.notes && <span className="text-slate-400">{segment.notes}</span>}
                          </div>
                          <div>{segment.correctedText}</div>
                          {segment.correctedText !== segment.rawText && (
                            <div className="text-[12px] text-slate-400">Raw: {segment.rawText}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[12px] bg-blue-50/70 p-3">
                      <div className="text-[12px] font-bold text-blue-900">Correction report</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] leading-5 text-blue-800/80">
                        {(correction.correctionReport.length ? correction.correctionReport : ["No major corrections reported."]).map(
                          (item) => (
                            <li key={item}>{item}</li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="rounded-[12px] bg-white p-3">
                      <div className="text-[12px] font-bold text-slate-800">Improved files</div>
                      <div className="mt-1 space-y-1 text-[11px] leading-5 text-slate-500">
                        <div className="truncate">MD: {correctionOutputs?.correctedMd || "—"}</div>
                        <div className="truncate">JSON: {correctionOutputs?.correctedJson || "—"}</div>
                        <div className="truncate">Report: {correctionOutputs?.correctionReport || "—"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {job && (
                <div className="relative z-10 mt-3 text-[11px] font-semibold text-slate-400">
                  Job `{job.jobId}` · {job.model}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
