#!/usr/bin/env python3
"""Озвучивает все фразы таймера нейросетевыми голосами и кладёт mp3 в voices/<голос>/.

Запускается в GitHub Actions (.github/workflows/voices.yml), где есть интернет для скачивания моделей.

Голоса (у каждого свой язык — ru или en, фразы берутся из voice-phrases.js на этом языке):
  * Piper (бесплатно, офлайн-модели): ru — dmitri, ruslan, denis, irina; en — en-ryan, en-joe, en-alan, en-amy.
  * ElevenLabs (по желанию): если задан секрет ELEVENLABS_API_KEY, добавляются «eleven» (ru) и «eleven-en» (en).
    Голос выбирается переменной ELEVENLABS_VOICE_ID.
  * Voicer (voicer.mat3u.com): если задан секрет VOICER_API_KEY — «voicer» (ru) и «voicer-en» (en).
    Голос — VOICER_VOICE_ID (ID голоса ElevenLabs, по умолчанию Artem Lebedev), озвучка через его клон в Cartesia.

Повторный запуск озвучивает только новые или изменённые фразы (сверяет текст в manifest.json).
"""
import io
import json
import os
import time
import zipfile
import subprocess
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"
MODELS_DIR = Path(os.environ.get("PIPER_MODELS", "/tmp/piper-models"))

PIPER_VOICES = {
    # id: (модель, подпись в настройках, темп: <1 быстрее, язык фраз)
    "dmitri": ("ru_RU-dmitri-medium", "Дмитрий", 0.9, "ru"),
    "ruslan": ("ru_RU-ruslan-medium", "Руслан", 0.9, "ru"),
    "denis": ("ru_RU-denis-medium", "Денис", 0.9, "ru"),
    "irina": ("ru_RU-irina-medium", "Ирина", 0.92, "ru"),
    "en-ryan": ("en_US-ryan-medium", "Ryan", 0.9, "en"),
    "en-joe": ("en_US-joe-medium", "Joe", 0.9, "en"),
    "en-alan": ("en_GB-alan-medium", "Alan", 0.9, "en"),
    "en-amy": ("en_US-amy-medium", "Amy", 0.92, "en"),
}
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{loc}/{name}/medium/{model}{ext}?download=true"


def phrases(lang="ru"):
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


def load_manifest(vdir: Path):
    m = vdir / "manifest.json"
    if m.exists():
        return json.loads(m.read_text("utf-8"))
    return {"clips": {}}


def save_manifest(vdir: Path, label: str, engine: str, clips: dict, lang: str = "ru"):
    data = {"label": label, "engine": engine, "lang": lang, "clips": clips}
    (vdir / "manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")


def gen_piper():
    from piper import PiperVoice, SynthesisConfig

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for vid, (model, label, scale, lang) in PIPER_VOICES.items():
        # Один голос не скачался — остальные (и русские) всё равно озвучиваются.
        try:
            gen_piper_voice(PiperVoice, SynthesisConfig, vid, model, label, scale, lang)
        except Exception as e:  # noqa: BLE001
            print(f"{vid}: ОШИБКА, пропускаю — {e}", flush=True)


def gen_piper_voice(PiperVoice, SynthesisConfig, vid, model, label, scale, lang):
    items = phrases(lang)
    loc = model.split("-")[0]  # ru_RU, en_US, en_GB
    name = model.split("-")[1]
    onnx = MODELS_DIR / f"{model}.onnx"
    for ext in (".onnx", ".onnx.json"):
        path = MODELS_DIR / f"{model}{ext}"
        if not path.exists():
            url = HF.format(lang=loc.split("_")[0], loc=loc, name=name, model=model, ext=ext)
            print("download", url, flush=True)
            urllib.request.urlretrieve(url, path)
    voice = PiperVoice.load(onnx)
    cfg = SynthesisConfig(length_scale=scale)
    vdir = VOICES_DIR / vid
    vdir.mkdir(parents=True, exist_ok=True)
    old = load_manifest(vdir)["clips"]
    clips = {}
    made = 0
    for it in items:
        mp3 = vdir / f"{it['id']}.mp3"
        if old.get(it["id"]) == it["text"] and mp3.exists():
            clips[it["id"]] = it["text"]
            continue
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            with wave.open(tmp.name, "wb") as wf:
                voice.synthesize_wav(it["text"], wf, syn_config=cfg)
            to_mp3(Path(tmp.name), mp3)
        clips[it["id"]] = it["text"]
        made += 1
    save_manifest(vdir, label, "piper", clips, lang)
    print(f"{vid}: {made} new, {len(clips)} total", flush=True)


def gen_eleven():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        print("ElevenLabs: секрет ELEVENLABS_API_KEY не задан — пропускаю")
        return
    for lang, vid in (("ru", "eleven"), ("en", "eleven-en")):
        gen_eleven_lang(key, lang, vid, phrases(lang))


def gen_eleven_lang(key, lang, vid, items):
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID") or "pNInz6obpgDQGcFmaJgB"
    vdir = VOICES_DIR / vid
    vdir.mkdir(parents=True, exist_ok=True)
    old = load_manifest(vdir)
    clips = {}
    made = 0
    same_voice = old.get("voice_id") == voice_id
    for it in items:
        mp3 = vdir / f"{it['id']}.mp3"
        if same_voice and old["clips"].get(it["id"]) == it["text"] and mp3.exists():
            clips[it["id"]] = it["text"]
            continue
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
            data=json.dumps({
                "text": it["text"],
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.35},
            }).encode(),
            headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        )
        with urllib.request.urlopen(req) as r, tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
            tmp.write(r.read()); tmp.flush()
            to_mp3(Path(tmp.name), mp3)
        clips[it["id"]] = it["text"]
        made += 1
    save_manifest(vdir, "ElevenLabs", "elevenlabs", clips, lang)
    data = json.loads((vdir / "manifest.json").read_text("utf-8"))
    data["voice_id"] = voice_id
    (vdir / "manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    print(f"{vid}: {made} new, {len(clips)} total")


VOICER = "https://voicer.mat3u.com"
VOICER_DEFAULT_VOICE = "rQOBu7YxCDxGiFdTm28w"  # Artem Lebedev — голос владельца


def voicer_call(key, method, path, body=None, timeout=120):
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


def gen_voicer():
    key = os.environ.get("VOICER_API_KEY")
    if not key:
        print("Voicer: секрет VOICER_API_KEY не задан — пропускаю")
        return
    labs_id = os.environ.get("VOICER_VOICE_ID") or VOICER_DEFAULT_VOICE
    # Голос из библиотеки ElevenLabs озвучивается клоном в Cartesia; клоном же — и на английском (language=en).
    st, b = voicer_call(key, "GET", f"/v2/voices/cartesia/from-labs/{labs_id}")
    info = json.loads(b) if st == 200 else {}
    clone = (info.get("mine") or info.get("catalog") or {}).get("voice_id") or labs_id
    name = info.get("name", "Voicer").split(" - ")[0]
    for lang, vid in (("ru", "voicer"), ("en", "voicer-en")):
        try:
            gen_voicer_lang(key, labs_id, clone, name, lang, vid, phrases(lang))
        except Exception as e:  # noqa: BLE001
            print(f"{vid}: ОШИБКА, пропускаю — {e}", flush=True)


def gen_voicer_lang(key, labs_id, clone, name, lang, vid, items):
    vdir = VOICES_DIR / vid
    vdir.mkdir(parents=True, exist_ok=True)
    old = load_manifest(vdir)
    same = old.get("voice_id") == labs_id
    todo = [it for it in items if not (same and old["clips"].get(it["id"]) == it["text"] and (vdir / f"{it['id']}.mp3").exists())]
    clips = {it["id"]: it["text"] for it in items if it not in todo}
    if todo:
        # Одна задача на все фразы: каждая строка — свой чанк, в ответе ZIP с MP3 на каждый (0000.mp3, 0001.mp3…).
        st, b = voicer_call(key, "POST", "/v2/tasks", {
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
            st, b = voicer_call(key, "GET", f"/v2/tasks/{tid}")
            t = json.loads(b)
            if t["status"] in ("pending", "processing", "pending_confirmation"):
                time.sleep(3)
                continue
            break
        if t["status"] != "completed":
            raise RuntimeError(f"задача {t['status']}: {t.get('error')} {t.get('blocked_chunks')}")
        st, z = voicer_call(key, "GET", f"/v2/tasks/{tid}/download", timeout=600)
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
    save_manifest(vdir, name if labs_id != VOICER_DEFAULT_VOICE else ("Артём" if lang == "ru" else "Artem"), "voicer", clips, lang)
    data = json.loads((vdir / "manifest.json").read_text("utf-8"))
    data["voice_id"] = labs_id
    (vdir / "manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    print(f"{vid}: {len(todo)} new, {len(clips)} total", flush=True)


def write_index():
    voices = []
    for vdir in sorted(VOICES_DIR.iterdir()):
        m = vdir / "manifest.json"
        if vdir.is_dir() and m.exists():
            d = json.loads(m.read_text("utf-8"))
            voices.append({"id": vdir.name, "label": d.get("label", vdir.name), "engine": d.get("engine"),
                           "lang": d.get("lang", "ru"), "count": len(d["clips"])})
    order = {"voicer": 0, "eleven": 1, "dmitri": 2, "ruslan": 3, "denis": 4, "irina": 5,
             "voicer-en": 10, "eleven-en": 11, "en-ryan": 12, "en-joe": 13, "en-alan": 14, "en-amy": 15}
    voices.sort(key=lambda v: order.get(v["id"], 9))
    (VOICES_DIR / "index.json").write_text(json.dumps({"voices": voices}, ensure_ascii=False, indent=1), "utf-8")
    print("index:", [v["id"] for v in voices])


if __name__ == "__main__":
    print(len(phrases("ru")), "phrases ru,", len(phrases("en")), "en")
    VOICES_DIR.mkdir(exist_ok=True)
    if "--no-piper" not in sys.argv:
        gen_piper()
    gen_eleven()
    gen_voicer()
    write_index()
