#!/bin/bash
# Один раз на Mac: включает автопродление приложения «Раунды» на iPhone (tools/mac/refresh.sh раз в час).
# Перед этим в Xcode: выбран Team (Personal Team) и приложение один раз поставлено кнопкой ▶ — так iPhone
# зарегистрирован, а Xcode знает твой Apple ID. Запуск: cd ~/boxing-timer && bash tools/mac/setup.sh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$HOME/Library/Application Support/boxing-timer"
LABEL="io.github.evdokimovbusinez.boxingtimer.refresh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cd "$REPO"

fail() { echo; echo "✗ $1"; exit 1; }
command -v xcodebuild >/dev/null || fail "Нет Xcode. Поставь его из App Store и открой один раз."
command -v npm >/dev/null || fail "Нет Node.js. Поставь версию LTS с nodejs.org."
case "$REPO" in "$HOME/Documents"*|"$HOME/Desktop"*|"$HOME/Downloads"*)
  fail "Папка $REPO — в Документах/Рабочем столе/Загрузках, туда macOS не пускает фоновые задачи. Склонируй в домашнюю папку: cd ~ && git clone …";;
esac

# Team и идентификатор — из проекта, где их выставил Xcode при первом запуске.
PBX="ios/App/App.xcodeproj/project.pbxproj"
TEAM=$(sed -n 's/.*DEVELOPMENT_TEAM = \([A-Z0-9]*\);.*/\1/p' "$PBX" | head -n 1)
BUNDLE=$(sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER = \([^;]*\);.*/\1/p' "$PBX" | head -n 1)
[ -n "$TEAM" ] || fail "В Xcode не выбран Team: App → Signing & Capabilities → Team → «(Personal Team)», потом один раз ▶."

# iPhone — из списка устройств Xcode (должен быть сопряжён: первый запуск по кабелю).
TMP=$(mktemp)
xcrun devicectl list devices --json-output "$TMP" >/dev/null 2>&1 || true
DEVICE=$(/usr/bin/python3 - "$TMP" <<'EOF'
import json, sys
try:
    devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devs = []
for d in devs:
    if d.get("hardwareProperties", {}).get("deviceType") == "iPhone":
        print(d["identifier"]); break
EOF
)
rm -f "$TMP"
[ -n "$DEVICE" ] || fail "Не вижу iPhone. Подключи кабелем, разблокируй, нажми «Доверять» и один раз поставь приложение кнопкой ▶ в Xcode."

mkdir -p "$DATA" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
printf 'TEAM=%s\nBUNDLE=%s\nDEVICE=%s\n' "$TEAM" "$BUNDLE" "$DEVICE" > "$DATA/config"
rm -f "$DATA/expires" "$DATA/hold-until"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/tools/mac/refresh.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Team: $TEAM · приложение: $BUNDLE · iPhone: $DEVICE"
echo "Проверяю: собираю и ставлю на iPhone по Wi-Fi (пара минут; если macOS спросит доступ к связке ключей — «Разрешать всегда»)…"
if VERBOSE=1 bash tools/mac/refresh.sh force; then
  echo
  echo "✓ Готово. Дальше Mac сам продлевает приложение, пока он включён и iPhone в той же Wi-Fi."
  echo "  Журнал: ~/Library/Logs/boxing-timer-refresh.log · выключить: launchctl bootout gui/\$(id -u)/$LABEL"
else
  fail "Автопродление включено, но проверка не прошла — пришли Claude текст выше."
fi
