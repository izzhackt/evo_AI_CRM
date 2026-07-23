from __future__ import annotations

import json
import re
import sqlite3
from hashlib import sha256
from pathlib import Path
from typing import Any

from .schemas import InboundMessage

_TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁёҚқӨөҮүІіҢңҒғҰұҺһ]+")
_FACT_FIELD_RE = re.compile(r"[^0-9a-z_]+")
_FACT_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")
_FACT_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_FACT_URL_RE = re.compile(r"https?://\S+|\bwww\.\S+", re.IGNORECASE)
_ALLOWED_LEAD_FACT_FIELDS = frozenset(
    {
        "name",
        "age",
        "english_level",
        "current_education",
        "target_country",
        "target_degree",
        "intake",
        "budget",
        "preferred_language",
        "city",
        "timeline",
    }
)


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  phone TEXT NOT NULL UNIQUE,
                  amo_lead_id INTEGER,
                  amo_contact_id INTEGER,
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS messages (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
                  provider_message_id TEXT UNIQUE,
                  direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
                  text TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS conversation_controls (
                  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
                  agent_mode INTEGER NOT NULL DEFAULT 1,
                  handoff_reason TEXT,
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS lead_facts (
                  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
                  amo_lead_id INTEGER NOT NULL,
                  field TEXT NOT NULL,
                  value TEXT NOT NULL,
                  source TEXT NOT NULL DEFAULT 'agent',
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  PRIMARY KEY (conversation_id, amo_lead_id, field)
                );

                CREATE TABLE IF NOT EXISTS message_buffers (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
                  session TEXT NOT NULL,
                  phone TEXT NOT NULL,
                  chat_id TEXT NOT NULL,
                  provider_message_id TEXT NOT NULL UNIQUE,
                  text TEXT NOT NULL,
                  push_name TEXT,
                  timestamp INTEGER,
                  not_before TEXT NOT NULL,
                  processor_scheduled INTEGER NOT NULL DEFAULT 0,
                  processed_at TEXT,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS crm_sync_attempts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  idempotency_key TEXT NOT NULL UNIQUE,
                  payload_json TEXT NOT NULL,
                  attempt_count INTEGER NOT NULL DEFAULT 0,
                  last_error TEXT,
                  delivered_at TEXT,
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS knowledge_entries (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  source TEXT NOT NULL,
                  external_id TEXT,
                  question TEXT NOT NULL,
                  answer TEXT NOT NULL,
                  language TEXT,
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  search_text TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  UNIQUE(source, external_id)
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_entries(source);
                CREATE INDEX IF NOT EXISTS idx_message_buffers_due
                  ON message_buffers(processed_at, processor_scheduled, not_before);
                CREATE INDEX IF NOT EXISTS idx_message_buffers_conversation
                  ON message_buffers(conversation_id, session, processed_at);
                CREATE INDEX IF NOT EXISTS idx_lead_facts_field
                  ON lead_facts(field);
                """
            )
            self._migrate_lead_facts(conn)

    def _migrate_lead_facts(self, conn: sqlite3.Connection) -> None:
        columns = conn.execute("PRAGMA table_info(lead_facts)").fetchall()
        if columns and not any(row["name"] == "amo_lead_id" for row in columns):
            conn.execute("DROP TABLE lead_facts")
            conn.executescript(
                """
                CREATE TABLE lead_facts (
                  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
                  amo_lead_id INTEGER NOT NULL,
                  field TEXT NOT NULL,
                  value TEXT NOT NULL,
                  source TEXT NOT NULL DEFAULT 'agent',
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  PRIMARY KEY (conversation_id, amo_lead_id, field)
                );
                CREATE INDEX IF NOT EXISTS idx_lead_facts_field
                  ON lead_facts(field);
                """
            )

    def upsert_conversation(self, phone: str, amo_lead_id: int | None, amo_contact_id: int | None) -> int:
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id FROM conversations WHERE phone = ?",
                (phone,),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE conversations
                    SET amo_lead_id = COALESCE(?, amo_lead_id),
                        amo_contact_id = COALESCE(?, amo_contact_id),
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (amo_lead_id, amo_contact_id, existing["id"]),
                )
                return int(existing["id"])

            cursor = conn.execute(
                """
                INSERT INTO conversations (phone, amo_lead_id, amo_contact_id)
                VALUES (?, ?, ?)
                """,
                (phone, amo_lead_id, amo_contact_id),
            )
            return int(cursor.lastrowid)

    def record_inbound(self, message: InboundMessage, amo_lead_id: int | None, amo_contact_id: int | None) -> bool:
        conversation_id = self.upsert_conversation(message.phone, amo_lead_id, amo_contact_id)
        with self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO messages (conversation_id, provider_message_id, direction, text)
                    VALUES (?, ?, 'in', ?)
                    """,
                    (conversation_id, message.provider_message_id, message.text),
                )
            except sqlite3.IntegrityError:
                return False
        return True

    def set_agent_mode(self, phone: str, enabled: bool, handoff_reason: str | None = None) -> None:
        conversation_id = self.upsert_conversation(phone, None, None)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO conversation_controls (
                  conversation_id, agent_mode, handoff_reason, updated_at
                )
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(conversation_id) DO UPDATE SET
                  agent_mode = excluded.agent_mode,
                  handoff_reason = excluded.handoff_reason,
                  updated_at = datetime('now')
                """,
                (conversation_id, 1 if enabled else 0, handoff_reason),
            )

    def get_conversation_control(self, phone: str) -> dict[str, Any]:
        conversation_id = self.upsert_conversation(phone, None, None)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT agent_mode, handoff_reason, updated_at
                FROM conversation_controls
                WHERE conversation_id = ?
                """,
                (conversation_id,),
            ).fetchone()
        if row is None:
            return {"agent_mode": True, "handoff_reason": None, "updated_at": None}
        return {
            "agent_mode": bool(row["agent_mode"]),
            "handoff_reason": row["handoff_reason"],
            "updated_at": row["updated_at"],
        }

    def upsert_lead_facts(
        self,
        phone: str,
        amo_lead_id: int,
        updates: dict[str, Any],
        source: str = "agent",
    ) -> dict[str, str]:
        conversation_id = self.upsert_conversation(phone, None, None)
        cleaned = self.clean_lead_facts(updates)
        if not cleaned:
            return {}

        source_label = _string(source, 40) or "agent"
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO lead_facts (
                  conversation_id, amo_lead_id, field, value, source, updated_at
                )
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(conversation_id, amo_lead_id, field) DO UPDATE SET
                  value = excluded.value,
                  source = excluded.source,
                  updated_at = datetime('now')
                """,
                [
                    (conversation_id, amo_lead_id, field, value, source_label)
                    for field, value in cleaned.items()
                ],
            )
        return cleaned

    def lead_facts(self, phone: str, amo_lead_id: int) -> dict[str, str]:
        conversation_id = self.upsert_conversation(phone, None, None)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT field, value
                FROM lead_facts
                WHERE conversation_id = ?
                  AND amo_lead_id = ?
                ORDER BY field ASC
                """,
                (conversation_id, amo_lead_id),
            ).fetchall()
        return {str(row["field"]): str(row["value"]) for row in rows}

    def clean_lead_facts(self, updates: dict[str, Any]) -> dict[str, str]:
        return {
            field: value
            for field, value in (_clean_lead_fact(key, raw_value) for key, raw_value in updates.items())
            if field and value
        }

    def enqueue_message_buffer(self, message: InboundMessage, delay_seconds: int) -> bool:
        conversation_id = self.upsert_conversation(message.phone, None, None)
        delay_seconds = max(0, delay_seconds)
        with self._connect() as conn:
            active_before = conn.execute(
                """
                SELECT count(*) AS count
                FROM message_buffers
                WHERE conversation_id = ?
                  AND session = ?
                  AND chat_id = ?
                  AND processed_at IS NULL
                  AND processor_scheduled IN (1, 2)
                """,
                (conversation_id, message.session, message.chat_id),
            ).fetchone()
            should_schedule = int(active_before["count"]) == 0
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO message_buffers (
                  conversation_id,
                  session,
                  phone,
                  chat_id,
                  provider_message_id,
                  text,
                  push_name,
                  timestamp,
                  not_before,
                  processor_scheduled
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)
                """,
                (
                    conversation_id,
                    message.session,
                    message.phone,
                    message.chat_id,
                    message.provider_message_id,
                    message.text,
                    message.push_name,
                    message.timestamp,
                    f"+{delay_seconds} seconds",
                    0,
                ),
            )
            if should_schedule:
                conn.execute(
                    """
                    UPDATE message_buffers
                    SET processor_scheduled = 1,
                        not_before = datetime('now', ?)
                    WHERE conversation_id = ?
                      AND session = ?
                      AND chat_id = ?
                      AND processed_at IS NULL
                    """,
                    (f"+{delay_seconds} seconds", conversation_id, message.session, message.chat_id),
                )
        return should_schedule and cursor.rowcount == 1

    def drain_next_due_buffer(self, phone: str | None = None, limit: int = 50) -> list[InboundMessage]:
        messages = self.claim_next_due_buffer(phone=phone, limit=limit)
        if messages:
            self.mark_buffer_processed([message.provider_message_id for message in messages])
        return messages

    def claim_next_due_buffer(self, phone: str | None = None, limit: int = 50) -> list[InboundMessage]:
        params: list[Any] = []
        phone_clause = ""
        if phone is not None:
            phone_clause = "AND phone = ?"
            params.append(phone)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            group = conn.execute(
                f"""
                SELECT conversation_id, session, chat_id, phone
                FROM message_buffers
                WHERE processed_at IS NULL
                  AND processor_scheduled = 1
                  AND not_before <= datetime('now')
                  {phone_clause}
                ORDER BY not_before ASC, id ASC
                LIMIT 1
                """,
                params,
            ).fetchone()
            if group is None:
                return []
            rows = conn.execute(
                """
                SELECT id, session, provider_message_id, phone, chat_id, text, push_name, timestamp
                FROM message_buffers
                WHERE conversation_id = ?
                  AND session = ?
                  AND chat_id = ?
                  AND processed_at IS NULL
                ORDER BY id ASC
                LIMIT ?
                """,
                (group["conversation_id"], group["session"], group["chat_id"], max(1, limit)),
            ).fetchall()
            if not rows:
                return []
            placeholders = ",".join("?" for _ in rows)
            conn.execute(
                f"""
                UPDATE message_buffers
                SET processor_scheduled = 2
                WHERE id IN ({placeholders})
                """,
                [row["id"] for row in rows],
            )
        return [
            InboundMessage(
                session=row["session"],
                provider_message_id=row["provider_message_id"],
                phone=row["phone"],
                chat_id=row["chat_id"],
                text=row["text"],
                push_name=row["push_name"],
                timestamp=row["timestamp"],
            )
            for row in rows
        ]

    def peek_next_due_buffer(self, phone: str | None = None, limit: int = 50) -> list[InboundMessage]:
        params: list[Any] = []
        phone_clause = ""
        if phone is not None:
            phone_clause = "AND phone = ?"
            params.append(phone)
        with self._connect() as conn:
            group = conn.execute(
                f"""
                SELECT conversation_id, session, chat_id, phone
                FROM message_buffers
                WHERE processed_at IS NULL
                  AND processor_scheduled = 1
                  AND not_before <= datetime('now')
                  {phone_clause}
                ORDER BY not_before ASC, id ASC
                LIMIT 1
                """,
                params,
            ).fetchone()
            if group is None:
                return []
            rows = conn.execute(
                """
                SELECT id, session, provider_message_id, phone, chat_id, text, push_name, timestamp
                FROM message_buffers
                WHERE conversation_id = ?
                  AND session = ?
                  AND chat_id = ?
                  AND processed_at IS NULL
                ORDER BY id ASC
                LIMIT ?
                """,
                (group["conversation_id"], group["session"], group["chat_id"], max(1, limit)),
            ).fetchall()
        return [
            InboundMessage(
                session=row["session"],
                provider_message_id=row["provider_message_id"],
                phone=row["phone"],
                chat_id=row["chat_id"],
                text=row["text"],
                push_name=row["push_name"],
                timestamp=row["timestamp"],
            )
            for row in rows
        ]

    def mark_buffer_processed(self, provider_message_ids: list[str]) -> None:
        if not provider_message_ids:
            return
        placeholders = ",".join("?" for _ in provider_message_ids)
        with self._connect() as conn:
            groups = conn.execute(
                f"""
                SELECT DISTINCT conversation_id, session, chat_id
                FROM message_buffers
                WHERE provider_message_id IN ({placeholders})
                """,
                provider_message_ids,
            ).fetchall()
            conn.execute(
                f"""
                UPDATE message_buffers
                SET processed_at = datetime('now')
                WHERE provider_message_id IN ({placeholders})
                """,
                provider_message_ids,
            )
            for group in groups:
                active = conn.execute(
                    """
                    SELECT id
                    FROM message_buffers
                    WHERE conversation_id = ?
                      AND session = ?
                      AND chat_id = ?
                      AND processed_at IS NULL
                      AND processor_scheduled IN (1, 2)
                    LIMIT 1
                    """,
                    (group["conversation_id"], group["session"], group["chat_id"]),
                ).fetchone()
                if active is not None:
                    continue
                next_pending = conn.execute(
                    """
                    SELECT id
                    FROM message_buffers
                    WHERE conversation_id = ?
                      AND session = ?
                      AND chat_id = ?
                      AND processed_at IS NULL
                    ORDER BY id ASC
                    LIMIT 1
                    """,
                    (group["conversation_id"], group["session"], group["chat_id"]),
                ).fetchone()
                if next_pending is None:
                    continue
                conn.execute(
                    """
                    UPDATE message_buffers
                    SET processor_scheduled = 1,
                        not_before = datetime('now')
                    WHERE id = ?
                    """,
                    (next_pending["id"],),
                )

    def defer_buffer_retry(self, provider_message_ids: list[str], delay_seconds: int) -> None:
        if not provider_message_ids:
            return
        delay_seconds = max(0, delay_seconds)
        placeholders = ",".join("?" for _ in provider_message_ids)
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE message_buffers
                SET processor_scheduled = 1,
                    not_before = datetime('now', ?)
                WHERE provider_message_id IN ({placeholders})
                  AND processed_at IS NULL
                """,
                [f"+{delay_seconds} seconds", *provider_message_ids],
            )

    def has_provider_message(self, provider_message_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM messages WHERE provider_message_id = ?",
                (provider_message_id,),
            ).fetchone()
        return row is not None

    def record_outbound(self, phone: str, text: str, provider_message_id: str | None) -> None:
        conversation_id = self.upsert_conversation(phone, None, None)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO messages (conversation_id, provider_message_id, direction, text)
                VALUES (?, ?, 'out', ?)
                """,
                (conversation_id, provider_message_id, text),
            )

    def history(self, phone: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT m.direction, m.text, m.created_at
                FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE c.phone = ?
                ORDER BY m.id DESC
                LIMIT ?
                """,
                (phone, limit),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def record_crm_sync_success(self, idempotency_key: str, payload_json: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO crm_sync_attempts (
                  idempotency_key, payload_json, attempt_count, delivered_at, updated_at
                )
                VALUES (?, ?, 1, datetime('now'), datetime('now'))
                ON CONFLICT(idempotency_key) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  attempt_count = crm_sync_attempts.attempt_count + 1,
                  last_error = NULL,
                  delivered_at = datetime('now'),
                  updated_at = datetime('now')
                """,
                (idempotency_key, payload_json),
            )

    def record_crm_sync_failure(self, idempotency_key: str, payload_json: str, error: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO crm_sync_attempts (
                  idempotency_key, payload_json, attempt_count, last_error, updated_at
                )
                VALUES (?, ?, 1, ?, datetime('now'))
                ON CONFLICT(idempotency_key) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  attempt_count = crm_sync_attempts.attempt_count + 1,
                  last_error = excluded.last_error,
                  updated_at = datetime('now')
                """,
                (idempotency_key, payload_json, error[:500]),
            )

    def upsert_knowledge_entries(self, entries: list[dict[str, Any]]) -> int:
        cleaned = [_clean_knowledge_entry(entry) for entry in entries]
        valid = [entry for entry in cleaned if entry is not None]
        if not valid:
            return 0
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO knowledge_entries (
                  source, external_id, question, answer, language, tags_json, search_text, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(source, external_id) DO UPDATE SET
                  question = excluded.question,
                  answer = excluded.answer,
                  language = excluded.language,
                  tags_json = excluded.tags_json,
                  search_text = excluded.search_text,
                  updated_at = datetime('now')
                """,
                [
                    (
                        entry["source"],
                        entry["external_id"],
                        entry["question"],
                        entry["answer"],
                        entry["language"],
                        json.dumps(entry["tags"], ensure_ascii=False),
                        _search_text(entry["question"], entry["answer"], entry["tags"]),
                    )
                    for entry in valid
                ],
            )
        return len(valid)

    def search_knowledge(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        tokens = _tokens(query)
        if not tokens:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, source, external_id, question, answer, language, tags_json, search_text, updated_at
                FROM knowledge_entries
                ORDER BY updated_at DESC, id DESC
                LIMIT 500
                """
            ).fetchall()
        scored = []
        for row in rows:
            haystack = set(_tokens(row["search_text"]))
            score = sum(1 for token in tokens if token in haystack)
            if score <= 0:
                continue
            item = dict(row)
            item["tags"] = json.loads(item.pop("tags_json") or "[]")
            item.pop("search_text", None)
            item["score"] = score
            scored.append(item)
        scored.sort(key=lambda item: (-int(item["score"]), -int(item["id"])))
        return scored[: max(1, limit)]

    def knowledge_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT count(*) AS count FROM knowledge_entries").fetchone()
        return int(row["count"])


def _clean_knowledge_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    source = _string(entry.get("source"), 80) or "manual"
    question = _string(entry.get("question"), 2000)
    answer = _string(entry.get("answer"), 4000)
    if not question or not answer:
        return None
    raw_tags = entry.get("tags")
    tags = raw_tags if isinstance(raw_tags, list) else []
    return {
        "source": source,
        "external_id": _string(entry.get("external_id"), 200) or f"{source}:{_stable_key(question, answer)}",
        "question": question,
        "answer": answer,
        "language": _string(entry.get("language"), 16),
        "tags": [tag for tag in (_string(value, 80) for value in tags or []) if tag],
    }


def _search_text(question: str, answer: str, tags: list[str]) -> str:
    return " ".join([question, answer, " ".join(tags)]).lower()


def _stable_key(question: str, answer: str) -> str:
    return sha256(f"{question}\n{answer}".encode("utf-8")).hexdigest()[:24]


def _string(value: object, max_length: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_length]


def _clean_lead_fact(field: object, value: object) -> tuple[str | None, str | None]:
    if not isinstance(field, str):
        return None, None
    normalized_field = _FACT_FIELD_RE.sub("_", field.strip().casefold().replace("-", "_")).strip("_")
    if normalized_field not in _ALLOWED_LEAD_FACT_FIELDS:
        return None, None
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return None, None
    normalized_value = _string(value, 160)
    if not normalized_value:
        return None, None
    if (
        _FACT_EMAIL_RE.search(normalized_value)
        or _FACT_PHONE_RE.search(normalized_value)
        or _FACT_URL_RE.search(normalized_value)
    ):
        return None, None
    return normalized_field, normalized_value


def _tokens(value: str) -> list[str]:
    raw_tokens = [token.lower() for token in _TOKEN_RE.findall(value)]
    expanded = []
    synonyms = {
        "цена": "стоимость",
        "цены": "стоимость",
        "стоит": "стоимость",
        "учебы": "поступление",
        "учеба": "поступление",
        "виза": "visa",
        "visa": "виза",
    }
    for token in raw_tokens:
        expanded.append(token)
        if token in synonyms:
            expanded.append(synonyms[token])
    return expanded
