#!/usr/bin/env python3
"""Скачивает кандидатов в сигналы таймера (гонг, колокол, свисток, горн, «палочки», тиканье) с Wikimedia Commons.

Берём только свободные лицензии: public domain, CC0, CC BY (с указанием автора в sounds/LICENSES.md).
CC BY-SA/NC/ND не берём — их условия неудобны для приложения. Лицензию проверяем по метаданным Commons, а не на глаз.
Каждого кандидата обрезаем, срезаем низ (динамик телефона не играет ниже ~400 Гц) и нормализуем по пику.
Результат: sounds/cand/<сигнал>-<n>.mp3 + sounds/candidates.json. Владелец выбирает на слух в Настройках → Звук.
Запуск: GitHub Actions (.github/workflows/sounds.yml) — из песочницы Commons недоступен.
"""
import html
import json
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sounds" / "cand"
API = "https://commons.wikimedia.org/w/api.php"
UA = "boxing-timer-sounds/1.0 (https://github.com/evdokimovbusinez-code/boxing-timer)"
PER_CAT = 4

# Что ищем и сколько секунд оставляем. tick — один щелчок, его играем каждую секунду сами.
CATS = {
    "bell":    {"q": ["boxing bell", "boxing ring bell", "bell ring", "school bell", "hand bell"], "max": 3.0},
    "gong":    {"q": ["gong"], "max": 4.0},
    "whistle": {"q": ["referee whistle", "whistle blow", "whistle"], "max": 1.6},
    "horn":    {"q": ["air horn", "horn blast", "car horn", "horn"], "max": 1.8},
    "clapper": {"q": ["wood block", "woodblock", "claves", "clapper", "drumsticks click"], "max": 1.2},
    "tick":    {"q": ["clock tick", "ticking clock", "metronome", "clock ticking"], "max": 0.14},
}


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data)


def free_license(name):
    n = (name or "").lower()
    if "public domain" in n or n.startswith("pd") or "cc0" in n or "cc-zero" in n:
        return True
    return bool(re.match(r"^cc[ -]by[ -]?\d", n)) and not re.search(r"sa|nc|nd", n)


def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def search(q):
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 30,
        "gsrsearch": q + " filetype:audio", "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl",
    }
    data = get(API + "?" + urllib.parse.urlencode(params))
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        yield {
            "title": p["title"], "url": ii.get("url"), "page": ii.get("descriptionurl"), "size": ii.get("size", 0),
            "license": clean((meta.get("LicenseShortName") or {}).get("value")),
            "licenseUrl": clean((meta.get("LicenseUrl") or {}).get("value")),
            "author": clean((meta.get("Artist") or {}).get("value")),
        }


def ff(*args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-y", "-loglevel", "error", *args], check=True,
                          capture_output=True, text=True)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)


def peak(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.search(r"max_volume: (-?[\d.]+) dB", err)
    return float(m.group(1)) if m else 0.0


def convert(src, dst, cat):
    mx = CATS[cat]["max"]
    with tempfile.TemporaryDirectory() as td:
        a = Path(td) / "a.wav"
        # Без тишины в начале, не длиннее mx, без низа, моно.
        ff("-i", str(src), "-af",
           f"silenceremove=start_periods=1:start_threshold=-38dB,atrim=0:{mx},highpass=f=300,asetpts=N/SR/TB",
           "-ac", "1", "-ar", "44100", str(a))
        d = duration(a)
        if d < (0.04 if cat == "tick" else 0.25):
            raise ValueError(f"слишком короткий ({d:.2f} с)")
        fade = min(0.04 if cat == "tick" else 0.3, d / 3)
        gain = -1.0 - peak(a)  # пик до −1 dBFS: громко, но без клиппинга
        ff("-i", str(a), "-af", f"afade=t=out:st={d - fade:.3f}:d={fade:.3f},volume={gain:.2f}dB",
           "-ac", "1", "-ar", "44100", "-b:a", "96k", str(dst))
        return round(duration(dst), 2)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.mp3"):
        f.unlink()
    found = []
    for cat, cfg in CATS.items():
        seen, n = set(), 0
        for q in cfg["q"]:
            if n >= PER_CAT:
                break
            try:
                results = list(search(q))
            except Exception as e:  # noqa: BLE001
                print(f"{cat}: поиск «{q}» не удался: {e}")
                continue
            for r in results:
                if n >= PER_CAT:
                    break
                if r["title"] in seen or not r["url"] or r["size"] > 15_000_000 or not free_license(r["license"]):
                    continue
                seen.add(r["title"])
                ext = Path(urllib.parse.urlparse(r["url"]).path).suffix or ".bin"
                with tempfile.NamedTemporaryFile(suffix=ext) as tmp:
                    try:
                        tmp.write(get(r["url"], binary=True)); tmp.flush()
                        dst = OUT / f"{cat}-{n + 1}.mp3"
                        dur = convert(Path(tmp.name), dst, cat)
                    except Exception as e:  # noqa: BLE001
                        print(f"{cat}: пропускаю {r['title']}: {e}")
                        continue
                n += 1
                found.append({"id": f"{cat}-{n}", "cat": cat, "duration": dur, "query": q, **r})
                print(f"{cat}-{n}: {r['title']} · {r['license']} · {dur} с")
        if n == 0:
            print(f"{cat}: ничего подходящего")
    (ROOT / "sounds" / "candidates.json").write_text(json.dumps(found, ensure_ascii=False, indent=1), "utf-8")
    print(f"всего кандидатов: {len(found)}")


if __name__ == "__main__":
    main()
