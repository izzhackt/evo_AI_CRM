import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";

// Disposable E4 transport only: forward to one fixed local Supabase origin.
// Node documents key/cert HTTPS servers and process-start CA trust at:
// https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener
// https://nodejs.org/api/cli.html#node_extra_ca_certsfile
const [origin, rawPort, keyPath, certPath] = process.argv.slice(2);
const upstream = new URL(origin);
const port = Number(rawPort);
if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1"
  || !upstream.port || upstream.username || upstream.password || upstream.search
  || upstream.hash || upstream.pathname !== "/"
  || !Number.isInteger(port) || port < 1024 || port > 65535 || !keyPath || !certPath) {
  throw new Error("E4 TLS proxy requires a fixed loopback origin and reserved port");
}

const server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (incoming, outgoing) => {
  if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
    outgoing.writeHead(400).end();
    return;
  }
  const forwarded = request({
    hostname: "127.0.0.1",
    port: upstream.port,
    method: incoming.method,
    path: incoming.url,
    headers: { ...incoming.headers, host: upstream.host, "x-forwarded-proto": "https" },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.on("error", () => outgoing.destroy());
    response.pipe(outgoing);
  });
  forwarded.setTimeout(30_000, () => forwarded.destroy());
  forwarded.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.on("aborted", () => forwarded.destroy());
  outgoing.on("close", () => forwarded.destroy());
  incoming.pipe(forwarded);
});

server.on("error", () => {
  console.error("E4_LOOPBACK_TLS_PROXY_FAILED");
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
server.listen(port, "127.0.0.1", () => console.log("E4_LOOPBACK_TLS_PROXY_READY"));
