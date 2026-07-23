import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/auth";
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
  const authorization = await requireAdminApi();
  if (authorization.response) return authorization.response;
  const { jobId } = await params;
  const initialRecord = await readJobRecord(jobId);
  if (!initialRecord) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
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
      controller.enqueue(sse({ event: "stream_open", jobId }));

      while (!closed) {
        try {
          const raw = await readFile(eventsPath, "utf8");
          const lines = raw.split("\n").filter(Boolean);
          for (const line of lines.slice(sent)) {
            if (closed) break;
            try {
              const parsed = JSON.parse(line) as { event?: unknown; status?: unknown; progress?: unknown };
              controller.enqueue(
                sse({
                  event: typeof parsed.event === "string" ? parsed.event : "job_update",
                  ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
                  ...(typeof parsed.progress === "number" ? { progress: parsed.progress } : {}),
                }),
              );
            } catch {
              controller.enqueue(sse({ event: "malformed_event" }));
            }
          }
          sent = lines.length;
        } catch {
          // The worker may not have created events.jsonl yet.
        }

        if (closed) break;
        const record = await readJobRecord(jobId);
        if (record && isTerminalStatus(record.status)) {
          if (sent === 0) {
            controller.enqueue(
              sse({
                event: `job_${record.status}`,
                status: record.status,
                ...(record.status === "failed" ? { error: "processing_failed" } : {}),
              }),
            );
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
