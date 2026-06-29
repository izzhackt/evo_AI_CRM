import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { getJobDir, isTerminalStatus, readJobRecord } from "@/lib/transcription/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(payload: unknown) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const jobDir = getJobDir(jobId);
  const eventsPath = path.join(jobDir, "events.jsonl");

  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      req.signal.addEventListener("abort", close);
      controller.enqueue(sse({ event: "stream_open", jobId, timestamp: new Date().toISOString() }));

      while (!closed) {
        try {
          const raw = await readFile(eventsPath, "utf8");
          const lines = raw.split("\n").filter(Boolean);
          for (const line of lines.slice(sent)) {
            try {
              controller.enqueue(sse(JSON.parse(line)));
            } catch {
              controller.enqueue(sse({ event: "malformed_event", line }));
            }
          }
          sent = lines.length;
        } catch {
          // The worker may not have created events.jsonl yet.
        }

        const record = await readJobRecord(jobId);
        if (record && isTerminalStatus(record.status)) {
          if (sent === 0) {
            controller.enqueue(sse({ event: `job_${record.status}`, status: record.status, error: record.error }));
          }
          close();
          break;
        }
        await wait(500);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
