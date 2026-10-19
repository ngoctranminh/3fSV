#!/bin/bash
# Cài server thành dịch vụ launchd của tài khoản đang đăng nhập: tự chạy khi đăng nhập máy,
# tự khởi động lại khi crash. Chạy lại script để cập nhật (ví dụ sau khi đổi bản Node).
#
#   deploy/install-launchd.sh             cài hoặc cập nhật
#   deploy/install-launchd.sh uninstall   gỡ
#   DRY_RUN=1 deploy/install-launchd.sh   chỉ in file plist, không cài
#
# Cấu hình (PORT, BACKUP_DIR, NODE_ENV...) đặt trong .env ở thư mục gốc dự án.
set -euo pipefail

LABEL="com.kho.server"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/kho"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Đã gỡ $LABEL"
  exit 0
fi

# launchd không đọc .zshrc nên không biết nvm; ghi cứng đường dẫn node lúc cài.
# Đổi bản Node bằng nvm thì phải chạy lại script này.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Không tìm thấy node trong PATH" >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 24 )); then
  echo "Cần Node 24 trở lên (đang có $("$NODE_BIN" --version))" >&2
  exit 1
fi

# Đường dẫn có ký tự đặc biệt của XML (&, <) sẽ làm hỏng plist
xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

render_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>--env-file-if-exists=.env</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$PROJECT_DIR")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- Crash liên tục (ví dụ cổng đang bận) thì chờ 10 giây giữa các lần thử -->
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_DIR/server.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG_DIR/server.log")</string>
</dict>
</plist>
EOF
}

if [[ "${DRY_RUN:-}" == "1" ]]; then
  render_plist
  exit 0
fi

mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
render_plist > "$PLIST"
plutil -lint "$PLIST" >/dev/null

# bootout trước để lần cài lại nạp plist mới thay vì báo "đã tồn tại"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Đã cài $LABEL"
echo "  Node:  $NODE_BIN"
echo "  Log:   $LOG_DIR/server.log"
echo "  Xem trạng thái: launchctl print $DOMAIN/$LABEL | grep -E 'state|pid'"
echo "  Khởi động lại:  launchctl kickstart -k $DOMAIN/$LABEL"
