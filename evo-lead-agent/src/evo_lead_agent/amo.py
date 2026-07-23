from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import Settings
from .schemas import AmoLeadRef


@dataclass(frozen=True)
class TokenSet:
    token_type: str
    access_token: str
    refresh_token: str
    expires_in: int


class AmoCrmClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.amo_account_base_url:
            raise ValueError("missing_amo_account_base_url")
        self.settings = settings
        self.base_url = settings.amo_account_base_url.rstrip("/")

    async def ensure_lead_for_phone(self, phone: str, name: str | None, source: str) -> AmoLeadRef:
        existing = await self.find_lead_by_phone(phone)
        if existing:
            return AmoLeadRef(
                lead_id=int(existing["lead_id"]),
                contact_id=existing.get("contact_id"),
                created=False,
            )

        contact_id = await self.create_contact(phone=phone, name=name or phone)
        lead_id = await self.create_lead(
            name=f"EVO WhatsApp lead {phone}",
            source=source,
            contact_id=contact_id,
        )
        return AmoLeadRef(lead_id=lead_id, contact_id=contact_id, created=True)

    async def find_lead_by_phone(self, phone: str) -> dict[str, Any] | None:
        data = await self._request_json(
            "GET",
            "/api/v4/contacts",
            params={"query": phone, "with": "leads", "limit": 10},
        )
        contacts = data.get("_embedded", {}).get("contacts", [])
        for contact in contacts:
            contact_id = contact.get("id")
            leads = contact.get("_embedded", {}).get("leads", [])
            if leads:
                return {"contact_id": contact_id, "lead_id": leads[0].get("id")}
        return None

    async def account_info(self) -> dict[str, Any]:
        data = await self._request_json("GET", "/api/v4/account")
        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "subdomain": data.get("subdomain"),
        }

    async def create_contact(self, phone: str, name: str) -> int:
        payload = [
            {
                "name": name,
                "custom_fields_values": [
                    {"field_code": "PHONE", "values": [{"value": phone, "enum_code": "WORK"}]}
                ],
            }
        ]
        data = await self._request_json("POST", "/api/v4/contacts", json=payload)
        contact_id = data.get("_embedded", {}).get("contacts", [{}])[0].get("id")
        if not contact_id:
            raise RuntimeError("amo_contact_id_missing")
        return int(contact_id)

    async def create_lead(self, name: str, source: str, contact_id: int | None) -> int:
        lead: dict[str, Any] = {"name": name}
        if self.settings.amo_pipeline_id:
            lead["pipeline_id"] = self.settings.amo_pipeline_id
        if self.settings.amo_status_id:
            lead["status_id"] = self.settings.amo_status_id
        if self.settings.amo_responsible_user_id:
            lead["responsible_user_id"] = self.settings.amo_responsible_user_id
        lead["_embedded"] = {"tags": [{"name": source}, {"name": "leadAgent"}]}
        data = await self._request_json("POST", "/api/v4/leads", json=[lead])
        lead_id = data.get("_embedded", {}).get("leads", [{}])[0].get("id")
        if not lead_id:
            raise RuntimeError("amo_lead_id_missing")
        if contact_id:
            await self.link_contact_to_lead(lead_id=int(lead_id), contact_id=contact_id)
        return int(lead_id)

    async def link_contact_to_lead(self, lead_id: int, contact_id: int) -> None:
        await self._request_json(
            "POST",
            f"/api/v4/leads/{lead_id}/link",
            json=[{"to_entity_id": contact_id, "to_entity_type": "contacts"}],
        )

    async def add_lead_note(self, lead_id: int, text: str) -> int | None:
        payload = [{"note_type": "common", "params": {"text": text}}]
        data = await self._request_json("POST", f"/api/v4/leads/{lead_id}/notes", json=payload)
        note_id = data.get("_embedded", {}).get("notes", [{}])[0].get("id")
        return int(note_id) if note_id else None

    async def create_followup_task(self, lead_id: int, text: str, complete_till: int) -> int | None:
        task: dict[str, Any] = {
            "entity_id": lead_id,
            "entity_type": "leads",
            "text": text,
            "complete_till": complete_till,
        }
        if self.settings.amo_responsible_user_id:
            task["responsible_user_id"] = self.settings.amo_responsible_user_id
        data = await self._request_json("POST", "/api/v4/tasks", json=[task])
        task_id = data.get("_embedded", {}).get("tasks", [{}])[0].get("id")
        return int(task_id) if task_id else None

    async def _request_json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        token = await self._refresh_token()
        headers = kwargs.pop("headers", {})
        headers.update(
            {
                "Authorization": f"Bearer {token.access_token}",
                "Content-Type": "application/json",
            }
        )
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else {}

    async def _refresh_token(self) -> TokenSet:
        refresh_token = self._read_refresh_token()
        if not refresh_token:
            raise ValueError("missing_amo_refresh_token")
        payload = {
            "client_id": self.settings.amo_client_id,
            "client_secret": self.settings.amo_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "redirect_uri": self.settings.amo_redirect_uri,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/oauth2/access_token",
                headers={"Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        token = TokenSet(
            token_type=data["token_type"],
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_in=int(data["expires_in"]),
        )
        self._write_token(token)
        return token

    def _read_refresh_token(self) -> str | None:
        token_file: Path = self.settings.amo_token_file
        if token_file.exists():
            data = json.loads(token_file.read_text())
            refresh_token = data.get("refresh_token")
            if isinstance(refresh_token, str) and refresh_token:
                return refresh_token
        return self.settings.amo_refresh_token

    def _write_token(self, token: TokenSet) -> None:
        token_file = self.settings.amo_token_file
        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(json.dumps(asdict(token), indent=2))
        os.chmod(token_file, 0o600)
