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

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16384


def validate_request(data):
    if not isinstance(data, dict) or data.get("processorVersion") != PROCESSOR_VERSION:
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
