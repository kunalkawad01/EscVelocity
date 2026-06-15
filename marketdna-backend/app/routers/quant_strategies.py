from fastapi import APIRouter, HTTPException
from app.services import quant_strategies_service
from app.models.quant_strategies import QuantScanResult

router = APIRouter(prefix="/api/quant", tags=["quant-strategies"])


@router.get("/scan", response_model=QuantScanResult)
def quant_scan():
    """Run all four quant strategy modules in one pass (cached daily)."""
    try:
        return quant_strategies_service.run_scan()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invalidate", response_model=dict)
def invalidate():
    quant_strategies_service.invalidate_cache()
    return {"status": "cache cleared"}
