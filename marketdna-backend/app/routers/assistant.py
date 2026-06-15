"""AI Research Assistant endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.ai_assistant import answer_question

router = APIRouter(prefix="/api/stock", tags=["assistant"])


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str
    queries: list[dict]


@router.post("/{symbol}/chat", response_model=ChatResponse)
async def chat(symbol: str, body: ChatRequest) -> ChatResponse:
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    result = await answer_question(symbol.upper(), body.question)
    return ChatResponse(**result)
