#!/bin/bash
# MarketDNA — EC2 Amazon Linux 2023 deployment script
# Run once after git clone: bash deploy-ec2.sh
# Re-run anytime to update the app after a git pull.

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_DIR/marketdna-backend"
DATA_DIR="$REPO_DIR/marketdna-data"
WEB_DIR="$REPO_DIR/marketdna-web"
USER="$(whoami)"

echo ""
echo "========================================"
echo "  MarketDNA EC2 Deployment"
echo "  Repo : $REPO_DIR"
echo "  User : $USER"
echo "========================================"
echo ""

# ── 1. System dependencies ───────────────────────────────────────────────────
echo "[1/7] Installing system dependencies..."
sudo dnf update -y -q
sudo dnf install -y -q python3.12 python3.12-devel build-essential nginx git

# Node.js 18 (skip if already installed)
if ! command -v node &>/dev/null; then
    echo "       Installing Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash - -q
    sudo dnf install -y -q nodejs
fi
echo "       Python $(python3.12 --version)  Node $(node --version)  npm $(npm --version)"

# ── 2. .env check ────────────────────────────────────────────────────────────
echo ""
echo "[2/7] Checking .env file..."
ENV_FILE="$DATA_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo ""
    echo "  ERROR: $ENV_FILE not found."
    echo "  Create it with your Kite credentials before running this script:"
    echo ""
    echo "    KITE_API_KEY=your_key"
    echo "    KITE_API_SECRET=your_secret"
    echo "    KITE_ACCESS_TOKEN=your_daily_token"
    echo ""
    exit 1
fi
echo "       .env found at $ENV_FILE"

# ── 3. Backend venv ──────────────────────────────────────────────────────────
echo ""
echo "[3/7] Setting up backend virtualenv..."
cd "$BACKEND_DIR"
if [ ! -d ".venv" ]; then
    python3.12 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
deactivate
echo "       Backend venv ready"

# ── 4. Data venv ─────────────────────────────────────────────────────────────
echo ""
echo "[4/7] Setting up marketdna-data virtualenv..."
cd "$DATA_DIR"
if [ ! -d ".venv" ]; then
    python3.12 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "       Registering DuckDB views..."
python -m warehouse.register_views
deactivate
echo "       Data venv ready"

# ── 5. Frontend build ─────────────────────────────────────────────────────────
echo ""
echo "[5/7] Building frontend..."
cd "$WEB_DIR"
npm install --silent
npm run build
echo "       Frontend built -> $WEB_DIR/dist"

# ── 6. Nginx config ───────────────────────────────────────────────────────────
echo ""
echo "[6/7] Configuring nginx..."
sudo tee /etc/nginx/conf.d/marketdna.conf > /dev/null <<NGINX
server {
    listen 80;
    server_name _;

    root $WEB_DIR/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 120s;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
    }
}
NGINX

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "       Nginx configured and running"

# ── 7. Systemd service ────────────────────────────────────────────────────────
echo ""
echo "[7/7] Installing systemd service..."
sudo tee /etc/systemd/system/marketdna-backend.service > /dev/null <<SERVICE
[Unit]
Description=MarketDNA FastAPI Backend
After=network.target

[Service]
User=$USER
WorkingDirectory=$BACKEND_DIR
Environment="PATH=$BACKEND_DIR/.venv/bin"
ExecStart=$BACKEND_DIR/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable marketdna-backend
sudo systemctl restart marketdna-backend

echo ""
echo "========================================"
echo "  Deployment complete!"
echo ""
echo "  App  : http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo '<EC2_IP>')"
echo "  API  : http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo '<EC2_IP>')/docs"
echo ""
echo "  Backend status : sudo systemctl status marketdna-backend"
echo "  Backend logs   : sudo journalctl -u marketdna-backend -f"
echo ""
echo "  REMINDER: Kite access token expires daily."
echo "  Update $ENV_FILE then run:"
echo "    sudo systemctl restart marketdna-backend"
echo "========================================"
