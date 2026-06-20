from fastapi import APIRouter, HTTPException
from app.models.randomness import RandomnessReport
from app.services import randomness_service

router = APIRouter(prefix="/api/randomness", tags=["randomness"])


@router.get("/{symbol}", response_model=RandomnessReport, response_model_exclude_none=True)
def get_randomness_report(symbol: str):
    try:
        return randomness_service.get_report(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{symbol}/invalidate")
def invalidate_report(symbol: str):
    randomness_service.invalidate(symbol.upper())
    return {"status": "invalidated"}
