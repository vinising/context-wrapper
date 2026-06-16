#!/usr/bin/env python3
"""
Bridge script for local MLX inference.

Input (stdin JSON):
{
  "modelId": "mlx-community/gemma-3-4b-it-4bit",
  "system": "...",
  "prompt": "..."
}

Output (stdout text):
  refined prompt text
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Tuple

_MODEL_CACHE: Dict[str, Tuple[Any, Any]] = {}


def _load_model(model_id: str) -> Tuple[Any, Any]:
    if model_id in _MODEL_CACHE:
        return _MODEL_CACHE[model_id]

    try:
        from mlx_lm import load  # type: ignore
    except Exception as exc:  # pragma: no cover - import failure handling
        raise RuntimeError(
            "mlx_lm is not installed. Install with: pip install mlx-lm"
        ) from exc

    model, tokenizer = load(model_id)
    _MODEL_CACHE[model_id] = (model, tokenizer)
    return model, tokenizer


def _build_prompt(tokenizer: Any, system_prompt: str, user_prompt: str) -> str:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    return f"System: {system_prompt}\nUser: {user_prompt}\nAssistant:"


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("Empty stdin payload for MLX bridge.", file=sys.stderr)
        return 2

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON payload: {exc}", file=sys.stderr)
        return 2

    model_id = str(payload.get("modelId") or "").strip()
    system_prompt = str(payload.get("system") or "").strip()
    user_prompt = str(payload.get("prompt") or "").strip()

    if not model_id or not user_prompt:
        print("Payload must include non-empty modelId and prompt.", file=sys.stderr)
        return 2

    try:
        model, tokenizer = _load_model(model_id)
        prompt = _build_prompt(tokenizer, system_prompt, user_prompt)

        max_tokens = int(os.getenv("WRAPPER_MLX_MAX_TOKENS", "256"))
        temperature = float(os.getenv("WRAPPER_MLX_TEMPERATURE", "0.2"))

        from mlx_lm import generate  # type: ignore

        output = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            temp=temperature,
            verbose=False,
        )
        text = str(output).strip()
        if not text:
            print("MLX returned empty output.", file=sys.stderr)
            return 3

        print(text)
        return 0
    except Exception as exc:  # pragma: no cover - runtime failure handling
        print(f"MLX bridge failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
