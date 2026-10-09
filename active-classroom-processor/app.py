"""Private Cloud Run service. Only Functions' service identity may invoke it."""
import hashlib
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timezone
from flask import Flask, jsonify, request
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import Request, urlopen
from converter import convert_office, file_integrity, MAX_BYTES, PROCESSOR_VERSION
from builds import analyze_pptx, render_pptx, raster_path

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024


def validate_request(data):
    if not isinstance(data, dict) or data.get("processorVersion") not in {PROCESSOR_VERSION, "pptx-builds-png-v1"}:
        raise ValueError("invalid-processor-version")
    revision = data.get("revision", "")
    if not re.fullmatch(r"[a-f0-9-]{36}", revision) or data.get("extension") not in {"ppt", "pptx", "doc", "docx"}:
        raise ValueError("invalid-request")
    original = data.get("original", {})
    if not re.fullmatch(r"active-classroom/publications/files/[a-f0-9]{64}", original.get("path", "")) or not re.fullmatch(r"\d+", original.get("generation", "")):
        raise ValueError("invalid-source")
    size = original.get("sizeBytes")
    if type(size) is not int or size < 1 or size > MAX_BYTES or not re.fullmatch(r"[a-f0-9]{64}", original.get("checksums", {}).get("sha256", "")):
        raise ValueError("invalid-source-integrity")
    bucket = os.environ["STORAGE_BUCKET"]
    target_path = "active-classroom/publications/files/" + hashlib.sha256(f"{revision}:pdf".encode()).hexdigest()
    for key, path in [("sourceUrl", original["path"]), ("uploadUrl", target_path)]:
        url = urlparse(data.get(key, ""))
        query = parse_qs(url.query)
        if url.scheme != "https" or url.netloc != "storage.googleapis.com" or unquote(url.path) != f"/{bucket}/{path}" or not query.get("X-Goog-Signature"):
            raise ValueError("invalid-storage-capability")
        if key == "sourceUrl" and query.get("generation") != [original["generation"]]:
            raise ValueError("invalid-source-generation")
    return original


def download_source(data, original, workspace):
    source = Path(workspace) / f"document.{data['extension']}"
    with urlopen(data["sourceUrl"], timeout=60) as remote, source.open("wb") as output:
        received = 0
        for chunk in iter(lambda: remote.read(65536), b""):
            received += len(chunk)
            if received > original["sizeBytes"]:
                raise ValueError("source-size-mismatch")
            output.write(chunk)
    size, checksum = file_integrity(source)
    if size != original["sizeBytes"] or checksum != original["checksums"]["sha256"]:
        raise ValueError("source-integrity-mismatch")
    return source


@app.post("/plan")
def plan():
    try:
        data = request.get_json()
        original = validate_request(data)
        if data["extension"] != "pptx" or data["processorVersion"] != "pptx-builds-png-v1":
            raise ValueError("invalid-plan-request")
        with tempfile.TemporaryDirectory(prefix="classroom-plan-") as workspace:
            result = analyze_pptx(download_source(data, original, workspace))
        return jsonify(result)
    except Exception as error:
        app.logger.error("PPTX planning failed: %s", type(error).__name__)
        return jsonify({"error": "planning-failed"}), 422


def upload_pngs(data, source, workspace):
    plan = analyze_pptx(source)
    urls = data.get("stateUploadUrls")
    if not isinstance(urls, list) or len(urls) != plan["stateCount"]:
        raise ValueError("invalid-state-capabilities")
    for index, raw_url in enumerate(urls):
        url = urlparse(raw_url)
        if url.scheme != "https" or url.netloc != "storage.googleapis.com" or unquote(url.path) != f"/{os.environ['STORAGE_BUCKET']}/{raster_path(data['revision'], index)}" or not parse_qs(url.query).get("X-Goog-Signature"):
            raise ValueError("invalid-state-capability")
    states = render_pptx(source, workspace, plan)
    from struct import unpack
    for index, state in enumerate(states):
        with state["path"].open("rb") as image:
            prefix = image.read(24)
            if prefix[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("invalid-png")
            state["width"], state["height"] = unpack(">II", prefix[16:24])
            image.seek(0)
            upload = Request(urls[index], data=image, method="PUT", headers={"Content-Type": "image/png", "Content-Length": str(state["sizeBytes"]), "x-goog-if-generation-match": "0"})
            with urlopen(upload, timeout=60) as response:
                if response.status not in [200, 201]:
                    raise ValueError("upload-failed")
        del state["path"]
    return {"processorVersion": "pptx-builds-png-v1", "revision": data["revision"], "pageCount": len(plan["slides"]), "slides": plan["slides"], "states": states}


@app.get("/health")
def health():
    return jsonify({"status": "ready", "processorVersion": PROCESSOR_VERSION})


@app.post("/convert")
def convert():
    try:
        data = request.get_json()
        original = validate_request(data)
    except (ValueError, TypeError, AttributeError):
        return jsonify({"error": "invalid-request"}), 400
    try:
        with tempfile.TemporaryDirectory(prefix="classroom-office-") as workspace:
            source = download_source(data, original, workspace)
            if data["processorVersion"] == "pptx-builds-png-v1":
                if data["extension"] != "pptx":
                    raise ValueError("invalid-pptx-extension")
                return jsonify(upload_pngs(data, source, workspace))
            result = convert_office(source, data["extension"], workspace)
            # The signed upload is restricted to one new object and forbids overwrite.
            with result["path"].open("rb") as pdf:
                upload = Request(data["uploadUrl"], data=pdf, method="PUT", headers={"Content-Type": "application/pdf", "Content-Length": str(result["sizeBytes"]), "x-goog-if-generation-match": "0"})
                with urlopen(upload, timeout=60) as response:
                    if response.status not in [200, 201]:
                        raise ValueError("upload-failed")
            return jsonify({"processorVersion": PROCESSOR_VERSION, "revision": data["revision"], "pageCount": result["pageCount"], "sha256": result["sha256"], "sizeBytes": result["sizeBytes"], "processedAt": datetime.now(timezone.utc).isoformat()})
    except Exception as error:
        # Only error class; no source names, URLs, tokens, converter stdout or paths.
        app.logger.error("Office conversion failed: %s", type(error).__name__)
        return jsonify({"error": "conversion-failed"}), 422
