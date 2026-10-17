#!/bin/sh
# Сайт лежит в корне репо и собирать его не нужно. Для приложения копируем в www/ только то, что нужно таймеру
# (без tests/, tools/, ios/, node_modules/) — Capacitor кладёт www/ внутрь приложения.
set -e
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www/voices
cp index.html style.css app.js i18n.js parse.js detect.js programs.js voice-phrases.js stomp-worklet.js manifest.webmanifest www/
cp -R icons media www/
cp -R voices/voicer voices/voicer-en www/voices/
# Записанные сигналы (без кандидатов из sounds/cand — они только для выбора на слух)
mkdir -p www/sounds && cp sounds/*.mp3 www/sounds/ 2>/dev/null || true
