"""Active Classroom Studio: inspect and edit plain PPTX shapes (OOXML, stdlib only).

Compatible elements are top-level, visible, uniquely identified shapes with a
direct ``a:xfrm`` (off + ext): flat text boxes (no fields, no groups) and
pictures. Text is editable only for a text box with exactly one plain run, so no
run styling is lost; geometry stays editable even with several runs.
Edits are applied to a new ZIP; the source is never modified and every other
member (media included) is copied byte for byte with the existing ZIP helpers.
"""
from collections import Counter
from functools import lru_cache
from pathlib import Path
import subprocess
import re
import zipfile
from xml.etree import ElementTree as ET
from builds import MAX_SLIDE_EMU, NS, P, A, R, read_part, serialize_part, slide_parts
from converter import validate_office
from gifs import clone_zipinfo, copy_member

MAX_EDITS = 100
MAX_VISIBLE_ELEMENTS = 300
MAX_TEXT_CHARS = 10000
MIN_FONT_SIZE = 100  # centipoints (1 pt)
MAX_FONT_SIZE = 10000  # centipoints (100 pt)
EDIT_FIELDS = {"slideIndex", "id", "x", "y", "width", "height", "text", "fontSize"}
CHANGE_FIELDS = EDIT_FIELDS - {"slideIndex", "id"}
TEXT_BODY_CHILDREN = {f"{{{A}}}bodyPr", f"{{{A}}}lstStyle", f"{{{A}}}p"}
PARAGRAPH_CHILDREN = {f"{{{A}}}pPr", f"{{{A}}}r", f"{{{A}}}br", f"{{{A}}}endParaRPr"}
ILLEGAL_TEXT = re.compile("[\x00-\x1f\x7f-\x9f\ud800-\udfff￾￿]")


def _p(tag):
    return f"{{{P}}}{tag}"


def _a(tag):
    return f"{{{A}}}{tag}"


def _is_int(value):
    return type(value) is int


def _integer(value):
    return int(value) if isinstance(value, str) and re.fullmatch(r"-?\d{1,12}", value) else None


def _parse(raw):
    # Untrusted XML: refuse any DTD/entity declaration before parsing.
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        raise ValueError("invalid-office-file")
    return ET.fromstring(raw)


def parse_studio_edits(value):
    """Validate the optional ``studioEdits`` request field; None when absent."""
    if value is None:
        return None
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_EDITS:
        raise ValueError("invalid-studio-edits")
    seen, edits = set(), []
    for item in value:
        if not isinstance(item, dict) or not set(item) <= EDIT_FIELDS or not set(item) & CHANGE_FIELDS:
            raise ValueError("invalid-studio-edits")
        index, shape_id = item.get("slideIndex"), item.get("id")
        if not _is_int(index) or not 0 <= index < 10000 or not isinstance(shape_id, str) or not re.fullmatch(r"\d{1,10}", shape_id):
            raise ValueError("invalid-studio-edits")
        if (index, shape_id) in seen:
            raise ValueError("invalid-studio-edits")
        seen.add((index, shape_id))
        for field in ("x", "y"):
            if field in item and (not _is_int(item[field]) or abs(item[field]) > MAX_SLIDE_EMU):
                raise ValueError("invalid-studio-edits")
        for field in ("width", "height"):
            if field in item and (not _is_int(item[field]) or not 1 <= item[field] <= MAX_SLIDE_EMU):
                raise ValueError("invalid-studio-edits")
        if "text" in item and (not isinstance(item["text"], str) or len(item["text"]) > MAX_TEXT_CHARS or ILLEGAL_TEXT.search(item["text"])):
            raise ValueError("invalid-studio-edits")
        if "fontSize" in item and (not _is_int(item["fontSize"]) or not MIN_FONT_SIZE <= item["fontSize"] <= MAX_FONT_SIZE):
            raise ValueError("invalid-studio-edits")
        edits.append(dict(item))
    return edits


def _slide_size(archive):
    size = _parse(read_part(archive, "ppt/presentation.xml")).find("p:sldSz", NS)
    width, height = (_integer(size.get("cx")), _integer(size.get("cy"))) if size is not None else (None, None)
    if not width or not height or not 0 < width <= MAX_SLIDE_EMU or not 0 < height <= MAX_SLIDE_EMU:
        raise ValueError("invalid-office-file")
    return width, height


def _xfrm(shape):
    xfrm = shape.find("p:spPr/a:xfrm", NS)
    if xfrm is None or xfrm.get("rot", "0") != "0" or any(xfrm.get(key) in {"1", "true"} for key in ("flipH", "flipV")):
        return None
    off, ext = xfrm.find("a:off", NS), xfrm.find("a:ext", NS)
    if off is None or ext is None:
        return None
    values = [_integer(off.get("x")), _integer(off.get("y")), _integer(ext.get("cx")), _integer(ext.get("cy"))]
    if None in values or values[2] <= 0 or values[3] <= 0:
        return None
    return off, ext, values


def _text_info(shape):
    """Return (text, editable run or None, explicit font size or None), or None if not a flat text box."""
    properties = shape.find("p:nvSpPr/p:cNvSpPr", NS)
    body = shape.find("p:txBody", NS)
    if properties is None or properties.get("txBox") not in {"1", "true"} or body is None or shape.find("p:nvSpPr/p:nvPr/p:ph", NS) is not None:
        return None
    if any(child.tag not in TEXT_BODY_CHILDREN for child in body):
        return None
    paragraphs, runs, breaks = [], [], 0
    for paragraph in body.findall("a:p", NS):
        if any(child.tag not in PARAGRAPH_CHILDREN for child in paragraph):
            return None
        pieces = []
        for child in paragraph:
            if child.tag == _a("r"):
                texts = child.findall("a:t", NS)
                if len(texts) != 1 or any(item.tag not in {_a("rPr"), _a("t")} for item in child):
                    return None
                runs.append(child)
                pieces.append(texts[0].text or "")
            elif child.tag == _a("br"):
                breaks += 1
                pieces.append("\n")
        paragraphs.append("".join(pieces))
    text = "\n".join(paragraphs)
    run = runs[0] if len(runs) == 1 and len(paragraphs) == 1 and not breaks else None
    size = None
    if run is not None:
        properties = run.find("a:rPr", NS)
        value = _integer(properties.get("sz")) if properties is not None else None
        if value is not None and MIN_FONT_SIZE <= value <= MAX_FONT_SIZE:
            size = value
    return text, run, size


@lru_cache(maxsize=1)
def _installed_font_families():
    try:
        fonts = subprocess.run(
            ["fc-list", "--format=%{family}\n"], check=True, capture_output=True,
            text=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return {name.strip().casefold() for row in fonts.splitlines() for name in row.split(",") if name.strip()}


def _explicit_font(shape, run):
    latin = run.find("a:rPr/a:latin", NS) if run is not None else None
    family = latin.get("typeface", "") if latin is not None else ""
    if not family or family.startswith("+") or len(family) > 120:
        return {}
    installed = _installed_font_families()
    result = {"fontFamily": family}
    if installed is not None:
        result["fontAvailable"] = family.casefold() in installed
    body = shape.find("p:txBody/a:bodyPr", NS)
    if body is not None:
        result["textInsetX"] = sum(_integer(body.get(key, "91440")) or 0 for key in ("lIns", "rIns"))
    return result


def _elements(root):
    """Compatible shapes of one slide: [(public dict, xfrm parts, run or None)]."""
    tree = root.find("p:cSld/p:spTree", NS)
    if tree is None:
        return []
    ids = Counter(item.get("id") for item in root.iter(_p("cNvPr")))
    found = []
    for shape in tree:
        if shape.tag == _p("sp"):
            cnv, text = shape.find("p:nvSpPr/p:cNvPr", NS), _text_info(shape)
            if text is None:
                continue
        elif shape.tag == _p("pic"):
            cnv, text = shape.find("p:nvPicPr/p:cNvPr", NS), ("", None, None)
            blip = shape.find("p:blipFill/a:blip", NS)
            if blip is None or not blip.get(f"{{{R}}}embed"):
                continue
        else:
            continue
        box = _xfrm(shape)
        shape_id = cnv.get("id") if cnv is not None else None
        if box is None or not shape_id or not re.fullmatch(r"\d{1,10}", shape_id) or ids[shape_id] != 1 or cnv.get("hidden") in {"1", "true"}:
            continue
        off, ext, (x, y, width, height) = box
        item = {"id": shape_id, "x": x, "y": y, "width": width, "height": height, "text": text[0], "editable": text[1] is not None}
        if text[1] is not None and text[2] is not None:
            item["fontSize"] = text[2]
        found.append((item, (off, ext), text[1], shape))
    return found


def inspect_slide(source, slide_index):
    """Return {width, height, elements} (EMU) for the 0-based ``slide_index``."""
    if not _is_int(slide_index) or slide_index < 0:
        raise ValueError("invalid-studio-edits")
    validate_office(source, "pptx")
    with zipfile.ZipFile(source) as archive:
        width, height = _slide_size(archive)
        parts = slide_parts(archive)
        if slide_index >= len(parts):
            raise ValueError("invalid-studio-edits")
        root = _parse(read_part(archive, parts[slide_index]))
    elements = _elements(root)
    response = []
    remaining_text = 48000
    for item, _box, run, shape in elements[:MAX_VISIBLE_ELEMENTS]:
        limit = min(remaining_text, 3000)
        if len(item["text"]) > limit:
            item["text"] = item["text"][:limit]
            item["editable"] = False
            item.pop("fontSize", None)
        remaining_text -= len(item["text"])
        response.append({**item, **_explicit_font(shape, run)})
    return {"width": width, "height": height, "elements": response, "truncated": len(elements) > MAX_VISIBLE_ELEMENTS}


def _apply_edit(edit, found):
    current = next((entry for entry in found if entry[0]["id"] == edit["id"]), None)
    if current is None:
        raise ValueError("studio-element-not-found")
    item, (off, ext), run, _shape = current
    if "text" in edit or "fontSize" in edit:
        if run is None or ("fontSize" in edit and "fontSize" not in item):
            raise ValueError("studio-edit-unsupported")
    x, y = edit.get("x", item["x"]), edit.get("y", item["y"])
    width, height = edit.get("width", item["width"]), edit.get("height", item["height"])
    off.set("x", str(x))
    off.set("y", str(y))
    ext.set("cx", str(width))
    ext.set("cy", str(height))
    if "text" in edit:
        run.find("a:t", NS).text = edit["text"]
    if "fontSize" in edit:
        run.find("a:rPr", NS).set("sz", str(edit["fontSize"]))


def apply_studio_edits(source, target, edits):
    """Write ``target`` = ``source`` with validated ``edits`` applied; ``source`` is untouched."""
    edits = parse_studio_edits(edits)
    if edits is None:
        raise ValueError("invalid-studio-edits")
    validate_office(source, "pptx")
    try:
        with zipfile.ZipFile(source) as archive:
            parts = slide_parts(archive)
            if len(set(parts)) != len(parts):
                raise ValueError("invalid-office-file")
            by_part = {}
            for edit in edits:
                if edit["slideIndex"] >= len(parts):
                    raise ValueError("studio-element-not-found")
                by_part.setdefault(parts[edit["slideIndex"]], []).append(edit)
            names = {item.filename for item in archive.infolist()}
            if not set(by_part) <= names:
                raise ValueError("invalid-office-file")
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as output:
                for item in archive.infolist():
                    if item.filename not in by_part:
                        copy_member(archive, item, output)
                        continue
                    raw = read_part(archive, item.filename)
                    root = _parse(raw)
                    found = _elements(root)
                    for edit in by_part[item.filename]:
                        _apply_edit(edit, found)
                    output.writestr(clone_zipinfo(item), serialize_part(root, raw))
    except BaseException:
        Path(target).unlink(missing_ok=True)
        raise
