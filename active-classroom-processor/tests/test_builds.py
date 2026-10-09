import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from xml.etree import ElementTree as ET
from pypdf import PdfReader
from builds import P, NS, analyze_pptx, click_steps, state_pptx, render_pptx, slide_parts
from converter import convert_office
from test_converter import office_fixture


def interactive_fixture(workspace, unsupported=False):
    source = office_fixture(workspace, "pptx")
    target = Path(workspace) / "interactive.pptx"
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        part = slide_parts(archive)[0]
        for item in archive.infolist():
            data = archive.read(item)
            if item.filename == part:
                root = ET.fromstring(data)
                tree = root.find("p:cSld/p:spTree", NS)
                original = root.find("p:cSld/p:spTree/p:sp", NS)
                for index in [1, 2]:
                    answer = copy.deepcopy(original)
                    answer.find("p:nvSpPr/p:cNvPr", NS).set("id", str(99 + index))
                    answer.find(".//a:t", NS).text = f"Answer {index}"
                    # Position answers separately so pixel hashes differ visibly.
                    offset = answer.find("p:spPr/a:xfrm/a:off", NS)
                    if offset is not None:
                        offset.set("y", str(2000000 * index))
                    tree.append(answer)
                timing = ET.SubElement(root, f"{{{P}}}timing")
                timing.append(ET.fromstring(f'''<p:tnLst xmlns:p="{P}"><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>
                  <p:par><p:cTn id="3" nodeType="clickEffect" presetClass="entr" presetID="1"><p:childTnLst><p:set><p:cBhvr><p:cTn id="4" dur="1"/><p:tgtEl><p:spTgt spid="100"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par>
                  <p:par><p:cTn id="5" nodeType="clickEffect" presetClass="entr" presetID="10"><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="6" dur="500"/><p:tgtEl><p:spTgt spid="101"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>
                </p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>'''))
                if unsupported:
                    timing.find(".//p:cTn[@id='5']", NS).set("presetClass", "path")
                data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            output.writestr(item, data)
    return target


class BuildTests(unittest.TestCase):
    def test_no_animation_keeps_static_order(self):
        with tempfile.TemporaryDirectory() as workspace:
            source = office_fixture(workspace, "pptx")
            plan = analyze_pptx(source)
            self.assertEqual(plan["stateCount"], 3)
            self.assertEqual([slide["steps"] for slide in plan["slides"]], [[], [], []])

    def test_click_appear_and_fade_rasterize_exact_states_without_mutating_source(self):
        with tempfile.TemporaryDirectory() as workspace:
            source = interactive_fixture(workspace)
            original = hashlib.sha256(source.read_bytes()).hexdigest()
            plan = analyze_pptx(source)
            self.assertEqual(plan["slides"][0]["steps"], [["100"], ["101"]])
            self.assertEqual(plan["stateCount"], 5)
            target = Path(workspace) / "verify.pptx"
            state_pptx(source, target, plan)
            conversion_dir = Path(workspace) / "verify"
            conversion_dir.mkdir()
            pdf = convert_office(target, "pptx", conversion_dir)
            text = [page.extract_text() for page in PdfReader(pdf["path"]).pages]
            self.assertIn("Classroom slide 1", text[0])
            self.assertNotIn("Answer 1", text[0])
            self.assertIn("Answer 1", text[1])
            self.assertNotIn("Answer 2", text[1])
            self.assertIn("Answer 2", text[2])
            raster_dir = Path(workspace) / "raster"
            raster_dir.mkdir()
            states = render_pptx(source, raster_dir, plan)
            self.assertEqual(len(states), 5)
            self.assertEqual(len({state["sha256"] for state in states[:3]}), 3)
            for state in states:
                self.assertEqual(state["sha256"], hashlib.sha256(state["path"].read_bytes()).hexdigest())
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)

    def test_unsupported_animation_falls_back_to_static(self):
        with tempfile.TemporaryDirectory() as workspace:
            plan = analyze_pptx(interactive_fixture(workspace, unsupported=True))
            self.assertEqual(plan["slides"][0]["steps"], [])
            self.assertTrue(plan["slides"][0]["warnings"])
            self.assertEqual(plan["stateCount"], 3)

    def test_object_trigger_timing_and_paragraph_targets_fail_safe(self):
        template = f'<p:sld xmlns:p="{P}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr></p:sp></p:spTree></p:cSld><p:timing><p:cTn nodeType="clickEffect" presetClass="entr" presetID="1"><p:spTgt spid="2"/></p:cTn></p:timing></p:sld>'
        for value in [template.replace('clickEffect', 'afterEffect'), template.replace('<p:spTgt spid="2"/>', '<p:spTgt spid="2"><p:txEl><p:pRg st="0" end="0"/></p:txEl></p:spTgt>'), template.replace('<p:timing>', '<p:timing><p:cTn nodeType="interactiveSeq"/>')]:
            steps, warnings = click_steps(ET.fromstring(value))
            self.assertEqual(steps, [])
            self.assertTrue(warnings)


if __name__ == "__main__":
    unittest.main()
