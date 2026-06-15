# Start MarketDNA backend + frontend
Write-Host "Starting MarketDNA Backend (port 8000)..." -ForegroundColor Cyan
Start-Process -FilePath "marketdna-backend\.venv\Scripts\python.exe" `
  -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload" `
  -WorkingDirectory (Join-Path $PSScriptRoot "marketdna-backend") `
  -NoNewWindow

Start-Sleep -Seconds 3

Write-Host "Starting MarketDNA Frontend (port 5173)..." -ForegroundColor Cyan
Start-Process -FilePath "cmd" `
  -ArgumentList "/c npm run dev -- --host 127.0.0.1" `
  -WorkingDirectory (Join-Path $PSScriptRoot "marketdna-web") `
  -NoNewWindow

Write-Host ""
Write-Host "MarketDNA is starting up..." -ForegroundColor Green
Write-Host "  API:      http://localhost:8000" -ForegroundColor White
Write-Host "  App:      http://localhost:5173" -ForegroundColor White
Write-Host "  API Docs: http://localhost:8000/docs" -ForegroundColor White
