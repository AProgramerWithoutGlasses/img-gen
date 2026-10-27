"""Compare Gemini Flash edit routes; each explicit case sends one billable request.

Dry-run by default. Existing evidence blocks reruns, including interrupted cases.
Only decoded images and limited diagnostic metadata are retained, never full responses.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw
from probe_image_clarity import configuration
from probe_image_edits import encode_multipart
import probe_two_image_edit as fixtures

MODEL = "gemini-3.1-flash-image"
CASES = ("edits_single", "edits_dual", "native_dual", "native_shapes_dual")
SINGLE_PROMPT = "把图片中间的橘色小猫改成蓝色小猫。保持左边红色花盆、右边绿色球、米色背景和棕色桌面不变。"


def request_for(case, output):
    paths = [output / "base.png"]
    prompt = SINGLE_PROMPT
    if case.endswith("dual"):
        paths.append(output / "reference.png")
        prompt = fixtures.ROLE_PROMPT + fixtures.PROMPT
    if case == "native_shapes_dual":
        paths = [output / "shapes_base.png", output / "shapes_reference.png"]
        prompt = "请编辑第一张图片：把中央橙色圆形替换成第二张图片里的蓝色五边形，保留第一张图的米色背景、左边红色方块和右边绿色方块。只输出一张修改后的图片。"
    if case.startswith("edits"):
        field = "image[]" if len(paths) == 2 else "image"
        body, content_type = encode_multipart(
            {"model": MODEL, "prompt": prompt}, [(field, p) for p in paths])
        endpoint = "/v1/images/edits"
    else:
        field = "inlineData"
        parts = [{"text": prompt}] + [{"inlineData": {
            "mimeType": "image/png", "data": base64.b64encode(p.read_bytes()).decode()
        }} for p in paths]
        body = json.dumps({"contents": [{"role": "user", "parts": parts}],
                           "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}}).encode()
        content_type = "application/json"
        endpoint = f"/v1beta/models/{MODEL}:generateContent"
    metadata = {"model": MODEL, "endpoint": endpoint, "prompt": prompt,
                "image_field": field, "inputs": [
                    {"role": role, "file": p.name, "bytes": p.stat().st_size,
                     "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                    for role, p in zip(("base", "reference"), paths)]}
    return body, content_type, metadata


def safe_text(value, key):
    value = str(value).replace(key, "[REDACTED]")
    value = re.sub(r"data:image/[^\s\"')]+", "[IMAGE DATA OMITTED]", value)
    return value[:1600]


def run(case, output, base, key):
    body, content_type, metadata = request_for(case, output)
    record = {"case": case, **metadata, "state": "started", "images": [],
              "started_at": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()}
    target = output / (case + ".json")
    with target.open("x", encoding="utf-8") as handle:
        json.dump(record, handle, ensure_ascii=False, indent=2)
    print(json.dumps({"started": case, "endpoint": metadata["endpoint"]}), flush=True)
    start = time.monotonic()
    try:
        request = urllib.request.Request(base + metadata["endpoint"], data=body,
            headers={"Authorization": "Bearer " + key, "Content-Type": content_type}, method="POST")
        try:
            response = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            record["http_status"] = response.status
            record["request_id"] = response.headers.get("X-Request-Id") or response.headers.get("Request-Id")
            raw = response.read(72 * 1024 * 1024 + 1)
        record["response_bytes"] = len(raw)
        if len(raw) > 72 * 1024 * 1024:
            raise ValueError("Response exceeds 72 MiB")
        payload = json.loads(raw)
        record["returned_model"] = payload.get("modelVersion") or payload.get("model")
        error = payload.get("error")
        if isinstance(error, dict):
            record["error"] = {k: safe_text(error[k], key) for k in ("code", "type", "message", "status") if k in error}
        feedback = payload.get("promptFeedback", {})
        record["prompt_feedback"] = {k: safe_text(feedback[k], key)
            for k in ("blockReason", "blockReasonMessage") if k in feedback}
        encoded = [item["b64_json"] for item in payload.get("data", []) if item.get("b64_json")]
        record["candidates"] = []
        for candidate in payload.get("candidates", []):
            diagnostic = {k: safe_text(candidate[k], key) for k in ("finishReason", "finishMessage") if k in candidate}
            diagnostic["parts"] = []
            for part in candidate.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data") or {}
                info = {"thought": bool(part.get("thought")), "mime_type": inline.get("mimeType") or inline.get("mime_type"),
                        "encoded_length": len(inline.get("data", ""))}
                if "text" in part:
                    # Thought text and opaque signatures are deliberately omitted.
                    if not part.get("thought"):
                        info["text"] = safe_text(part["text"], key)
                    info["text_length"] = len(part["text"])
                diagnostic["parts"].append(info)
                if inline.get("data") and not part.get("thought"):
                    encoded.append(inline["data"])
            record["candidates"].append(diagnostic)
        for i, value in enumerate(encoded, 1):
            blob = base64.b64decode(value, validate=True)
            with Image.open(io.BytesIO(blob)) as im:
                im.load()
                info = {"width": im.width, "height": im.height, "format": im.format.lower(),
                        "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
            name = f"{case}_{i}.{info['format']}"
            (output / name).write_bytes(blob)
            record["images"].append({"file": name, **info})
        record["state"] = "success" if record["http_status"] == 200 and record["images"] else "failed"
    except Exception as error:
        record["state"] = "failed"
        record["transport_or_decode_error"] = safe_text(error, key)
    record["elapsed_seconds"] = round(time.monotonic() - start, 2)
    target.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in record.items() if k not in ("prompt", "inputs")}, ensure_ascii=False), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="+", choices=CASES)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if len(set(args.cases)) != len(args.cases):
        parser.error("Duplicate cases are not allowed")
    if not args.execute:
        print(json.dumps({"cases": args.cases, "output": str(args.output), "requests": len(args.cases),
                          "note": "Dry run; add --execute to send billable requests"}))
        return
    if any((args.output / (case + ".json")).exists() for case in args.cases):
        parser.error("Evidence already exists; refusing to repeat a potentially billed request")
    base, key = configuration()
    fixtures.OUT = args.output
    fixtures.fixtures()
    if "native_shapes_dual" in args.cases:
        base_image = Image.new("RGB", (512, 512), "#f4e6cc")
        drawing = ImageDraw.Draw(base_image)
        drawing.rectangle((25, 220, 100, 295), fill="#d44839")
        drawing.ellipse((170, 170, 342, 342), fill="#e7983c")
        drawing.rectangle((412, 220, 487, 295), fill="#5aab53")
        base_image.save(args.output / "shapes_base.png")
        reference_image = Image.new("RGB", (512, 512), "#eff5fa")
        ImageDraw.Draw(reference_image).regular_polygon((256, 256, 120), 5, fill="#388fcd")
        reference_image.save(args.output / "shapes_reference.png")
    for case in args.cases:
        run(case, args.output, base, key)


if __name__ == "__main__":
    main()
