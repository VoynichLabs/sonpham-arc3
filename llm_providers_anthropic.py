"""Anthropic Claude provider — LLM calls via Anthropic API."""

import logging
from typing import Optional

from models import SYSTEM_MSG

logger = logging.getLogger(__name__)

# Claude API key initialization
claude_api_key: Optional[str] = None


def _call_anthropic(model_name: str, prompt: str, image_b64: str | None = None, max_tokens: int = 16384) -> str:
    """Call Anthropic Claude API."""
    import httpx
    api_key = claude_api_key or ""
    content_blocks: list[dict] = []
    if image_b64:
        content_blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
        })
    content_blocks.append({"type": "text", "text": prompt})

    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model_name, "system": SYSTEM_MSG,
            "messages": [{"role": "user", "content": content_blocks}],
            "temperature": 0.3, "max_tokens": max_tokens,
        },
        timeout=90.0,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["content"][0]["text"]
    if data.get("stop_reason") == "max_tokens":
        return {"text": text, "truncated": True}
    return text
