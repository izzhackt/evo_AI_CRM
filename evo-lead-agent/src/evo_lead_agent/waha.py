from __future__ import annotations

from typing import Any

import httpx

from .phone import waha_chat_id_from_phone


class WahaClient:
    def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.session_name = session_name

    async def send_text(self, phone: str, text: str) -> str | None:
        chat_id = waha_chat_id_from_phone(phone)
        if not chat_id:
            raise ValueError("invalid_phone")

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{self.base_url}/api/sendText",
                headers={"X-Api-Key": self.api_key, "Content-Type": "application/json"},
                json={"session": self.session_name, "chatId": chat_id, "text": text},
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
            return payload.get("id") or payload.get("messageId") or payload.get("messageTimestamp")

    async def session_info(self) -> dict[str, Any]:
        headers = {"X-Api-Key": self.api_key}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/api/sessions/{self.session_name}", headers=headers)
            if response.status_code == 404:
                list_response = await client.get(f"{self.base_url}/api/sessions", headers=headers)
                list_response.raise_for_status()
                sessions = list_response.json() if list_response.content else []
                session = _find_session(sessions, self.session_name)
                if session is None:
                    return {"name": self.session_name, "found": False}
                return _compact_session(session, self.session_name)
            response.raise_for_status()
            payload = response.json() if response.content else {}
            return _compact_session(payload, self.session_name)


def _find_session(sessions: object, session_name: str) -> dict[str, Any] | None:
    if not isinstance(sessions, list):
        return None
    for session in sessions:
        if not isinstance(session, dict):
            continue
        name = session.get("name") or session.get("session")
        if name == session_name:
            return session
    return None


def _compact_session(session: dict[str, Any], fallback_name: str) -> dict[str, Any]:
    status = session.get("status") or session.get("state") or session.get("engine")
    return {
        "name": session.get("name") or session.get("session") or fallback_name,
        "status": str(status)[:80] if status is not None else None,
        "found": True,
    }
