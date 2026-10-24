"""Probe the user-specified image endpoint; credentials come only from the environment."""
import argparse
import base64
import concurrent.futures
import datetime
import io
import json
import os
from pathlib import Path
import struct
import time
import urllib.error
import urllib.request

ENDPOINT = "https://api.qiso.io/v1/images/generations"
ROOT = Path(__file__).resolve().parent / "outputs" / "api-probe"
PROMPT = "一只在竹林里喝茶的熊猫,水彩风格"
CASES = {
    "baseline": {},
    "quality_low": {"quality": "low", "size": "1024x1024", "n": 1},
    "quality_high": {"quality": "high", "size": "1024x1024", "n": 1},
    "landscape_two": {"quality": "low", "size": "1536x1024", "n": 2},
    "custom_size": {"quality": "low", "size": "1536x864", "n": 1},
    "jpeg_compression": {"quality": "low", "size": "1024x1024", "n": 1,
                         "output_format": "jpeg", "output_compression": 60},
    "invalid_quality": {"quality": "definitely_invalid", "size": "1024x1024", "n": 1},
}


def image_info(blob):
    info = {"bytes": len(blob)}
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        info.update(format="png", width=struct.unpack(">I", blob[16:20])[0],
                    height=struct.unpack(">I", blob[20:24])[0])
    elif blob.startswith(b"\xff\xd8"):
        info["format"] = "jpeg"
    elif blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        info["format"] = "webp"
    else:
        info["format"] = "unknown"
    try:
        from PIL import Image
        with Image.open(io.BytesIO(blob)) as im:
            info.update(width=im.width, height=im.height, mode=im.mode)
    except ImportError:
        pass
    return info


def probe(name, key, request_body=None):
    params = dict(request_body) if request_body is not None else {"model": "gpt-image-2", "prompt": PROMPT, **CASES[name]}
    result = {"case": name, "request": params,
              "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(params, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    start = time.monotonic()
    print(json.dumps({"started": name, "parameters": params}, ensure_ascii=False), flush=True)
    try:
        try:
            response = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            result["http_status"] = response.status
            result["headers"] = {k: v for k, v in response.headers.items()
                                  if k.lower() in ("content-type", "x-request-id", "request-id")}
            body = response.read()
        result["response_bytes"] = len(body)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            payload = {"non_json_body": body[:2000].decode("utf-8", errors="replace")}
        images = []
        if isinstance(payload, dict) and isinstance(payload.get("data"), list):
            for index, item in enumerate(payload["data"], 1):
                if not isinstance(item, dict):
                    continue
                b64 = item.pop("b64_json", None)
                if b64:
                    blob = base64.b64decode(b64)
                    info = image_info(blob)
                    path = ROOT / (name + "_" + str(index) + "." + info["format"])
                    path.write_bytes(blob)
                    info["file"] = str(path)
                    images.append(info)
                    item["saved_image"] = info
                elif item.get("url"):
                    images.append({"url": item["url"]})
            result["image_count"] = len(payload["data"])
        result["images"] = images
        result["response"] = payload
    except Exception as exc:
        result["transport_error"] = str(exc).replace(key, "[REDACTED]")
    result["elapsed_seconds"] = round(time.monotonic() - start, 2)
    serialized = json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[REDACTED]")
    (ROOT / (name + ".json")).write_text(serialized, encoding="utf-8")
    print(serialized, flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="+", choices=list(CASES))
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    key = os.environ["QISO_TEST_API_KEY"]
    ROOT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda name: probe(name, key), args.cases))


if __name__ == "__main__":
    main()
