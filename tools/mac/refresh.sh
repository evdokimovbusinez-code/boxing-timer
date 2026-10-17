#!/bin/bash
# Продлевает приложение «Раунды» на iPhone с бесплатным Apple ID: подпись Apple живёт 7 дней.
# Запускает launchd раз в час (ставит tools/mac/setup.sh). Почти всегда сразу выходит, а собирает и ставит, только если:
# - подпись истекает меньше чем через сутки (или уже истекла) — пересобрать со свежим профилем и поставить по Wi-Fi;
# - в main есть обновления — поставить ночью (2–6 ч), чтобы не перезапустить таймер посреди тренировки.
# Ручной запуск: bash tools/mac/refresh.sh force — собрать и поставить прямо сейчас.
# Журнал: ~/Library/Logs/boxing-timer-refresh.log

# Всё внутри функции: git reset ниже может поменять этот файл, а bash читает скрипт по ходу выполнения.
main() {
  set -u
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  local REPO DATA CONF LOG
  REPO="$(cd "$(dirname "$0")/../.." && pwd)"
  DATA="$HOME/Library/Application Support/boxing-timer"
  CONF="$DATA/config"
  LOG="$HOME/Library/Logs/boxing-timer-refresh.log"
  [ -n "${VERBOSE:-}" ] || exec >>"$LOG" 2>&1
  [ -f "$CONF" ] || { echo "нет $CONF — сначала запусти tools/mac/setup.sh"; return 1; }
  . "$CONF" # TEAM, BUNDLE, DEVICE
  cd "$REPO" || return 1

  local now exp hold need="" hour
  now=$(date +%s)
  exp=$(cat "$DATA/expires" 2>/dev/null || echo 0)
  hold=$(cat "$DATA/hold-until" 2>/dev/null || echo 0)
  hour=$((10#$(date +%H)))
  [ "${1:-}" = force ] && need=force
  # Apple до истечения может отдавать тот же профиль — тогда ждём, пока истечёт (hold-until), и пробуем снова.
  [ -z "$need" ] && [ $((exp - now)) -lt 86400 ] && [ "$now" -ge "$hold" ] && need=renew
  if [ -z "$need" ] && [ "$hour" -ge 2 ] && [ "$hour" -lt 6 ] && git fetch -q origin main 2>/dev/null &&
     [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then need=update; fi
  [ -n "$need" ] || return 0

  echo "=== $(date '+%F %T') $need (подпись до $(date -r "$exp" '+%F %T' 2>/dev/null || echo '?'))"
  git fetch -q origin main && git reset -q --hard origin/main || echo "git: не обновился, собираю что есть"
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci --no-audit --no-fund || return 1; fi
  npm run -s sync >/dev/null || { notify "Не собралось (npm). Журнал: ~/Library/Logs/boxing-timer-refresh.log"; return 1; }

  # Удаляем закэшированный профиль этого приложения — Xcode попросит у Apple новый (с новыми 7 днями).
  [ "$need" = update ] || drop_profiles "$BUNDLE"

  local APP="build/mac/Build/Products/Release-iphoneos/App.app"
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath build/mac \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
    build -quiet || { [ "$need" = update ] || notify "Не собралось в Xcode. Журнал: ~/Library/Logs/boxing-timer-refresh.log"; return 1; }

  local newexp
  newexp=$(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null | plutil -extract ExpirationDate raw -o - - 2>/dev/null)
  newexp=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$newexp" +%s 2>/dev/null || echo 0)

  if ! xcrun devicectl device install app --device "$DEVICE" "$APP"; then
    # Телефон не рядом или не в той же Wi-Fi — попробуем через час. Беспокоим, только когда подпись вот-вот кончится.
    [ "$need" = update ] || [ $((exp - now)) -gt 21600 ] || notify "Не достал до iPhone по Wi-Fi. Он рядом и в той же сети? Повторю через час."
    return 1
  fi

  mkdir -p "$DATA"
  echo "$newexp" > "$DATA/expires"
  if [ "$need" != update ] && [ $((newexp - now)) -lt 86400 ]; then
    echo "$((newexp + 120))" > "$DATA/hold-until" # Apple отдала старый профиль — продлим сразу после его истечения
  else
    rm -f "$DATA/hold-until"
  fi
  echo "готово: подпись до $(date -r "$newexp" '+%F %T')"
  [ "$need" = update ] || notify "Продлено до $(date -r "$newexp" '+%d.%m %H:%M')"
}

notify() { osascript -e "display notification \"$1\" with title \"Раунды\"" >/dev/null 2>&1; echo "$1"; }

drop_profiles() {
  local d f id
  for d in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
    for f in "$d"/*.mobileprovision; do
      [ -f "$f" ] || continue
      id=$(security cms -D -i "$f" 2>/dev/null | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null)
      case "$id" in *".$1") rm -f "$f";; esac
    done
  done
}

main "$@"
exit $?
