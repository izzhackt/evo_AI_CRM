FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

RUN pip install --no-cache-dir uv==0.11.7

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY examples ./examples

RUN uv sync --locked --no-dev --no-cache

EXPOSE 8000

CMD ["uvicorn", "evo_lead_agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
