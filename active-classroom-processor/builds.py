"""Conservative PresentationML click entrances; rasterize cumulative final states.

No animation engine. Unsupported timing leaves the entire slide static and reports
a warning. Original source ZIP is never modified. Raster pages share PPTX media.

GIF overlay API (separate from the build/raster API above): analyze_pptx_gifs,
read_certified_gifs and write_gif_background_pptx. Normal convert/render keep
GIF pictures in the PPTX (frozen to the first frame by converter.convert_office).
"""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import posixpath
from pathlib import Path
import subprocess
import time
from io import BytesIO
import zipfile
from xml.etree import ElementTree as ET
from converter import convert_office, file_integrity, validate_office
from gifs import MAGIC, MAX_GIF_BYTES, GifError, clone_zipinfo, copy_member, scan_gif

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
A14 = "http://schemas.microsoft.com/office/drawing/2010/main"
NS = {"p": P, "a": A, "r": R}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)

MAX_STATES = 200
MAX_PART_BYTES = 32 * 1024 * 1024
RASTER_BATCH = 20
RENDER_DEADLINE_SECONDS = 240

GIF_OVERLAY_VERSION = "pptx-gif-overlays-v1"
MAX_GIFS_PER_SLIDE = 8
MAX_GIFS_PER_PRESENTATION = 32
MAX_OVERLAY_CANVAS_PIXELS = 2048 * 2048
MAX_OVERLAY_ANIMATION_PIXELS = 100_000_000
MAX_PRESENTATION_ANIMATION_PIXELS = 300_000_000
MAX_SLIDE_EMU = 60_000_000
ASPECT_TOLERANCE = 0.01


def read_part(archive, name, limit=MAX_PART_BYTES):
    """Bounded read of one ZIP member (the declared size is not trusted)."""
    with archive.open(name) as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("part-too-large")
    return data


def slide_parts(archive):
    presentation = ET.fromstring(read_part(archive, "ppt/presentation.xml"))
    relationships = ET.fromstring(read_part(archive, "ppt/_rels/presentation.xml.rels"))
    targets = {item.get("Id"): posixpath.normpath(item.get("Target").lstrip("/") if item.get("Target").startswith("/") else "ppt/" + item.get("Target")) for item in relationships}
    return [targets[item.get(f"{{{R}}}id")] for item in presentation.findall("p:sldIdLst/p:sldId", NS)]


def serialize_part(root, original):
    # ElementTree drops declarations used only in QName-valued attributes such
    # as mc:Ignorable="a14". LibreOffice rejects those undeclared prefixes.
    namespaces = dict(item for _event, item in ET.iterparse(BytesIO(original), events=["start-ns"]))
    used = set()
    for element in root.iter():
        for name in [element.tag, *element.attrib]:
            if name.startswith("{"):
                used.add(name[1:].split("}")[0])
    for prefix, uri in namespaces.items():
        if not prefix.startswith("ns") or not prefix[2:].isdigit():
            ET.register_namespace(prefix, uri)
        if prefix and uri not in used:
            root.set(f"xmlns:{prefix}", uri)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def click_steps(root):
    timing = root.find("p:timing", NS)
    if timing is None:
        return [], []
    effects = timing.findall(".//p:cTn[@presetClass]", NS)
    if not effects:
        return [], ["unsupported-timing"]
    # Reject object triggers, timed/mixed sequences, paths, paragraph/character
    # targets, exits and emphasis. Do not partly hide an unsupported slide.
    if timing.find(".//p:cTn[@nodeType='interactiveSeq']", NS) is not None:
        return [], ["object-trigger"]
    if any(item.get("delay", "0") not in {"0", "indefinite"} or item.find(".//p:spTgt", NS) is not None for item in timing.findall(".//p:cond", NS)):
        return [], ["unsupported-trigger-or-delay"]
    steps, seen = [], set()
    shapes = {item.get("id") for item in root.findall("p:cSld/p:spTree/*/p:nvSpPr/p:cNvPr", NS) + root.findall("p:cSld/p:spTree/*/p:nvPicPr/p:cNvPr", NS)}
    for effect in effects:
        targets = effect.findall(".//p:spTgt", NS)
        target_ids = list(dict.fromkeys(target.get("spid") for target in targets))
        if (effect.get("nodeType") not in {"clickEffect", "withEffect"} or effect.get("presetClass") != "entr"
                or effect.get("presetID") not in {"1", "10"} or not target_ids
                or any(target.get("spid") not in shapes or len(target) for target in targets)
                or any(value in seen for value in target_ids)
                or any(effect.find(f".//p:{tag}", NS) is not None for tag in ["animMotion", "animRot", "animScale", "cmd", "audio", "video"])
                or any(item.get("transition") != "in" or item.get("filter") != "fade" for item in effect.findall(".//p:animEffect", NS))
                or any(item.get("evt") not in {None, "onBegin"} or item.get("delay", "0") not in {"0", "indefinite"} for item in effect.findall("p:stCondLst/p:cond", NS))):
            return [], ["unsupported-animation"]
        if effect.get("nodeType") == "withEffect":
            if not steps:
                return [], ["unsupported-animation"]
            steps[-1].extend(target_ids)
        else:
            steps.append(target_ids)
        seen.update(target_ids)
    if len(steps) > 50:
        return [], ["too-many-builds"]
    return steps, []


def analyze_pptx(source):
    """Plan raster states. More than 200 slides is an error; more than 200
    states with at most 200 slides degrades every build slide to one static
    state with the warning ``states-limit-static`` (GIFs are never expanded)."""
    validate_office(source, "pptx")
    with zipfile.ZipFile(source) as archive:
        parts = slide_parts(archive)
        if not 0 < len(parts) <= MAX_STATES:
            raise ValueError("too-many-raster-states")
        slides = []
        for index, part in enumerate(parts):
            steps, warnings = click_steps(ET.fromstring(read_part(archive, part)))
            slides.append({"index": index, "steps": steps, "warnings": warnings})
    states = sum(len(slide["steps"]) + 1 for slide in slides)
    if states > MAX_STATES:
        for slide in slides:
            if slide["steps"]:
                slide["steps"] = []
                slide["warnings"] = [*slide["warnings"], "states-limit-static"]
        states = len(slides)
    return {"slides": slides, "stateCount": states}


def state_pptx(source, target, plan):
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as output:
        names = set(archive.namelist())
        parts = slide_parts(archive)
        presentation = ET.fromstring(read_part(archive, "ppt/presentation.xml"))
        rels = ET.fromstring(read_part(archive, "ppt/_rels/presentation.xml.rels"))
        types = ET.fromstring(read_part(archive, "[Content_Types].xml"))
        ids = presentation.find("p:sldIdLst", NS)
        ids.clear()
        number = 0
        for slide in plan["slides"]:
            part = parts[slide["index"]]
            raw = read_part(archive, part)
            original = ET.fromstring(raw)
            original_rels = posixpath.dirname(part) + "/_rels/" + posixpath.basename(part) + ".rels"
            rels_data = read_part(archive, original_rels) if original_rels in names else None
            for state in range(len(slide["steps"]) + 1):
                number += 1
                root = copy.deepcopy(original)
                timing = root.find("p:timing", NS)
                if timing is not None:
                    root.remove(timing)
                hidden = {shape for step in slide["steps"][state:] for shape in step}
                tree = root.find("p:cSld/p:spTree", NS)
                for shape in list(tree):
                    shape_id = shape.find(".//p:cNvPr", NS)
                    if shape_id is not None and shape_id.get("id") in hidden:
                        tree.remove(shape)
                name = f"ppt/slides/classroomState{number}.xml"
                output.writestr(name, serialize_part(root, raw))
                if rels_data is not None:
                    output.writestr(f"ppt/slides/_rels/classroomState{number}.xml.rels", rels_data)
                rel_id = f"classroomState{number}"
                ET.SubElement(rels, f"{{{PKG}}}Relationship", {"Id": rel_id, "Type": R + "/slide", "Target": f"slides/classroomState{number}.xml"})
                ET.SubElement(ids, f"{{{P}}}sldId", {"id": str(100000 + number), f"{{{R}}}id": rel_id})
                ET.SubElement(types, f"{{{CT}}}Override", {"PartName": "/" + name, "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"})
        replacements = {"ppt/presentation.xml": presentation, "ppt/_rels/presentation.xml.rels": rels, "[Content_Types].xml": types}
        for item in archive.infolist():
            if item.filename in replacements:
                output.writestr(clone_zipinfo(item), serialize_part(replacements[item.filename], read_part(archive, item.filename)))
            else:
                copy_member(archive, item, output)


def render_pptx(source, workspace, plan, deadline_seconds=RENDER_DEADLINE_SECONDS, on_state=None):
    """Rasterize every planned state; pdftoppm runs in batches of RASTER_BATCH
    pages under one total deadline. Temporary files stay inside ``workspace``."""
    started = time.monotonic()

    def remaining():
        left = deadline_seconds - (time.monotonic() - started)
        if left <= 0:
            raise subprocess.TimeoutExpired("render_pptx", deadline_seconds)
        return left

    workspace = Path(workspace)
    states = workspace / "states.pptx"
    state_pptx(source, states, plan)
    result = None
    try:
        result = convert_office(states, "pptx", workspace, timeout=min(180, remaining()))
        total = plan["stateCount"]
        if result["pageCount"] != total:
            raise ValueError("raster-page-mismatch")
        results = []
        for first in range(1, total + 1, RASTER_BATCH):
            last = min(first + RASTER_BATCH - 1, total)
            prefix = workspace / f"state-b{first}"
            # Keep main's two CPU workers while bounding temporary PNGs to one batch.
            midpoint = (first + last) // 2
            ranges = [(first, midpoint)] + ([(midpoint + 1, last)] if midpoint < last else [])
            def rasterize(bounds):
                start, end = bounds
                subprocess.run(["pdftoppm", "-png", "-f", str(start), "-l", str(end), "-scale-to", "1600", str(result["path"]), str(prefix)],
                               check=True, timeout=min(120, remaining()), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with ThreadPoolExecutor(max_workers=2) as workers:
                list(workers.map(rasterize, ranges))
            pages = sorted(workspace.glob(f"state-b{first}-*.png"), key=lambda path: int(path.stem.split("-")[-1]))
            if len(pages) != last - first + 1:
                raise ValueError("raster-state-mismatch")
            for path in pages:
                size, checksum = file_integrity(path)
                state = {"path": path, "sizeBytes": size, "sha256": checksum}
                if on_state is not None:
                    on_state(len(results), state)
                    path.unlink(missing_ok=True)
                results.append(state)
        return results
    finally:
        states.unlink(missing_ok=True)
        if result:
            Path(result["path"]).unlink(missing_ok=True)


def raster_path(revision, index):
    return "active-classroom/publications/files/" + hashlib.sha256(f"{revision}:state:{index}".encode()).hexdigest()


# --- Hybrid GIF overlay API ------------------------------------------------

def _p(tag):
    return f"{{{P}}}{tag}"


def _a(tag):
    return f"{{{A}}}{tag}"


def _slide_relationships(archive, infos, part):
    rels = posixpath.dirname(part) + "/_rels/" + posixpath.basename(part) + ".rels"
    result = {}
    if rels not in infos:
        return result
    for rel in ET.fromstring(read_part(archive, rels)):
        target = rel.get("Target", "")
        if rel.get("TargetMode") == "External":
            path = None
        elif target.startswith("/"):
            path = posixpath.normpath(target.lstrip("/"))
        else:
            path = posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
        result[rel.get("Id")] = None if path is None or path.startswith("..") else path
    return result


def _classify_gif(archive, item, cache):
    """Classify one media part: other, static, invalid, oversize, over-budget or eligible."""
    name = item.filename
    if name in cache:
        return cache[name]
    result = {"kind": "other"}
    try:
        with archive.open(item) as stream:
            is_gif = stream.read(6) in MAGIC
        if not is_gif and name.lower().endswith(".gif"):
            result = {"kind": "invalid"}
        elif is_gif and item.file_size > MAX_GIF_BYTES:
            result = {"kind": "oversize"}
        elif is_gif:
            result = {"kind": "invalid"}
            data = read_part(archive, name, MAX_GIF_BYTES)
            info = scan_gif(BytesIO(data), len(data))
            if info["error"] in {"too-many-frames", "frame-too-large"}:
                result = {"kind": "over-budget"}
            elif info["complete"] and not info["error"] and not info["truncated"]:
                if info["frameCount"] == 1:
                    result = {"kind": "static"}
                elif info["width"] * info["height"] > MAX_OVERLAY_CANVAS_PIXELS or info["framePixels"] > MAX_OVERLAY_ANIMATION_PIXELS:
                    result = {"kind": "over-budget"}
                else:
                    result = {"kind": "eligible", "zipPart": name, "sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data),
                              "width": info["width"], "height": info["height"], "frameCount": info["frameCount"],
                              "framePixels": info["framePixels"], "hasTransparency": info["hasTransparency"]}
    except (GifError, ValueError, zipfile.BadZipFile, RuntimeError, EOFError, OSError):
        pass
    cache[name] = result
    return result


def _zero(value):
    return value in {None, "", "0"}


def _int(value):
    return int(value) if value is not None and value.lstrip("-").isdigit() else None


def _check_pic(pic):
    """Return (rejection code or None, (x, y, cx, cy) in EMU) for a top-level GIF pic."""
    if any(child.tag not in {_p("nvPicPr"), _p("blipFill"), _p("spPr"), _p("style")} for child in pic):
        return "pic-unsupported-child", None
    cnv = pic.find("p:nvPicPr/p:cNvPr", NS)
    nv_pr = pic.find("p:nvPicPr/p:nvPr", NS)
    if cnv is None or nv_pr is None or cnv.get("hidden") in {"1", "true"} or not (cnv.get("id") or "").isdigit():
        return "pic-hidden-or-unidentified", None
    if any(child.tag in {_a("hlinkClick"), _a("hlinkHover")} for child in cnv):
        return "pic-hyperlink", None
    if any(child.tag != _p("extLst") for child in nv_pr):
        return "pic-placeholder-or-media", None
    style = pic.find("p:style", NS)
    if style is not None:
        line, effect = style.find("a:lnRef", NS), style.find("a:effectRef", NS)
        if line is None or line.get("idx") != "0" or (effect is not None and effect.get("idx") != "0"):
            return "pic-style", None
    fill = pic.find("p:blipFill", NS)
    if fill is None or [child.tag for child in fill].count(_a("blip")) != 1 or any(child.tag not in {_a("blip"), _a("srcRect"), _a("stretch")} for child in fill):
        return "pic-fill", None
    crop = fill.find("a:srcRect", NS)
    if crop is not None and not all(_zero(value) for value in crop.attrib.values()):
        return "pic-cropped", None
    stretch = fill.find("a:stretch", NS)
    if stretch is None or any(child.tag != _a("fillRect") for child in stretch):
        return "pic-not-stretch", None
    inset = stretch.find("a:fillRect", NS)
    if inset is not None and not all(_zero(value) for value in inset.attrib.values()):
        return "pic-not-stretch", None
    blip = fill.find("a:blip", NS)
    if blip.get(f"{{{R}}}link") is not None:
        return "pic-linked", None
    for child in blip:
        if child.tag != _a("extLst") or any(inner.tag != f"{{{A14}}}useLocalDpi" for ext in child for inner in ext):
            return "pic-blip-effects", None
    shape = pic.find("p:spPr", NS)
    if shape is None or any(child.tag not in {_a("xfrm"), _a("prstGeom"), _a("ln")} for child in shape):
        return "pic-shape-properties", None
    line = shape.find("a:ln", NS)
    if line is not None and any(child.tag != _a("noFill") for child in line):
        return "pic-border", None
    geometry = shape.find("a:prstGeom", NS)
    if geometry is None or geometry.get("prst") != "rect" or any(len(child) for child in geometry):
        return "pic-geometry", None
    xfrm = shape.find("a:xfrm", NS)
    if xfrm is None or any(child.tag not in {_a("off"), _a("ext")} for child in xfrm):
        return "pic-no-direct-xfrm", None
    if not _zero(xfrm.get("rot")) or xfrm.get("flipH") in {"1", "true"} or xfrm.get("flipV") in {"1", "true"}:
        return "pic-transformed", None
    off, ext = xfrm.find("a:off", NS), xfrm.find("a:ext", NS)
    if off is None or ext is None:
        return "pic-no-direct-xfrm", None
    values = [_int(off.get("x")), _int(off.get("y")), _int(ext.get("cx")), _int(ext.get("cy"))]
    if None in values or values[2] <= 0 or values[3] <= 0:
        return "pic-bad-xfrm", None
    return None, tuple(values)


def _analyze_slide(archive, infos, cache, index, part, slide_size):
    """Return (candidate images, warning codes); candidates empty when rejected."""
    root = ET.fromstring(read_part(archive, part))
    relationships = _slide_relationships(archive, infos, part)
    warnings, classes = [], {}
    for blip in root.iter(_a("blip")):
        rid = blip.get(f"{{{R}}}embed")
        if rid in relationships and relationships[rid] in infos and rid not in classes:
            classes[rid] = _classify_gif(archive, infos[relationships[rid]], cache)
            kind = classes[rid]["kind"]
            if kind in {"invalid"}:
                warnings.append("gif-invalid-static")
            elif kind in {"oversize", "over-budget"}:
                warnings.append("gif-over-budget-static")
    eligible = {rid for rid, info in classes.items() if info["kind"] == "eligible"}
    blips = [blip for blip in root.iter(_a("blip")) if blip.get(f"{{{R}}}embed") in eligible]
    if not blips:
        return [], sorted(set(warnings))
    warnings = sorted(set(warnings))

    def reject(code):
        return [], [*warnings, code]

    if root.find("p:timing", NS) is not None:
        return reject("slide-has-timing")
    tree = root.find("p:cSld/p:spTree", NS)
    children = [child for child in tree if child.tag not in {_p("nvGrpSpPr"), _p("grpSpPr")}]
    suffix = []
    for child in reversed(children):
        blip = child.find("p:blipFill/a:blip", NS) if child.tag == _p("pic") else None
        if blip is None or blip.get(f"{{{R}}}embed") not in eligible:
            break
        suffix.append(child)
    suffix.reverse()
    if len(suffix) != len(blips):
        return reject("gif-not-top-suffix")
    if len(suffix) > MAX_GIFS_PER_SLIDE:
        return reject("too-many-gifs-on-slide")
    ids = [item.get("id") for item in root.iter(_p("cNvPr"))]
    width, height = slide_size
    images = []
    for order, pic in enumerate(suffix):
        code, box = _check_pic(pic)
        if code:
            return reject(code)
        shape_id = pic.find("p:nvPicPr/p:cNvPr", NS).get("id")
        gif = classes[pic.find("p:blipFill/a:blip", NS).get(f"{{{R}}}embed")]
        x, y, cx, cy = box
        if ids.count(shape_id) != 1:
            return reject("duplicate-shape-id")
        if x < 0 or y < 0 or x + cx > width or y + cy > height:
            return reject("pic-out-of-slide")
        if abs(cx * gif["height"] - cy * gif["width"]) > ASPECT_TOLERANCE * cy * gif["width"]:
            return reject("pic-aspect-mismatch")
        images.append({
            "slideIndex": index, "slidePart": part, "shapeId": shape_id, "zIndex": order,
            "zipPart": gif["zipPart"], "sha256": gif["sha256"], "sizeBytes": gif["sizeBytes"],
            "width": gif["width"], "height": gif["height"], "frameCount": gif["frameCount"],
            "hasTransparency": gif["hasTransparency"], "framePixels": gif["framePixels"],
            "x": round(x / width * 100, 4), "y": round(y / height * 100, 4),
            "w": round(cx / width * 100, 4), "h": round(cy / height * 100, 4),
        })
    return images, warnings


def analyze_pptx_gifs(source):
    """Certify animated GIF pictures that can be overlaid on a GIF-free background.

    Conservative: a slide is certified only if every animated GIF on it is a
    top-level, contiguous top-of-z-order ``p:pic`` with plain geometry (see
    _check_pic) and the slide has no timing. Any doubt rejects the whole slide
    with a warning ``slide-<index>:<code>``; its GIFs stay in the static render.
    Returns {"version", "slideSize": {"cx", "cy"}, "images": [...], "warnings": [...]}.
    Image x/y/w/h are percentages of the slide. Nothing is decoded or modified.
    """
    validate_office(source, "pptx")
    result = {"version": GIF_OVERLAY_VERSION, "slideSize": {"cx": 0, "cy": 0}, "images": [], "warnings": []}
    with zipfile.ZipFile(source) as archive:
        infos = {item.filename: item for item in archive.infolist()}
        size = ET.fromstring(read_part(archive, "ppt/presentation.xml")).find("p:sldSz", NS)
        width, height = (_int(size.get("cx")), _int(size.get("cy"))) if size is not None else (None, None)
        if not width or not height or not 0 < width <= MAX_SLIDE_EMU or not 0 < height <= MAX_SLIDE_EMU:
            result["warnings"].append("presentation:invalid-slide-size")
            return result
        result["slideSize"] = {"cx": width, "cy": height}
        cache, pixels = {}, 0
        for index, part in enumerate(slide_parts(archive)):
            try:
                images, codes = _analyze_slide(archive, infos, cache, index, part, (width, height))
            except (ET.ParseError, KeyError, ValueError, zipfile.BadZipFile, RuntimeError, OSError):
                images, codes = [], ["analysis-failed"]
            slide_pixels = sum(image["framePixels"] for image in images)
            if images and len(result["images"]) + len(images) > MAX_GIFS_PER_PRESENTATION:
                images, codes = [], [*codes, "presentation-gif-limit"]
            elif images and pixels + slide_pixels > MAX_PRESENTATION_ANIMATION_PIXELS:
                images, codes = [], [*codes, "presentation-pixel-budget"]
            pixels += slide_pixels
            result["images"].extend(images)
            result["warnings"].extend(f"slide-{index}:{code}" for code in codes)
    return result


def read_certified_gifs(source, images):
    """Yield (image, original GIF bytes) from the source ZIP, verifying size and sha256."""
    validate_office(source, "pptx")
    with zipfile.ZipFile(source) as archive:
        for image in images:
            data = read_part(archive, image["zipPart"], MAX_GIF_BYTES)
            if len(data) != image["sizeBytes"] or hashlib.sha256(data).hexdigest() != image["sha256"]:
                raise ValueError("gif-hash-mismatch")
            yield image, data


def write_gif_background_pptx(source, target, images):
    """Write ``target`` = ``source`` minus the certified GIF pictures in ``images``.

    ``images`` must come from analyze_pptx_gifs (same source) and include every
    certified image of each slide it touches. The analysis is repeated here and
    each entry must match it exactly, so only certified shapes are removed.
    Media parts and relationships are left in place. Raises ValueError (and
    removes ``target``) otherwise.
    """
    fresh = {(image["slidePart"], image["shapeId"]): image for image in analyze_pptx_gifs(source)["images"]}
    wanted = {}
    for image in images:
        key = (image.get("slidePart"), image.get("shapeId"))
        current = fresh.get(key)
        if current is None or any(current[field] != image.get(field) for field in ("zipPart", "sha256", "sizeBytes")):
            raise ValueError("gif-not-certified")
        wanted[key] = current
    if not wanted:
        raise ValueError("no-gif-selected")
    if any(key not in wanted and key[0] in {slide for slide, _shape in wanted} for key in fresh):
        raise ValueError("partial-slide-selection")
    by_part = {}
    for part, shape_id in wanted:
        by_part.setdefault(part, set()).add(shape_id)
    try:
        with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as output:
            for item in archive.infolist():
                if item.filename not in by_part:
                    copy_member(archive, item, output)
                    continue
                raw = read_part(archive, item.filename)
                root = ET.fromstring(raw)
                if root.find("p:timing", NS) is not None:
                    raise ValueError("gif-not-certified")
                tree = root.find("p:cSld/p:spTree", NS)
                removed = set()
                for pic in tree.findall("p:pic", NS):
                    cnv = pic.find("p:nvPicPr/p:cNvPr", NS)
                    shape_id = cnv.get("id") if cnv is not None else None
                    if shape_id in by_part[item.filename]:
                        tree.remove(pic)
                        removed.add(shape_id)
                if removed != by_part[item.filename]:
                    raise ValueError("gif-not-certified")
                output.writestr(clone_zipinfo(item), serialize_part(root, raw))
    except BaseException:
        Path(target).unlink(missing_ok=True)
        raise
