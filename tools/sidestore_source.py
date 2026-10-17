#!/usr/bin/env python3
"""Источник для SideStore/AltStore (apps.json): SideStore по нему видит приложение «Раунды» и его обновления.

Запускается в .github/workflows/ios.yml после сборки. Аргументы: версия, номер сборки, путь к .ipa, ссылка на .ipa.
Сам файл кладётся в GitHub Release рядом с .ipa; в SideStore добавляется ссылка на последний:
https://github.com/evdokimovbusinez-code/boxing-timer/releases/latest/download/apps.json
"""
import datetime
import json
import os
import sys

REPO = "evdokimovbusinez-code/boxing-timer"
version, build, ipa, url = sys.argv[1:5]

print(json.dumps({
    "name": "Раунды — боксёрский таймер",
    "identifier": "io.github.evdokimovbusinez.boxingtimer.source",
    "sourceURL": f"https://github.com/{REPO}/releases/latest/download/apps.json",
    "apps": [{
        "name": "Раунды",
        "bundleIdentifier": "io.github.evdokimovbusinez.boxingtimer",
        "developerName": "evdokimovbusinez-code",
        "subtitle": "Таймер раундов для спаррингов",
        "localizedDescription": "Огромные цифры, всегда горизонтально, экран не гаснет. Голос Артёма, сигналы, старт и пауза двойным топотом. Работает офлайн.",
        "iconURL": f"https://raw.githubusercontent.com/{REPO}/main/icons/icon-512.png",
        "tintColor": "#cf1530",
        "versions": [{
            "version": version,
            "buildVersion": build,
            "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "localizedDescription": f"Сборка {build} из main.",
            "downloadURL": url,
            "size": os.path.getsize(ipa),
            "minOSVersion": "15.0",
        }],
        "appPermissions": {"entitlements": [], "privacy": {
            "NSMicrophoneUsageDescription": "Микрофон слышит двойной топот — старт и пауза без рук.",
            "NSMotionUsageDescription": "Датчик движения чувствует топот.",
            "NSSpeechRecognitionUsageDescription": "Голосовые команды и настройка голосом.",
        }},
    }],
    "news": [],
}, ensure_ascii=False, indent=1))
