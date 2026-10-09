"""Conservative PresentationML click entrances; rasterize cumulative final states.

No animation engine. Unsupported timing leaves the entire slide static and reports
a warning. Original source ZIP is never modified. Raster pages share PPTX media.
"""
import copy
import hashlib
import posixpath
from pathlib import Path
import subprocess
import shutil
import zipfile
from xml.etree import ElementTree as ET
from converter import convert_office, file_integrity, validate_office

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"p": P, "a": A, "r": R}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)


def slide_parts(archive):
    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
    relationships = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
    targets = {item.get("Id"): posixpath.normpath("ppt/" + item.get("Target")) for item in relationships}
    return [targets[item.get(f"{{{R}}}id")] for item in presentation.findall("p:sldIdLst/p:sldId", NS)]


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
        if (effect.get("nodeType") != "clickEffect" or effect.get("presetClass") != "entr"
                or effect.get("presetID") not in {"1", "10"} or not target_ids
                or any(target.get("spid") not in shapes or len(target) for target in targets)
                or any(value in seen for value in target_ids)
                or any(effect.find(f".//p:{tag}", NS) is not None for tag in ["animMotion", "animRot", "animScale", "cmd", "audio", "video"])
                or any(item.get("transition") != "in" or item.get("filter") != "fade" for item in effect.findall(".//p:animEffect", NS))
                or any(item.get("evt") not in {None, "onBegin"} or item.get("delay", "0") not in {"0", "indefinite"} for item in effect.findall("p:stCondLst/p:cond", NS))):
            return [], ["unsupported-animation"]
        steps.append(target_ids)
        seen.update(target_ids)
    if len(steps) > 50:
        return [], ["too-many-builds"]
    return steps, []


def analyze_pptx(source):
    validate_office(source, "pptx")
    with zipfile.ZipFile(source) as archive:
        parts = slide_parts(archive)
        slides = []
        for index, part in enumerate(parts):
            steps, warnings = click_steps(ET.fromstring(archive.read(part)))
            slides.append({"index": index, "steps": steps, "warnings": warnings})
    if not 0 < len(slides) <= 200 or sum(len(slide["steps"]) + 1 for slide in slides) > 200:
        raise ValueError("too-many-raster-states")
    return {"slides": slides, "stateCount": sum(len(slide["steps"]) + 1 for slide in slides)}


def state_pptx(source, target, plan):
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        parts = slide_parts(archive)
        presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
        rels = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
        types = ET.fromstring(archive.read("[Content_Types].xml"))
        ids = presentation.find("p:sldIdLst", NS)
        ids.clear()
        number = 0
        for slide in plan["slides"]:
            part = parts[slide["index"]]
            original = ET.fromstring(archive.read(part))
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
                output.writestr(name, ET.tostring(root, encoding="utf-8", xml_declaration=True))
                original_rels = posixpath.dirname(part) + "/_rels/" + posixpath.basename(part) + ".rels"
                if original_rels in archive.namelist():
                    output.writestr(f"ppt/slides/_rels/classroomState{number}.xml.rels", archive.read(original_rels))
                rel_id = f"classroomState{number}"
                ET.SubElement(rels, f"{{{PKG}}}Relationship", {"Id": rel_id, "Type": R + "/slide", "Target": f"slides/classroomState{number}.xml"})
                ET.SubElement(ids, f"{{{P}}}sldId", {"id": str(100000 + number), f"{{{R}}}id": rel_id})
                ET.SubElement(types, f"{{{CT}}}Override", {"PartName": "/" + name, "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"})
        replacements = {"ppt/presentation.xml": presentation, "ppt/_rels/presentation.xml.rels": rels, "[Content_Types].xml": types}
        for item in archive.infolist():
            if item.filename in replacements:
                output.writestr(item, ET.tostring(replacements[item.filename], encoding="utf-8", xml_declaration=True))
            else:
                with archive.open(item) as stream, output.open(item, "w") as destination:
                    shutil.copyfileobj(stream, destination, 65536)


def render_pptx(source, workspace, plan):
    workspace = Path(workspace)
    states = workspace / "states.pptx"
    state_pptx(source, states, plan)
    result = convert_office(states, "pptx", workspace)
    if result["pageCount"] != plan["stateCount"]:
        raise ValueError("raster-page-mismatch")
    prefix = workspace / "state"
    subprocess.run(["pdftoppm", "-png", "-scale-to", "1600", str(result["path"]), str(prefix)], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pages = sorted(workspace.glob("state-*.png"), key=lambda path: int(path.stem.split("-")[-1]))
    if len(pages) != plan["stateCount"]:
        raise ValueError("raster-state-mismatch")
    results = []
    for path in pages:
        size, checksum = file_integrity(path)
        results.append({"path": path, "sizeBytes": size, "sha256": checksum})
    return results


def raster_path(revision, index):
    return "active-classroom/publications/files/" + hashlib.sha256(f"{revision}:state:{index}".encode()).hexdigest()
