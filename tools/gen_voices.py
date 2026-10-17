#!/usr/bin/env python3
"""Озвучивает все фразы таймера нейросетевыми голосами и кладёт mp3 в voices/<голос>/.

Запускается в GitHub Actions (.github/workflows/voices.yml), где есть интернет для скачивания моделей.

Голоса:
  * Piper (бесплатно, офлайн-модели): ru_RU dmitri, ruslan, denis, irina.
  * ElevenLabs (по желанию): если задан секрет ELEVENLABS_API_KEY, добавляется голос «eleven».
    Голос выбирается переменной ELEVENLABS_VOICE_ID.

Повторный запуск озвучивает только новые или изменённые фразы (сверяет текст в manifest.json).
"""
import json
import os
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
    # id: (модель, подпись в настройках, темп: <1 быстрее)
    "dmitri": ("ru_RU-dmitri-medium", "Дмитрий", 0.9),
    "ruslan": ("ru_RU-ruslan-medium", "Руслан", 0.9),
    "denis": ("ru_RU-denis-medium", "Денис", 0.9),
    "irina": ("ru_RU-irina-medium", "Ирина", 0.92),
}
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/{name}/medium/{model}{ext}?download=true"


def phrases():
    out = subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify(require('./voice-phrases.js').list()))"],
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


def save_manifest(vdir: Path, label: str, engine: str, clips: dict):
    data = {"label": label, "engine": engine, "clips": clips}
    (vdir / "manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")


def gen_piper(items):
    from piper import PiperVoice, SynthesisConfig

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for vid, (model, label, scale) in PIPER_VOICES.items():
        onnx = MODELS_DIR / f"{model}.onnx"
        for ext in (".onnx", ".onnx.json"):
            path = MODELS_DIR / f"{model}{ext}"
            if not path.exists():
                url = HF.format(name=vid, model=model, ext=ext)
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
        save_manifest(vdir, label, "piper", clips)
        print(f"{vid}: {made} new, {len(clips)} total", flush=True)


def gen_eleven(items):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        print("ElevenLabs: секрет ELEVENLABS_API_KEY не задан — пропускаю")
        return
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID") or "pNInz6obpgDQGcFmaJgB"
    vdir = VOICES_DIR / "eleven"
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
    save_manifest(vdir, "ElevenLabs", "elevenlabs", clips)
    data = json.loads((vdir / "manifest.json").read_text("utf-8"))
    data["voice_id"] = voice_id
    (vdir / "manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    print(f"eleven: {made} new, {len(clips)} total")


def write_index():
    voices = []
    for vdir in sorted(VOICES_DIR.iterdir()):
        m = vdir / "manifest.json"
        if vdir.is_dir() and m.exists():
            d = json.loads(m.read_text("utf-8"))
            voices.append({"id": vdir.name, "label": d.get("label", vdir.name), "engine": d.get("engine"), "count": len(d["clips"])})
    order = {"eleven": 0, "dmitri": 1, "ruslan": 2, "denis": 3, "irina": 4}
    voices.sort(key=lambda v: order.get(v["id"], 9))
    (VOICES_DIR / "index.json").write_text(json.dumps({"voices": voices}, ensure_ascii=False, indent=1), "utf-8")
    print("index:", [v["id"] for v in voices])


if __name__ == "__main__":
    items = phrases()
    print(len(items), "phrases")
    VOICES_DIR.mkdir(exist_ok=True)
    if "--no-piper" not in sys.argv:
        gen_piper(items)
    gen_eleven(items)
    write_index()
