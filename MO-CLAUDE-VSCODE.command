#!/bin/bash
# ============================================================
#   CLAUDE CODE TREN VS CODE (macOS) - POWERED BY NGHIMMO
# ============================================================
# Cach dung:
#   1. Cai extension "Claude Code" trong VS Code (lam 1 lan)
#   2. Dong het cua so VS Code dang chay
#   3. Double-click vao file nay (MO-CLAUDE-VSCODE.command)
#   4. Neu macOS bao "khong mo duoc", chuot phai -> Open -> Open
#   5. Nhap API Key (sk-...) khi duoc hoi
# ============================================================

# UTF-8 cho terminal (dong bo voi ban Windows)
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
export PYTHONUTF8=1

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

clear
echo ""
echo "============================================================"
echo "      CLAUDE CODE TREN VS CODE - POWERED BY NGHIMMO"
echo "============================================================"
echo ""
echo "  Server : https://api.nghimmo.com"
echo "  Check  : https://api.nghimmo.com/check"
echo ""
echo "============================================================"
echo ""

# Nhap API key cua khach
printf "Nhap API Key cua ban (sk-...): "
read APIKEY

if [ -z "$APIKEY" ]; then
    echo ""
    echo -e "${RED}[LOI] Ban chua nhap API Key. Dong cua so va mo lai.${NC}"
    echo ""
    read -n 1 -s -r -p "Nhan phim bat ky de thoat..."
    exit 1
fi

# Tro Claude Code ve server Nghimmo (chi trong phien nay, dong la mat)
export ANTHROPIC_BASE_URL="https://api.nghimmo.com"
export ANTHROPIC_AUTH_TOKEN="$APIKEY"
export ANTHROPIC_MODEL="nghi/claude-opus-4.8"
export ANTHROPIC_DEFAULT_OPUS_MODEL="nghi/claude-opus-5"
export ANTHROPIC_SMALL_FAST_MODEL="nghi/claude-haiku-4.5"
unset ANTHROPIC_API_KEY

echo ""
echo -e "${GREEN}[OK] Da cau hinh xong. Dang mo VS Code...${NC}"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Tim lenh 'code' cua VS Code that su tren macOS
VSCODE=""
if command -v code >/dev/null 2>&1; then
    VSCODE="code"
elif [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    VSCODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
elif [ -x "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    VSCODE="$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
fi

if [ -n "$VSCODE" ]; then
    # Mo VS Code ngay tai thu muc dat file nay (ke thua bien moi truong)
    "$VSCODE" "$PROJECT_DIR"
else
    echo -e "${YELLOW}[CHU Y] Khong tim thay VS Code tren may.${NC}"
    echo "         - Ban can cai VS Code: https://code.visualstudio.com"
    echo "         - Va cai extension 'Claude Code' trong VS Code."
    echo ""
    if [ -d "/Applications/Visual Studio Code.app" ]; then
        open -a "Visual Studio Code" "$PROJECT_DIR"
    fi
fi

echo ""
echo "============================================================"
echo "  VS Code da duoc khoi dong. Cua so nay co the dong."
echo ""
echo "  LUU Y: Bien moi truong chi song trong phien nay."
echo "  Lan sau muon dung lai, chay lai file nay."
echo "============================================================"
echo ""
read -n 1 -s -r -p "Nhan phim bat ky de thoat..."
