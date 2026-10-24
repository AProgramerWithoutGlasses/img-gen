"""Probe multipart image editing using a previously generated local image."""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid
from PIL import Image, ImageDraw
from probe_image_api import image_info

ROOT = Path(__file__).resolve().parent / "outputs" / "edit-probe"
SOURCE = Path(__file__).resolve().parent / "outputs" / "api-probe" / "baseline_1.png"
PROMPT = "编辑输入图片：仅把熊猫手中茶杯的杯身改为鲜艳红色陶瓷杯，去掉杯身竹叶花纹。保持茶杯位置和大小、熊猫姿势、石桌上的茶壶、竹林、右侧亭子及水彩风格不变。"
CASES = {
    "gpt_basic": {"model": "gpt-image-2"},
    "gemini_flash_edits": {"model": "gemini-3.1-flash-image"},
    "gemini_pro_edits": {"model": "gemini-3-pro-image"},
    "missing_image": {"model": "gpt-image-2", "omit_image": True},
    "gpt_mask": {"model": "gpt-image-2", "mask": True},
    "gpt_mask_opaque": {"model": "gpt-image-2", "mask": "opaque"},
    "gpt_size_count": {"model": "gpt-image-2", "size": "1536x1024", "n": 2},
    "gpt_image_array": {"model": "gpt-image-2", "image_field": "image[]"},
}


def prepare_masks():
    with Image.open(SOURCE) as im:
        mask = Image.new("RGBA", im.size, (255, 255, 255, 255))
        mask.save(ROOT / "mask_opaque.png")
        ImageDraw.Draw(mask).rectangle((525, 452, 645, 556), fill=(255, 255, 255, 0))
        mask.save(ROOT / "mask_cup.png")
        preview = im.convert("RGB")
        ImageDraw.Draw(preview).rectangle((525, 452, 645, 556), outline=(255, 0, 0), width=5)
        preview.save(ROOT / "mask_region_preview.png")


def encode_multipart(fields, files):
    boundary = "CodexEditProbe" + uuid.uuid4().hex
    pieces = []
    for name, value in fields.items():
        pieces.append(("--" + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + str(value) + "\r\n").encode("utf-8"))
    for field, path in files:
        pieces.append(("--" + boundary + '\r\nContent-Disposition: form-data; name="' + field + '"; filename="' + path.name + '"\r\nContent-Type: image/png\r\n\r\n').encode("utf-8"))
        pieces.extend((path.read_bytes(), b"\r\n"))
    pieces.append(("--" + boundary + "--\r\n").encode())
    return b"".join(pieces), "multipart/form-data; boundary=" + boundary


def run(case, key):
    opts = dict(CASES[case])
    mask = opts.pop("mask", False)
    image_field = opts.pop("image_field", "image")
    missing = opts.pop("omit_image", False)
    fields = {"prompt": PROMPT, **opts}
    files = [] if missing else [(image_field, SOURCE)]
    if mask:
        files.append(("mask", ROOT / ("mask_opaque.png" if mask == "opaque" else "mask_cup.png")))
    body, content_type = encode_multipart(fields, files)
    result = {"case": case, "endpoint": "/v1/images/edits", "fields": fields,
              "files": [{"field": field, "path": str(path), "bytes": path.stat().st_size,
                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for field, path in files],
              "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    start = time.monotonic()
    print(json.dumps({"started": case, "fields": fields}, ensure_ascii=False), flush=True)
    try:
        req = urllib.request.Request("https://api.qiso.io/v1/images/edits", data=body,
            headers={"Authorization": "Bearer " + key, "Content-Type": content_type}, method="POST")
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
        images = []
        for item in payload.get("data", []):
            b64 = item.pop("b64_json", None)
            if b64:
                blob = base64.b64decode(b64)
                info = image_info(blob)
                target = ROOT / (case + "_" + str(len(images) + 1) + "." + info["format"])
                target.write_bytes(blob)
                info["file"] = str(target)
                images.append(info)
                item["saved_image"] = info
        result.update(response=payload, images=images, image_count=len(payload.get("data", [])))
    except Exception as exc:
        result["transport_error"] = str(exc).replace(key, "[REDACTED]")
    result["elapsed_seconds"] = round(time.monotonic() - start, 2)
    encoded = json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[REDACTED]")
    (ROOT / (case + ".json")).write_text(encoded, encoding="utf-8")
    print(encoded, flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="+", choices=list(CASES))
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    prepare_masks()
    key = os.environ["QISO_TEST_API_KEY"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda case: run(case, key), args.cases))


if __name__ == "__main__":
    main()
