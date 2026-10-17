#!/usr/bin/env python3
"""Озвучивает все фразы таймера голосом Артёма и кладёт mp3 в voices/voicer (ru) и voices/voicer-en (en).

Голос — «Artem Lebedev» из библиотеки ElevenLabs (VOICER_VOICE_ID, по умолчанию rQOBu7YxCDxGiFdTm28w),
через Voicer API (voicer.mat3u.com, документация /docs.json). Библиотечный голос Voicer озвучивает его
клоном в Cartesia; английский — тем же клоном с language=en.

Ключ — в переменной окружения VOICER_API_KEY (в GitHub — секрет). В репозиторий ключ не кладём.
Запуск: локально `VOICER_API_KEY=… python3 tools/gen_voices.py` или GitHub Actions (.github/workflows/voices.yml).
Повторный запуск озвучивает только новые или изменённые фразы (сверяет текст в manifest.json).
"""
import io
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"
VOICER = "https://voicer.mat3u.com"
DEFAULT_VOICE = "rQOBu7YxCDxGiFdTm28w"  # Artem Lebedev — голос владельца
TARGETS = (("ru", "voicer", "Артём"), ("en", "voicer-en", "Artem"))


def phrases(lang):
    out = subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify(require('./voice-phrases.js').list(process.argv[1])))", lang],
        cwd=ROOT,
    )
    return json.loads(out)


def to_mp3(src: Path, dst: Path):
    # Громкость: нормализация до -11 LUFS с потолком -1 dB — громко и без хрипа на динамике телефона.
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                "highpass=f=90,loudnorm=I=-11:TP=-1:LRA=7",
         "-ac", "1", "-ar", "24000", "-b:a", "48k", str(dst)],
        check=True,
    )


def call(key, method, path, body=None, timeout=120):
    req = urllib.request.Request(
        VOICER + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        # Cloudflare сервиса режет стандартный User-Agent urllib (ошибка 1010) — представляемся сами.
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "boxing-timer-voices/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def gen(key, labs_id, clone, lang, vid, label):
    vdir = VOICES_DIR / vid
    vdir.mkdir(parents=True, exist_ok=True)
    m = vdir / "manifest.json"
    old = json.loads(m.read_text("utf-8")) if m.exists() else {"clips": {}}
    same = old.get("voice_id") == labs_id
    items = phrases(lang)
    todo = [it for it in items if not (same and old["clips"].get(it["id"]) == it["text"] and (vdir / f"{it['id']}.mp3").exists())]
    clips = {it["id"]: it["text"] for it in items if it not in todo}
    if todo:
        # Одна задача на все фразы: каждая строка — свой чанк, в ответе ZIP с MP3 на каждый (0000.mp3, 0001.mp3…).
        st, b = call(key, "POST", "/v2/tasks", {
            "text": "\n".join(it["text"] for it in todo), "voice_id": clone, "engine": "cartesia", "language": lang,
            "split_type": "paragraphs", "split_output": True,
        })
        if st != 202:
            raise RuntimeError(f"создание задачи: {st} {b[:300]!r}")
        task = json.loads(b)
        if task["chunks_count"] != len(todo):
            raise RuntimeError(f"чанков {task['chunks_count']}, а фраз {len(todo)}")
        tid = task["task_id"]
        print(f"{vid}: задача {tid}, {task['charged_characters']} символов", flush=True)
        while True:
            st, b = call(key, "GET", f"/v2/tasks/{tid}")
            t = json.loads(b)
            if t["status"] in ("pending", "processing", "pending_confirmation"):
                time.sleep(3)
                continue
            break
        if t["status"] != "completed":
            raise RuntimeError(f"задача {t['status']}: {t.get('error')} {t.get('blocked_chunks')}")
        st, z = call(key, "GET", f"/v2/tasks/{tid}/download", timeout=600)
        if st != 200:
            raise RuntimeError(f"скачивание: {st}")
        zf = zipfile.ZipFile(io.BytesIO(z))
        names = sorted(n for n in zf.namelist() if n.endswith(".mp3"))
        if len(names) != len(todo):
            raise RuntimeError(f"в архиве {len(names)} файлов, а фраз {len(todo)}")
        for it, n in zip(todo, names):
            with tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
                tmp.write(zf.read(n)); tmp.flush()
                to_mp3(Path(tmp.name), vdir / f"{it['id']}.mp3")
            clips[it["id"]] = it["text"]
    # Фразы, которых больше нет в списке, — удаляем, чтобы не таскать лишнее.
    for f in vdir.glob("*.mp3"):
        if f.stem not in clips:
            f.unlink()
    data = {"label": label, "engine": "voicer", "lang": lang, "voice_id": labs_id, "clips": clips}
    m.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    print(f"{vid}: {len(todo)} new, {len(clips)} total", flush=True)


if __name__ == "__main__":
    key = os.environ.get("VOICER_API_KEY")
    if not key:
        print("VOICER_API_KEY не задан — пропускаю озвучку")
        raise SystemExit(0)
    labs_id = os.environ.get("VOICER_VOICE_ID") or DEFAULT_VOICE
    st, b = call(key, "GET", f"/v2/voices/cartesia/from-labs/{labs_id}")
    info = json.loads(b) if st == 200 else {}
    clone = (info.get("mine") or info.get("catalog") or {}).get("voice_id") or labs_id
    for lang, vid, label in TARGETS:
        gen(key, labs_id, clone, lang, vid, label)
