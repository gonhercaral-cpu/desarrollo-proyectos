"""Private Cloud Run service. Only Functions' service identity may invoke it."""
import hashlib
import os
from pathlib import Path
import re
import tempfile
import time
import subprocess
import zipfile
from datetime import datetime, timezone
from flask import Flask, jsonify, request
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from converter import convert_office, file_integrity, MAX_BYTES, PROCESSOR_VERSION
from builds import A, NS, analyze_pptx, render_pptx, raster_path, analyze_pptx_gifs, read_certified_gifs, write_gif_background_pptx, read_part
from studio import apply_studio_edits, inspect_slide, parse_studio_edits

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024


def public_conversion_error(error):
    if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)):
        return "conversion-timeout"
    if isinstance(error, zipfile.BadZipFile):
        return "invalid-office-file"
    code = str(error) if isinstance(error, ValueError) else ""
    return code if code in {"invalid-office-file", "invalid-office-archive", "external-document-reference", "file-too-large", "too-many-slides", "invalid-page-count", "source-size-mismatch", "source-integrity-mismatch", "invalid-studio-edits", "invalid-studio-render-slides", "studio-element-not-found", "studio-edit-unsupported"} else "conversion-failed"


def animation_path(revision, slide_index, asset):
    return "active-classroom/publications/files/" + hashlib.sha256(f"{revision}:animation:{slide_index}:{asset}".encode()).hexdigest()


def pptx_plan(source):
    result = analyze_pptx(source)
    result["selectiveRaster"] = True
    result["selectiveSafe"] = selective_raster_safe(source)
    result["animationPlan"] = []
    try:
        analysis = analyze_pptx_gifs(source)
        for image in analysis["images"]:
            groups = result["animationPlan"]
            group = next((item for item in groups if item["slideIndex"] == image["slideIndex"]), None)
            if group is None:
                group = {"slideIndex": image["slideIndex"], "images": []}
                groups.append(group)
            group["images"].append({"x": image["x"], "y": image["y"], "width": image["w"], "height": image["h"], "sha256": image["sha256"], "sizeBytes": image["sizeBytes"]})
        for warning in analysis["warnings"]:
            match = re.match(r"slide-(\d+):(.*)", warning)
            if match and int(match[1]) < len(result["slides"]):
                result["slides"][int(match[1])]["warnings"].append("gif-static:" + match[2])
            elif warning.startswith("presentation:"):
                for slide in result["slides"]:
                    slide["warnings"].append("gif-static:" + warning)
    except Exception:
        # Optional analysis cannot reject an otherwise valid static presentation.
        for slide in result["slides"]:
            slide["warnings"].append("gif-analysis-static-fallback")
    return result


def selective_raster_safe(source):
    # Rendering a subset can change position-dependent fields such as slide numbers.
    # Masters and layouts can contribute fields even when the slide has no shape of its own.
    with zipfile.ZipFile(source) as archive:
        for part in archive.namelist():
            if not re.fullmatch(r"ppt/(slides|slideLayouts|slideMasters)/[^/]+\.xml", part):
                continue
            try:
                root = ElementTree.fromstring(read_part(archive, part))
            except (ValueError, ElementTree.ParseError):
                return False
            if next(root.iter(f"{{{A}}}fld"), None) is not None or root.find(".//p:ph[@type='sldNum']", NS) is not None:
                return False
    return True


def validate_request(data):
    if not isinstance(data, dict) or data.get("processorVersion") not in {PROCESSOR_VERSION, "pptx-builds-png-v1", "pptx-builds-png-v2"}:
        raise ValueError("invalid-processor-version")
    revision = data.get("revision", "")
    if not re.fullmatch(r"[a-f0-9-]{36}", revision) or data.get("extension") not in {"ppt", "pptx", "doc", "docx"}:
        raise ValueError("invalid-request")
    original = data.get("original", {})
    if not re.fullmatch(r"active-classroom/publications/files/[a-f0-9]{64}", original.get("path", "")) or not re.fullmatch(r"\d+", original.get("generation", "")):
        raise ValueError("invalid-source")
    size = original.get("sizeBytes")
    if type(size) is int and size > MAX_BYTES:
        # Unambiguous and safe: lets the caller report the real size limit instead of a generic failure.
        raise ValueError("file-too-large")
    if type(size) is not int or size < 1 or not re.fullmatch(r"[a-f0-9]{64}", original.get("checksums", {}).get("sha256", "")):
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


def studio_source(data, source, workspace):
    """Apply optional studioEdits to a temporary copy; the downloaded original is untouched."""
    edits = parse_studio_edits(data.get("studioEdits"))
    if edits is None:
        return source
    if data["extension"] != "pptx" or data["processorVersion"] not in {"pptx-builds-png-v1", "pptx-builds-png-v2"}:
        raise ValueError("invalid-studio-edits")
    edited = Path(workspace) / "studio.pptx"
    apply_studio_edits(source, edited, edits)
    return edited


@app.post("/studio/inspect")
def studio_inspect():
    try:
        data = request.get_json()
        original = validate_request(data)
        if data["extension"] != "pptx" or data["processorVersion"] not in {"pptx-builds-png-v1", "pptx-builds-png-v2"}:
            raise ValueError("invalid-plan-request")
        with tempfile.TemporaryDirectory(prefix="classroom-studio-") as workspace:
            return jsonify(inspect_slide(download_source(data, original, workspace), data.get("slideIndex")))
    except Exception as error:
        code = public_conversion_error(error)
        app.logger.error("Studio inspection failed: error=%s code=%s", type(error).__name__, code)
        return jsonify({"error": code}), 422


@app.post("/plan")
def plan():
    try:
        data = request.get_json()
        original = validate_request(data)
        if data["extension"] != "pptx" or data["processorVersion"] not in {"pptx-builds-png-v1", "pptx-builds-png-v2"}:
            raise ValueError("invalid-plan-request")
        with tempfile.TemporaryDirectory(prefix="classroom-plan-") as workspace:
            source = download_source(data, original, workspace)
            result = pptx_plan(studio_source(data, source, workspace))
        return jsonify(result)
    except Exception as error:
        code = public_conversion_error(error)
        app.logger.error("PPTX planning failed: stage=plan error=%s code=%s", type(error).__name__, code)
        return jsonify({"error": code}), 422


def valid_animation_upload(url_value, path):
    url = urlparse(url_value)
    return url.scheme == "https" and url.netloc == "storage.googleapis.com" and unquote(url.path) == f"/{os.environ['STORAGE_BUCKET']}/{path}" and bool(parse_qs(url.query).get("X-Goog-Signature"))


def upload_animation_file(url, path, mime_type, deadline):
    size, checksum = file_integrity(path)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("animation-deadline")
    with path.open("rb") as image:
        upload = Request(url, data=image, method="PUT", headers={"Content-Type": mime_type, "Content-Length": str(size), "x-goog-if-generation-match": "0"})
        with urlopen(upload, timeout=min(20, remaining)) as response:
            if response.status not in [200, 201]:
                raise ValueError("animation-upload-failed")
    return {"sizeBytes": size, "sha256": checksum}


def upload_animations(data, source, workspace, plan, deadline):
    capabilities = data.get("animationUploadUrls")
    if not capabilities:
        return []
    try:
        if not isinstance(capabilities, list) or len(capabilities) > len(plan["animationPlan"]):
            raise ValueError("invalid-animation-capabilities")
        selected = []
        seen = set()
        for grant in capabilities:
            index = grant.get("slideIndex")
            candidate = next((item for item in plan["animationPlan"] if item["slideIndex"] == index), None)
            if candidate is None or type(index) is not int or index in seen or not isinstance(grant.get("imageUrls"), list) or len(grant["imageUrls"]) != len(candidate["images"]):
                raise ValueError("invalid-animation-capabilities")
            seen.add(index)
            if not valid_animation_upload(grant["backgroundUrl"], animation_path(data["revision"], index, "background")):
                raise ValueError("invalid-animation-background")
            for number, url in enumerate(grant["imageUrls"]):
                if not valid_animation_upload(url, animation_path(data["revision"], index, f"gif-{number}")):
                    raise ValueError("invalid-animation-image")
            selected.append(grant)
        if not selected or deadline - time.monotonic() < 45:
            return []
        analysis = analyze_pptx_gifs(source)
        images = [image for image in analysis["images"] if image["slideIndex"] in seen]
        with tempfile.TemporaryDirectory(prefix="hybrid-", dir=workspace) as directory:
            directory = Path(directory)
            background_source = directory / "background.pptx"
            write_gif_background_pptx(source, background_source, images)
            background_pdf = convert_office(background_source, "pptx", directory, timeout=min(30, max(1, deadline - time.monotonic())))
            results = []
            for grant in selected:
                index = grant["slideIndex"]
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                prefix = directory / f"background-{index}"
                subprocess.run(["pdftoppm", "-png", "-scale-to", "1600", "-f", str(index + 1), "-l", str(index + 1), "-singlefile", str(background_pdf["path"]), str(prefix)], check=True, timeout=min(15, remaining), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                background = prefix.with_suffix(".png")
                from struct import unpack
                header = background.open("rb")
                with header:
                    width, height = unpack(">II", header.read(24)[16:24])
                frozen = upload_animation_file(grant["backgroundUrl"], background, "image/png", deadline)
                background.unlink()
                frozen.update({"width": width, "height": height})
                uploaded = []
                slide_images = [image for image in images if image["slideIndex"] == index]
                for number, (_image, content) in enumerate(read_certified_gifs(source, slide_images)):
                    path = directory / "animation.gif"
                    path.write_bytes(content)
                    uploaded.append(upload_animation_file(grant["imageUrls"][number], path, "image/gif", deadline))
                    path.unlink()
                results.append({"slideIndex": index, "background": frozen, "images": uploaded})
            return results
    except Exception as error:
        app.logger.warning("Optional GIF conversion kept static slides: %s", type(error).__name__)
        return []


def parse_render_slides(value):
    """Optional studioRenderSlides: non-empty, strictly increasing list of integer slide indexes."""
    if value is None:
        return None
    if not isinstance(value, list) or not value or any(type(item) is not int or item < 0 for item in value) or any(a >= b for a, b in zip(value, value[1:])):
        raise ValueError("invalid-studio-render-slides")
    return value


def upload_pngs(data, source, workspace):
    """Rasterize and upload states. With studioRenderSlides only those slides are
    rendered: stateUploadUrls keeps global state indexes (null when not selected)
    and the returned ``states`` has the global length with null for skipped states."""
    deadline = time.monotonic() + 300
    plan = pptx_plan(source)
    selection = parse_render_slides(data.get("studioRenderSlides"))
    if selection is not None and selection[-1] >= len(plan["slides"]):
        raise ValueError("invalid-studio-render-slides")
    first_states = []
    total = 0
    for slide in plan["slides"]:
        first_states.append(total)
        total += len(slide["steps"]) + 1
    chosen = plan["slides"] if selection is None else [plan["slides"][index] for index in selection]
    selected_states = [first_states[slide["index"]] + step for slide in chosen for step in range(len(slide["steps"]) + 1)]
    urls = data.get("stateUploadUrls")
    if not isinstance(urls, list) or len(urls) != plan["stateCount"]:
        raise ValueError("invalid-state-capabilities")
    for index, raw_url in enumerate(urls):
        if selection is not None and index not in selected_states:
            if raw_url is not None:
                raise ValueError("invalid-state-capability")
            continue
        if not isinstance(raw_url, str):
            raise ValueError("invalid-state-capability")
        url = urlparse(raw_url)
        if url.scheme != "https" or url.netloc != "storage.googleapis.com" or unquote(url.path) != f"/{os.environ['STORAGE_BUCKET']}/{raster_path(data['revision'], index)}" or not parse_qs(url.query).get("X-Goog-Signature"):
            raise ValueError("invalid-state-capability")
    from struct import unpack
    def upload_state(index, state):
        with state["path"].open("rb") as image:
            prefix = image.read(24)
            if prefix[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("invalid-png")
            state["width"], state["height"] = unpack(">II", prefix[16:24])
            image.seek(0)
            upload = Request(urls[index], data=image, method="PUT", headers={"Content-Type": "image/png", "Content-Length": str(state["sizeBytes"]), "x-goog-if-generation-match": "0"})
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("conversion-deadline")
            with urlopen(upload, timeout=min(30, remaining)) as response:
                if response.status not in [200, 201]:
                    raise ValueError("upload-failed")
        del state["path"]
    # Upload and remove each completed batch before rasterizing the next one.
    use_full_pdf = selection is not None and plan.get("selectiveSafe") is False
    render_plan = plan if use_full_pdf else {"slides": chosen, "stateCount": len(selected_states)}
    render_options = {"raster_indices": selected_states} if use_full_pdf else {}
    rendered = render_pptx(source, workspace, render_plan, deadline_seconds=min(240, max(1, deadline - time.monotonic())), on_state=lambda local, state: upload_state(selected_states[local], state), **render_options)
    states = [None] * plan["stateCount"]
    for index, state in zip(selected_states, rendered):
        states[index] = state
    animation_plan = plan
    if selection is not None:
        animation_plan = {**plan, "animationPlan": [item for item in plan["animationPlan"] if item["slideIndex"] in selection]}
    animations = upload_animations(data, source, workspace, animation_plan, deadline)
    return {"processorVersion": data["processorVersion"], "revision": data["revision"], "pageCount": len(plan["slides"]), "slides": plan["slides"], "states": states, "animations": animations}


@app.get("/health")
def health():
    return jsonify({"status": "ready", "processorVersion": PROCESSOR_VERSION})


@app.post("/convert")
def convert():
    try:
        data = request.get_json()
        original = validate_request(data)
        parse_studio_edits(data.get("studioEdits"))
        parse_render_slides(data.get("studioRenderSlides"))
    except (ValueError, TypeError, AttributeError) as error:
        if isinstance(error, ValueError) and str(error) in {"invalid-studio-edits", "invalid-studio-render-slides"}:
            return jsonify({"error": str(error)}), 400
        if isinstance(error, ValueError) and str(error) == "file-too-large":
            return jsonify({"error": "file-too-large"}), 422
        return jsonify({"error": "invalid-request"}), 400
    try:
        with tempfile.TemporaryDirectory(prefix="classroom-office-") as workspace:
            source = download_source(data, original, workspace)
            if data["processorVersion"] in {"pptx-builds-png-v1", "pptx-builds-png-v2"}:
                if data["extension"] != "pptx":
                    raise ValueError("invalid-pptx-extension")
                return jsonify(upload_pngs(data, studio_source(data, source, workspace), workspace))
            if data.get("studioEdits") is not None:
                raise ValueError("invalid-studio-edits")
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
        code = public_conversion_error(error)
        app.logger.error("Office conversion failed: error=%s code=%s", type(error).__name__, code)
        return jsonify({"error": code}), 422
