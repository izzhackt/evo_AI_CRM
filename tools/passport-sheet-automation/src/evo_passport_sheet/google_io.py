from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets"]


@dataclass(frozen=True)
class StudentRow:
    row: int
    name: str
    drive_url: str
    existing_passport: str


def authenticate(credentials_path: Path, token_path: Path):
    if not credentials_path.is_file():
        raise FileNotFoundError(
            f"Google Desktop OAuth credentials not found: {credentials_path}. "
            "Enable Drive and Sheets APIs, create a Desktop OAuth client, and download its JSON file."
        )
    creds = Credentials.from_authorized_user_file(token_path, SCOPES) if token_path.is_file() else None
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES).run_local_server(port=0)
        token_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        token_path.write_text(creds.to_json(), encoding="utf-8")
        token_path.chmod(0o600)
    return creds


class GoogleWorkspace:
    def __init__(self, credentials):
        self.sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False)
        self.drive = build("drive", "v3", credentials=credentials, cache_discovery=False)
        self._api_lock = threading.RLock()

    def student_rows(self, spreadsheet_id: str, sheet: str, start: int, end: int) -> list[StudentRow]:
        with self._api_lock:
            response = self.sheets.spreadsheets().get(
                spreadsheetId=spreadsheet_id,
                ranges=[f"'{sheet}'!A{start}:X{end}"],
                includeGridData=True,
                fields="sheets(data(startRow,rowData(values(formattedValue,hyperlink,userEnteredValue))))",
            ).execute()
        data = response.get("sheets", [{}])[0].get("data", [{}])[0]
        base = int(data.get("startRow", start - 1)) + 1
        rows = []
        for offset, row in enumerate(data.get("rowData", [])):
            values = row.get("values", [])
            name = _formatted(values, 0)
            if name:
                rows.append(StudentRow(base + offset, name, _link(values, 11), _formatted(values, 23)))
        return rows

    def list_passport_candidates(self, folder_url: str) -> list[dict]:
        folder_id = extract_drive_id(folder_url)
        if not folder_id:
            return []
        with self._api_lock:
            files = self.drive.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="files(id,name,mimeType,size)", pageSize=100,
            ).execute().get("files", [])
        supported = {"application/pdf", "image/jpeg", "image/png", "image/heic"}
        files = [item for item in files if item.get("mimeType") in supported]
        return sorted(files, key=lambda item: (not _passport_name(item.get("name", "")), item.get("name", "")))

    def download(self, file_id: str, destination: Path) -> None:
        with self._api_lock:
            request = self.drive.files().get_media(fileId=file_id)
            with destination.open("wb") as handle:
                downloader = MediaIoBaseDownload(handle, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()

    def current_passport(self, spreadsheet_id: str, sheet: str, row: int) -> str:
        return self._cell(spreadsheet_id, f"'{sheet}'!X{row}")

    def verified_write(self, spreadsheet_id: str, sheet: str, row: int, expected: str, value: str) -> None:
        cell = f"'{sheet}'!X{row}"
        existing = self._cell(spreadsheet_id, cell)
        if existing != expected:
            raise RuntimeError(f"X{row} changed since extraction; refusing write")
        if existing and existing != value:
            raise RuntimeError(f"X{row} contains a different value; refusing overwrite")
        with self._api_lock:
            self.sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=cell, valueInputOption="RAW", body={"values": [[value]]}
            ).execute()
        if self._cell(spreadsheet_id, cell) != value:
            raise RuntimeError(f"X{row} write could not be verified")

    def _cell(self, spreadsheet_id: str, cell: str) -> str:
        with self._api_lock:
            values = self.sheets.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=cell).execute().get("values", [])
        return str(values[0][0]).strip() if values and values[0] else ""


def _formatted(values: list[dict], index: int) -> str:
    return str(values[index].get("formattedValue", "")).strip() if len(values) > index else ""


def _link(values: list[dict], index: int) -> str:
    if len(values) <= index:
        return ""
    cell = values[index]
    if cell.get("hyperlink"):
        return cell["hyperlink"]
    formula = cell.get("userEnteredValue", {}).get("formulaValue", "")
    match = re.search(r'https://drive\.google\.com/[^";,]+', formula)
    return match.group(0) if match else _formatted(values, index)


def extract_drive_id(url: str) -> str:
    for pattern in (r"/folders/([A-Za-z0-9_-]+)", r"[?&]id=([A-Za-z0-9_-]+)"):
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return ""


def _passport_name(name: str) -> bool:
    lowered = name.lower()
    return "passport" in lowered or "паспорт" in lowered
