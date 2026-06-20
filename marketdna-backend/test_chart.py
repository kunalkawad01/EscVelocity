import sys
sys.path.insert(0, ".")
from app.services import live_trading_service

try:
    result = live_trading_service.get_stock_chart("HDFCBANK")
    if result:
        bars = result["bars"]
        print("OK - bars:", len(bars), "first:", bars[0]["t"], "last:", bars[-1]["t"])
        print("Sample bar:", bars[-1])
        for tf, r in result["ranks_tf"].items():
            print(tf, r["return_pct"], "#" + str(r["universe_rank"]) + "/" + str(r["universe_total"]))
    else:
        print("No data returned")
except Exception as e:
    import traceback
    traceback.print_exc()
