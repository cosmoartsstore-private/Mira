import urllib.request
import json
import os
import sys
import base64

API = "http://localhost:50021"

TARGETS = {
    "四国めたん": "metan",
    "ずんだもん": "zundamon",
    "春日部つむぎ": "tsumugi",
    "東北ずん子": "zunko",
    "櫻歌ミコ": "miko",
    "WhiteCUL": "whitecul",
    "Voidoll": "voidoll",
    "白上虎太郎": "kotaro",
    "離途": "rito",
}

MESSAGES = {
    "5min": "5分後に予約が入っています",
    "10min": "10分後に予約が入っています",
    "15min": "15分後に予約が入っています",
    "20min": "20分後に予約が入っています",
    "30min": "30分後に予約が入っています",
    "1h": "1時間後に予約が入っています",
}

def get_speakers():
    req = urllib.request.Request(f"{API}/speakers")
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode("utf-8"))

def get_normal_id(speaker):
    for st in speaker["styles"]:
        if st["name"] == "ノーマル":
            return st["id"]
    return speaker["styles"][0]["id"]

def generate_wav(text, speaker_id):
    # audio_query
    params = urllib.parse.urlencode({"text": text, "speaker": speaker_id})
    req = urllib.request.Request(f"{API}/audio_query?{params}", method="POST")
    with urllib.request.urlopen(req) as res:
        query = json.loads(res.read().decode("utf-8"))

    # synthesis
    params = urllib.parse.urlencode({"speaker": speaker_id})
    data = json.dumps(query).encode("utf-8")
    req = urllib.request.Request(f"{API}/synthesis?{params}", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as res:
        return res.read()

import urllib.parse

def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "voices")
    os.makedirs(out_dir, exist_ok=True)

    speakers = get_speakers()
    speaker_map = {}
    for s in speakers:
        if s["name"] in TARGETS:
            sid = get_normal_id(s)
            key = TARGETS[s["name"]]
            speaker_map[key] = (s["name"], sid)
            print(f"  {s['name']}: id={sid}")

    print(f"\nFound {len(speaker_map)}/9 speakers")

    total = len(speaker_map) * len(MESSAGES)
    done = 0

    for char_key, (char_name, sid) in speaker_map.items():
        for msg_key, msg_text in MESSAGES.items():
            fname = f"{char_key}_{msg_key}.wav"
            fpath = os.path.join(out_dir, fname)
            if os.path.exists(fpath):
                done += 1
                print(f"  [{done}/{total}] SKIP {fname}")
                continue
            try:
                wav = generate_wav(msg_text, sid)
                with open(fpath, "wb") as f:
                    f.write(wav)
                done += 1
                print(f"  [{done}/{total}] OK {fname}")
            except Exception as e:
                done += 1
                print(f"  [{done}/{total}] FAIL {fname}: {e}")

if __name__ == "__main__":
    main()
