"""Test the advertised Gemini image models through supported API shapes."""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
from probe_image_api import image_info

ROOT = Path(__file__).resolve().parent / "outputs" / "gemini-probe"
MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image"]
PROMPT = "请直接生成图片：一只在竹林里喝茶的熊猫，水彩风格。"


def run(model, route, key):
    case = route + "_" + model.replace(".", "_")
    if route.startswith("native"):
        path = "/v1beta/models/" + model + ":generateContent"
        config = {"responseModalities": ["TEXT", "IMAGE"]}
        if route == "native_2k":
            config["imageConfig"] = {"aspectRatio": "16:9", "imageSize": "2K"}
        body = {"contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
                "generationConfig": config}
        if route == "native_edit":
            from probe_image_edits import SOURCE, PROMPT as EDIT_PROMPT
            body["contents"][0]["parts"] = [
                {"text": EDIT_PROMPT},
                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(SOURCE.read_bytes()).decode("ascii")}}
            ]
    elif route == "chat":
        path = "/v1/chat/completions"
        body = {"model": model, "messages": [{"role": "user", "content": PROMPT}], "stream": False}
    else:
        path = "/v1/images/generations"
        body = {"model": model, "prompt": PROMPT}
    recorded_body = json.loads(json.dumps(body))
    if route == "native_edit":
        recorded_body["contents"][0]["parts"][1]["inlineData"]["data"] = {"source_file": str(SOURCE), "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}
    result = {"case": case, "model": model, "endpoint": path, "request": recorded_body,
              "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    start = time.monotonic()
    images = []

    def save_b64(encoded):
        blob = base64.b64decode(encoded)
        info = image_info(blob)
        target = ROOT / (case + "_" + str(len(images) + 1) + "." + info["format"])
        target.write_bytes(blob)
        info["file"] = str(target)
        images.append(info)
        return info

    def clean(value):
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, dict):
            out = {}
            for field, item in value.items():
                if field in ("thoughtSignature", "thought_signature") and isinstance(item, str):
                    out[field] = {"omitted": True, "characters": len(item),
                                  "sha256": hashlib.sha256(item.encode()).hexdigest()}
                elif field in ("inlineData", "inline_data") and isinstance(item, dict) and item.get("data"):
                    out[field] = {k: v for k, v in item.items() if k != "data"}
                    out[field]["saved_image"] = save_b64(item["data"])
                elif field == "b64_json" and isinstance(item, str):
                    out["saved_image"] = save_b64(item)
                else:
                    out[field] = clean(item)
            return out
        if isinstance(value, str):
            def replace(match):
                info = save_b64(match.group(1))
                return "[saved image: " + info["file"] + "]"
            return re.sub(r"data:image/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)", replace, value)
        return value

    print(json.dumps({"started": case, "endpoint": path}, ensure_ascii=False), flush=True)
    try:
        req = urllib.request.Request("https://api.qiso.io" + path,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
        try:
            response = urllib.request.urlopen(req, timeout=240)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            result["http_status"] = response.status
            result["headers"] = {k: v for k, v in response.headers.items()
                                  if k.lower() in ("content-type", "x-request-id", "request-id")}
            raw = response.read()
        result["response_bytes"] = len(raw)
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {"non_json": raw[:3000].decode("utf-8", errors="replace")}
        result["response"] = clean(payload)
    except Exception as exc:
        result["transport_error"] = str(exc).replace(key, "[REDACTED]")
    result["images"] = images
    result["image_count"] = len(images)
    result["elapsed_seconds"] = round(time.monotonic() - start, 2)
    (ROOT / (case + ".json")).write_text(
        json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[REDACTED]"), encoding="utf-8")
    summary = {k: v for k, v in result.items() if k not in ("request", "response")}
    summary["response_summary"] = json.dumps(result.get("response"), ensure_ascii=False)[:3500]
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("routes", nargs="+", choices=["images", "native", "chat", "native_2k", "native_edit"])
    parser.add_argument("--models", nargs="+", default=MODELS, choices=MODELS)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    key = os.environ["QISO_TEST_API_KEY"]
    cases = [(model, route) for route in args.routes for model in args.models]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda case: run(*case, key), cases))


if __name__ == "__main__":
    main()
