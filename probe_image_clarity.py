"""Single-shot Qiso clarity experiment. Each selected case may incur a charge.

Credentials come from the server environment or local .env; never recorded.
Results contain allowlisted metadata and decoded original images, not full responses.
Existing case records block accidental reruns. Failures are never retried.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

from PIL import Image

PROJECT = Path(__file__).resolve().parent
PROMPT = (
    "生成一张16:9横向写实产品摄影：一台银色机械相机正面朝向观众，"
    "居中放在深蓝色细密编织布上；相机镜头占画面中央，镜头周围有细小刻度，"
    "左侧放一张白卡，卡上分两行印着黑色文字 CAMERA TEST 和 0123456789，"
    "右侧放一枚银色硬币。柔和均匀的摄影棚光线，所有物体在同一焦平面。"
)
DETAIL = (
    "精确对焦，整个主体清晰，细密织物的经纬线逐根可辨，金属刻度边缘干净，"
    "字母和数字笔画分离，保留金属表面真实微纹理。"
    "避免景深虚化、柔焦、运动模糊、涂抹降噪和过度锐化光晕。"
)
CASES = ("gpt_default", "gpt_high", "gpt_detail_prompt",
         "gemini_1k", "gemini_2k", "gemini_4k")


def configuration():
    values = {}
    env_file = PROJECT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip("\"'")
    base = os.environ.get("QISO_BASE_URL", values.get("QISO_BASE_URL", "https://api.qiso.io"))
    key = os.environ.get("QISO_TEST_API_KEY") or os.environ.get("QISO_API_KEY") or values.get("QISO_API_KEY")
    if not key:
        raise SystemExit("Missing Qiso API key in environment or local .env")
    return base.rstrip("/"), key


def request_for(case):
    if case.startswith("gpt_"):
        body = {"model": "gpt-image-2", "prompt": PROMPT}
        if case == "gpt_high":
            body["quality"] = "high"
        if case == "gpt_detail_prompt":
            body["prompt"] += DETAIL
        return "/v1/images/generations", body
    return "/v1beta/models/gemini-3.1-flash-image:generateContent", {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "16:9", "imageSize": case.split("_")[1].upper()},
        },
    }


def run(case, output, base, key):
    endpoint, body = request_for(case)
    record = {"case": case, "endpoint": endpoint, "request": body,
              "started_at": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
              "state": "started", "images": []}
    record_path = output / (case + ".json")
    # Reserve the case before sending; interruption must not silently trigger a replay.
    with record_path.open("x", encoding="utf-8") as handle:
        json.dump(record, handle, ensure_ascii=False, indent=2)
    print(json.dumps({"started": case}), flush=True)
    start = time.monotonic()
    try:
        request = urllib.request.Request(base + endpoint, method="POST",
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"))
        try:
            response = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            record["http_status"] = response.status
            record["request_id"] = response.headers.get("x-request-id") or response.headers.get("request-id")
            raw = response.read(72 * 1024 * 1024 + 1)
        if len(raw) > 72 * 1024 * 1024:
            raise ValueError("Response exceeds 72 MiB")
        payload = json.loads(raw)
        record["response_metadata"] = {
            field: payload[field] for field in ("model", "modelVersion", "quality", "size", "output_format", "usage", "usageMetadata")
            if field in payload
        }
        if isinstance(payload.get("error"), dict):
            record["error"] = {field: str(payload["error"][field]).replace(key, "[REDACTED]")[:800]
                               for field in ("code", "type", "message") if field in payload["error"]}
        encoded_images = []
        for item in payload.get("data", []):
            if item.get("b64_json"):
                encoded_images.append(item["b64_json"])
            if "quality" in item:
                record["response_metadata"]["item_quality"] = item["quality"]
        for candidate in payload.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if inline.get("data"):
                    encoded_images.append(inline["data"])
        for index, encoded in enumerate(encoded_images, 1):
            blob = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(blob)) as im:
                im.load()
                info = {"width": im.width, "height": im.height, "format": im.format.lower(),
                        "pixels": im.width * im.height, "bytes": len(blob),
                        "sha256": hashlib.sha256(blob).hexdigest()}
            target = output / (case + "_" + str(index) + "." + info["format"])
            target.write_bytes(blob)
            info["file"] = target.name
            record["images"].append(info)
        record["state"] = "success" if record.get("http_status") == 200 and record["images"] else "failed"
    except Exception as exc:
        record["state"] = "failed"
        record["transport_or_decode_error"] = str(exc).replace(key, "[REDACTED]")[:800]
    record["elapsed_seconds"] = round(time.monotonic() - start, 2)
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in record.items() if k != "request"}, ensure_ascii=False), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="+", choices=CASES)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--execute", action="store_true", help="Actually send billable requests; otherwise print the plan")
    args = parser.parse_args()
    if len(set(args.cases)) != len(args.cases):
        parser.error("Duplicate cases are not allowed")
    if not args.execute:
        print(json.dumps({case: request_for(case) for case in args.cases}, ensure_ascii=False, indent=2))
        return
    base, key = configuration()
    args.output.mkdir(parents=True, exist_ok=True)
    if any((args.output / (case + ".json")).exists() for case in args.cases):
        parser.error("A selected case already exists; refusing to repeat any calls")
    for case in args.cases:
        run(case, args.output, base, key)


if __name__ == "__main__":
    main()
