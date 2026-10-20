"""Minimal NeMo Guardrails-compatible sidecar for the agent (S5.2).

Contract:
    POST /check  {"stage": "input"|"output", "text": "..."}
              ->  {"allowed": bool, "reason": str}

The agent fails open on transport errors, so this service is a soft guardrail.
Run with: python server.py (or `pnpm dev:guardrails` from the repo root).
"""

import os
import re

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="furmx-guardrails-sidecar")

# Prompt-injection / jailbreak signals in the user's latest message.
INPUT_BLOCK = re.compile(
    r"忽略(以上|之前|前面|所有)的?(指令|提示|规则|要求)"
    r"|无视(以上|之前|前面|所有)的?(指令|提示|规则|要求)"
    r"|(忽略|无视).{0,10}(指令|规则)"
    r"|ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)"
    r"|disregard\s+(all\s+)?(previous|prior|above)"
    r"|reveal\s+(the\s+)?system\s+prompt|系统提示词?|开发者模式"
    r"|jailbreak|越狱|DAN\s*模式",
    re.IGNORECASE,
)

# Secret leakage / credential exposure in model output.
OUTPUT_BLOCK = re.compile(
    r"sk-[A-Za-z0-9_-]{20,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY"
    r"|mysql://[^\s:]+:[^\s@]+@"
    r"|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    re.IGNORECASE,
)


class CheckRequest(BaseModel):
    stage: str
    text: str = ""


class CheckResponse(BaseModel):
    allowed: bool
    reason: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/check", response_model=CheckResponse)
def check(req: CheckRequest) -> CheckResponse:
    pattern = OUTPUT_BLOCK if req.stage == "output" else INPUT_BLOCK
    match = pattern.search(req.text or "")
    if match:
        reason = f"blocked:{match.group(0)}"
        print(f"[guardrails] stage={req.stage} allowed=False reason={reason}", flush=True)
        return CheckResponse(allowed=False, reason=reason)

    print(f"[guardrails] stage={req.stage} allowed=True", flush=True)
    return CheckResponse(allowed=True)


if __name__ == "__main__":
    port = int(os.getenv("GUARDRAILS_PORT", "8190"))
    uvicorn.run(app, host="127.0.0.1", port=port)
