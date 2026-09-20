"""Exercise the installed lead-agent HTTP stack without credentials or provider calls."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import anyio
import httpx


async def exercise(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, trust_env=False, timeout=5) as client:
        request_id = "dependency-runtime-smoke"
        health = await client.get("/health", headers={"x-request-id": request_id})
        assert health.status_code == 200, health.status_code
        assert health.json() == {"ok": True, "status": "live", "ready": False, "frozen": True}
        assert health.headers["x-request-id"] == request_id
        missing = await client.get("/dependency-smoke-missing")
        assert missing.status_code == 404, missing.status_code
        frozen = await client.post("/webhooks/waha", content=b"")
        assert frozen.status_code == 503, frozen.status_code
        assert frozen.json() == {"error": "lead_agent_frozen"}
        admin = await client.post("/admin/knowledge/import", content=b"")
        assert admin.status_code == 503, admin.status_code
        assert admin.json() == {"error": "admin_api_key_not_configured"}


def main() -> None:
    # An allowlist, temporary cwd and disabled dotenv prevent local credentials,
    # starter knowledge and an existing operational database from entering smoke.
    env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ}
    with tempfile.TemporaryDirectory(prefix="evo-agent-dependency-") as directory:
        env.update({
            "PYTHON_DOTENV_DISABLED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "EVO_AGENT_DB_PATH": str(Path(directory) / "runtime.db"),
            "EVO_AGENT_FROZEN": "true",
            "EVO_AGENT_WORKER_ENABLED": "false",
            "EVO_AGENT_STARTER_KNOWLEDGE_PATH": "",
        })
        # Reserve the socket and pass it to Uvicorn, avoiding a free-port race.
        with socket.socket() as listener, tempfile.TemporaryFile() as log:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "evo_lead_agent.main:app",
                 "--fd", str(listener.fileno()), "--log-level", "warning"],
                cwd=directory, env=env, pass_fds=(listener.fileno(),),
                stdout=log, stderr=log,
            )
            try:
                deadline = time.monotonic() + 20
                with httpx.Client(trust_env=False, timeout=0.3) as client:
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError("Lead-agent process exited before readiness")
                        try:
                            response = client.get(f"http://127.0.0.1:{port}/health")
                            if response.status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Lead-agent did not start within 20 seconds")
                        time.sleep(0.1)
                anyio.run(exercise, f"http://127.0.0.1:{port}")
                print("PASS: real lead-agent HTTP health, request-id, 404 and frozen/admin guards")
            except BaseException:
                log.seek(0)
                sys.stderr.write(log.read().decode(errors="replace"))
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
