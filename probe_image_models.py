"""Inspect advertised models and compare model validation on image generation."""
import argparse
import concurrent.futures
import json
import os
import urllib.error
import urllib.request
import probe_image_api as probe

probe.ROOT = probe.Path(__file__).resolve().parent / "outputs" / "model-probe"


def list_models(key):
    request = urllib.request.Request("https://api.qiso.io/v1/models",
                                     headers={"Authorization": "Bearer " + key})
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        status = response.status
        body = response.read()
    try:
        payload = json.loads(body)
    except ValueError:
        payload = {"body": body[:2000].decode("utf-8", errors="replace")}
    result = {"http_status": status, "response": payload}
    (probe.ROOT / "advertised_models.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[REDACTED]"), encoding="utf-8")
    ids = [m.get("id", "") for m in payload.get("data", []) if isinstance(m, dict)]
    selected = [m for m in ids if any(term in m.lower() for term in ("image", "dall", "flux", "imagen"))]
    print(json.dumps({"http_status": status, "model_count": len(ids), "image_candidates": selected,
                      "error": payload.get("error")}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="*", help="Model IDs; __omitted__, __empty__, __null__ test validation")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    key = os.environ["QISO_TEST_API_KEY"]
    probe.ROOT.mkdir(parents=True, exist_ok=True)
    if args.list:
        list_models(key)

    def run(model):
        body = {"prompt": probe.PROMPT}
        if model != "__omitted__":
            body["model"] = "" if model == "__empty__" else None if model == "__null__" else model
        name = "model_" + "".join(c if c.isalnum() or c in "-_" else "_" for c in model)
        return probe.probe(name, key, request_body=body)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(run, args.models))


if __name__ == "__main__":
    main()
