"""Build planning, raster batching and GIF overlay analysis. No LibreOffice required."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from xml.etree import ElementTree as ET
import builds
from builds import (NS, analyze_pptx, analyze_pptx_gifs, read_certified_gifs, render_pptx,
                    state_pptx, write_gif_background_pptx)
from test_gifs import digest, make_gif, make_pptx, members, pic_xml, text_xml

GIF = make_gif()
BOX = (914400, 685800, 2743200, 2743200)  # 10%, 10%, 30%, 40% of a 4:3 slide; square like the GIF


def timing_xml(ids):
    pars = "".join(
        f'<p:par><p:cTn id="{10 + i}" nodeType="clickEffect" presetClass="entr" presetID="1"><p:childTnLst><p:set><p:cBhvr>'
        f'<p:cTn id="{50 + i}" dur="1"/><p:tgtEl><p:spTgt spid="{shape}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
        f'</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par>' for i, shape in enumerate(ids))
    return (f'<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq">'
            f'<p:childTnLst>{pars}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')


class TempCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def gif_deck(self, shapes, timing="", media=None, name="deck.pptx", **kwargs):
        return make_pptx(self.root / name, [(shapes, {"rId2": "../media/a.gif", "rId3": "../media/b.gif"}, timing)],
                         media=media or {"a.gif": GIF, "b.gif": make_gif(frames=2)}, **kwargs)


class AnalyzeStatesTests(TempCase):
    def build_deck(self, slides, name="builds.pptx"):
        return make_pptx(self.root / name, [(text_xml(100), {}, timing_xml(["100"])) for _ in range(slides)])

    def test_over_200_states_with_200_or_fewer_slides_degrades_to_static(self):
        plan = analyze_pptx(self.build_deck(101))
        self.assertEqual(plan["stateCount"], 101)
        for slide in plan["slides"]:
            self.assertEqual((slide["steps"], slide["warnings"]), ([], ["states-limit-static"]))

    def test_exactly_200_states_keeps_builds(self):
        plan = analyze_pptx(self.build_deck(100))
        self.assertEqual(plan["stateCount"], 200)
        self.assertEqual(plan["slides"][0]["steps"], [["100"]])

    def test_more_than_200_slides_still_fails(self):
        source = make_pptx(self.root / "many.pptx", [("", {}, "")] * 201)
        with self.assertRaises(ValueError):
            analyze_pptx(source)


class StatePptxTests(TempCase):
    def test_states_keep_original_gif_media_and_source_is_untouched(self):
        shapes = text_xml(100) + text_xml(101) + pic_xml(10, "rId2", *BOX)
        source = make_pptx(self.root / "deck.pptx", [(shapes, {"rId2": "../media/a.gif"}, timing_xml(["100"])), (text_xml(5), {}, "")], media={"a.gif": GIF})
        before, original = digest(source), members(source)
        plan = analyze_pptx(source)
        self.assertEqual(plan["stateCount"], 3)
        target = self.root / "states.pptx"
        state_pptx(source, target, plan)
        self.assertEqual(digest(source), before)
        self.assertIsNone(zipfile.ZipFile(target).testzip())
        result = members(target)
        self.assertEqual(result["ppt/media/a.gif"], original["ppt/media/a.gif"])
        self.assertEqual(len(ET.fromstring(result["ppt/presentation.xml"]).findall("p:sldIdLst/p:sldId", NS)), 3)
        first, second = result["ppt/slides/classroomState1.xml"], result["ppt/slides/classroomState2.xml"]
        self.assertNotIn(b'id="100"', first)
        self.assertIn(b'id="100"', second)
        for state in [first, second]:
            self.assertIn(b"<p:pic>", state)
            self.assertNotIn(b"p:timing", state)
        self.assertIn("ppt/slides/_rels/classroomState1.xml.rels", result)


class RenderBatchTests(TempCase):
    def setUp(self):
        super().setUp()
        self.source = make_pptx(self.root / "deck.pptx", [(text_xml(2), {}, "")] * 45)
        self.plan = analyze_pptx(self.source)
        self.work = self.root / "work"
        self.work.mkdir()
        self.calls = []
        self.pages_per_batch_offset = 0

    def fake_convert(self, states, extension, workspace, timeout=180):
        self.assertTrue(Path(states).exists())
        pdf = Path(workspace) / "states.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        return {"path": pdf, "pageCount": self.page_count}

    def fake_run(self, command, **kwargs):
        first, last = int(command[command.index("-f") + 1]), int(command[command.index("-l") + 1])
        self.calls.append((first, last, kwargs["timeout"]))
        for number in range(first, last + 1 - self.pages_per_batch_offset):
            Path(f"{command[-1]}-{number:02d}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes([number]))

    def render(self, **kwargs):
        with patch("builds.convert_office", self.fake_convert), patch("builds.subprocess.run", self.fake_run):
            return render_pptx(self.source, self.work, self.plan, **kwargs)

    def test_pages_are_rasterized_in_ordered_batches_and_temp_files_removed(self):
        self.page_count = 45
        results = self.render()
        self.assertEqual(sorted(call[:2] for call in self.calls), [(1, 10), (11, 20), (21, 30), (31, 40), (41, 43), (44, 45)])
        self.assertTrue(all(call[2] <= 120 for call in self.calls))
        self.assertEqual(len(results), 45)
        for index, state in enumerate(results, start=1):
            data = state["path"].read_bytes()
            self.assertEqual(data[-1], index)
            self.assertEqual((state["sizeBytes"], state["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
        self.assertFalse((self.work / "states.pptx").exists())
        self.assertFalse((self.work / "states.pdf").exists())

    def test_missing_pages_and_page_count_mismatch_fail(self):
        self.page_count, self.pages_per_batch_offset = 45, 1
        with self.assertRaisesRegex(ValueError, "raster-state-mismatch"):
            self.render()
        self.assertFalse((self.work / "states.pptx").exists())
        self.page_count = 44
        with self.assertRaisesRegex(ValueError, "raster-page-mismatch"):
            self.render()

    def test_total_deadline_is_enforced_and_cleans_up(self):
        self.page_count = 45
        with self.assertRaises(subprocess.TimeoutExpired):
            self.render(deadline_seconds=0)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.work / "states.pptx").exists())

    def test_upload_consumer_releases_batch_files_before_next_batch(self):
        self.page_count = 45
        original_run = self.fake_run
        uploaded = []
        def raster(command, **kwargs):
            first = int(command[command.index("-f") + 1])
            batch_start = ((first - 1) // 20) * 20 + 1
            self.assertFalse([path for path in self.work.glob("state-b*-*.png") if int(path.stem.split("-")[1][1:]) < batch_start])
            original_run(command, **kwargs)
        def upload(index, state):
            uploaded.append((index, state["path"].read_bytes()[-1]))
            del state["path"]
        with patch("builds.convert_office", self.fake_convert), patch("builds.subprocess.run", raster):
            results = render_pptx(self.source, self.work, self.plan, on_state=upload)
        self.assertEqual(uploaded, [(index, index + 1) for index in range(45)])
        self.assertFalse(list(self.work.glob("state-*.png")))
        self.assertTrue(all("path" not in state for state in results))


class GifOverlayAnalysisTests(TempCase):
    def test_certified_gif_metadata_and_percent_coordinates(self):
        source = self.gif_deck(text_xml(2) + pic_xml(10, "rId2", *BOX))
        result = analyze_pptx_gifs(source)
        self.assertEqual((result["version"], result["warnings"]), ("pptx-gif-overlays-v1", []))
        self.assertEqual(result["slideSize"], {"cx": 9144000, "cy": 6858000})
        (image,) = result["images"]
        expected = {"slideIndex": 0, "slidePart": "ppt/slides/slide1.xml", "shapeId": "10", "zIndex": 0,
                    "zipPart": "ppt/media/a.gif", "sha256": hashlib.sha256(GIF).hexdigest(), "sizeBytes": len(GIF),
                    "width": 4, "height": 4, "frameCount": 3, "hasTransparency": False}
        for key, value in expected.items():
            self.assertEqual(image[key], value, key)
        for key, value in {"x": 10.0, "y": 10.0, "w": 30.0, "h": 40.0}.items():
            self.assertAlmostEqual(image[key], value, places=3)

    def test_order_is_z_order_of_contiguous_top_suffix(self):
        source = self.gif_deck(text_xml(2) + pic_xml(10, "rId2", *BOX) + pic_xml(11, "rId3", 5000000, 685800, 1000000, 1000000))
        images = analyze_pptx_gifs(source)["images"]
        self.assertEqual([(i["shapeId"], i["zIndex"], i["zipPart"]) for i in images], [("10", 0, "ppt/media/a.gif"), ("11", 1, "ppt/media/b.gif")])

    def test_rejections_reject_the_whole_slide_with_a_warning(self):
        pic = pic_xml(10, "rId2", *BOX)
        group = f'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="30" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{pic}</p:grpSp>'
        fill = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'
        cases = [
            ("rotation", pic_xml(10, "rId2", *BOX, xfrm_attrs=' rot="5400000"'), "pic-transformed"),
            ("flip", pic_xml(10, "rId2", *BOX, xfrm_attrs=' flipH="1"'), "pic-transformed"),
            ("crop", pic_xml(10, "rId2", *BOX, fill_children='<a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch>'), "pic-cropped"),
            ("tile", pic_xml(10, "rId2", *BOX, fill_children="<a:tile/>"), "pic-fill"),
            ("effect", pic_xml(10, "rId2", *BOX, blip_children='<a:alphaModFix amt="50000"/>'), "pic-blip-effects"),
            ("border", pic_xml(10, "rId2", *BOX, shape_children=f"<a:ln w=\"9525\">{fill}</a:ln>"), "pic-border"),
            ("shape-fill", pic_xml(10, "rId2", *BOX, shape_children=fill), "pic-shape-properties"),
            ("outside", pic_xml(10, "rId2", 8000000, 685800, 2743200, 2743200), "pic-out-of-slide"),
            ("aspect", pic_xml(10, "rId2", 914400, 685800, 2743200, 1371600), "pic-aspect-mismatch"),
            ("hidden", pic.replace('name="Pic 10"', 'name="Pic 10" hidden="1"'), "pic-hidden-or-unidentified"),
            ("covered", pic + text_xml(3), "gif-not-top-suffix"),
            ("group", group, "gif-not-top-suffix"),
            ("duplicate-id", pic + pic_xml(10, "rId3", 5000000, 685800, 1000000, 1000000), "duplicate-shape-id"),
            ("too-many", "".join(pic_xml(10 + i, "rId2", 0, 0, 914400, 914400) for i in range(9)), "too-many-gifs-on-slide"),
        ]
        for label, shapes, code in cases:
            with self.subTest(label):
                result = analyze_pptx_gifs(self.gif_deck(text_xml(2) + shapes))
                self.assertEqual((result["images"], result["warnings"]), ([], [f"slide-0:{code}"]))

    def test_timing_rejects_slide(self):
        source = self.gif_deck(text_xml(2) + pic_xml(10, "rId2", *BOX), timing=timing_xml(["2"]))
        self.assertEqual(analyze_pptx_gifs(source)["warnings"], ["slide-0:slide-has-timing"])

    def test_other_slides_are_independent(self):
        rels = {"rId2": "../media/a.gif"}
        source = make_pptx(self.root / "two.pptx", [
            (pic_xml(10, "rId2", *BOX, xfrm_attrs=' rot="1"'), rels, ""),
            (pic_xml(11, "rId2", *BOX), rels, "")], media={"a.gif": GIF})
        result = analyze_pptx_gifs(source)
        self.assertEqual([image["slideIndex"] for image in result["images"]], [1])
        self.assertEqual(result["warnings"], ["slide-0:pic-transformed"])

    def test_presentation_limit_rejects_whole_slide(self):
        rels = {"rId2": "../media/a.gif"}
        slide = ("".join(pic_xml(10 + i, "rId2", 0, 0, 914400, 914400) for i in range(7)), rels, "")
        result = analyze_pptx_gifs(make_pptx(self.root / "five.pptx", [slide] * 5, media={"a.gif": GIF}))
        self.assertEqual(len(result["images"]), 28)
        self.assertEqual(result["warnings"], ["slide-4:presentation-gif-limit"])

    def test_not_certified_gifs_fall_back_to_static(self):
        shapes = pic_xml(10, "rId2", *BOX)
        cases = [
            ("static", {"a.gif": make_gif(frames=1)}, []),
            ("corrupt", {"a.gif": b"GIF89a-broken"}, ["slide-0:gif-invalid-static"]),
            ("truncated", {"a.gif": GIF[:-10]}, ["slide-0:gif-invalid-static"]),
            ("oversize", {"a.gif": make_gif(after_first=bytes(16 * 1024 * 1024))}, ["slide-0:gif-over-budget-static"]),
        ]
        for label, media, warnings in cases:
            with self.subTest(label):
                result = analyze_pptx_gifs(self.gif_deck(shapes, media=media))
                self.assertEqual((result["images"], result["warnings"]), ([], warnings))

    def test_pixel_budget_and_slide_size(self):
        source = self.gif_deck(pic_xml(10, "rId2", *BOX))
        with patch.object(builds, "MAX_OVERLAY_CANVAS_PIXELS", 10):
            result = analyze_pptx_gifs(source)
        self.assertEqual((result["images"], result["warnings"]), ([], ["slide-0:gif-over-budget-static"]))
        bad = self.gif_deck(pic_xml(10, "rId2", *BOX), name="size.pptx", size=(0, 100))
        self.assertEqual(analyze_pptx_gifs(bad), {"version": "pptx-gif-overlays-v1", "slideSize": {"cx": 0, "cy": 0}, "images": [], "warnings": ["presentation:invalid-slide-size"]})

    def test_analysis_does_not_modify_source(self):
        source = self.gif_deck(pic_xml(10, "rId2", *BOX))
        before = digest(source)
        analyze_pptx_gifs(source)
        self.assertEqual(digest(source), before)


class GifBackgroundTests(TempCase):
    def test_background_copy_removes_only_certified_pictures(self):
        shapes = text_xml(2) + pic_xml(10, "rId2", *BOX)
        source = make_pptx(self.root / "deck.pptx", [(shapes, {"rId2": "../media/a.gif"}, ""), (text_xml(3), {}, "")], media={"a.gif": GIF})
        before, original = digest(source), members(source)
        analysis = analyze_pptx_gifs(source)
        target = self.root / "background.pptx"
        write_gif_background_pptx(source, target, analysis["images"])
        self.assertEqual(digest(source), before)
        result = members(target)
        self.assertEqual(list(result), list(original))
        self.assertNotIn(b"Pic 10", result["ppt/slides/slide1.xml"])
        self.assertIn(b'name="T2"', result["ppt/slides/slide1.xml"])
        for name in original:
            if name != "ppt/slides/slide1.xml":
                self.assertEqual(result[name], original[name], name)
        self.assertEqual(analyze_pptx_gifs(target)["images"], [])

    def test_partial_tampered_or_empty_selection_is_refused(self):
        source = self.gif_deck(text_xml(2) + pic_xml(10, "rId2", *BOX) + pic_xml(11, "rId3", 5000000, 685800, 1000000, 1000000))
        images = analyze_pptx_gifs(source)["images"]
        target = self.root / "background.pptx"
        cases = [("partial", images[:1], "partial-slide-selection"), ("empty", [], "no-gif-selected"),
                 ("sha", [{**images[0], "sha256": "0" * 64}, images[1]], "gif-not-certified"),
                 ("shape", [{**images[0], "shapeId": "99"}, images[1]], "gif-not-certified"),
                 ("part", [{**images[0], "zipPart": "ppt/media/b.gif"}, images[1]], "gif-not-certified")]
        for label, selection, code in cases:
            with self.subTest(label), self.assertRaisesRegex(ValueError, code):
                write_gif_background_pptx(source, target, selection)
            self.assertFalse(target.exists())

    def test_slide_with_uncertain_composition_is_never_rewritten(self):
        source = self.gif_deck(pic_xml(10, "rId2", *BOX, xfrm_attrs=' rot="5400000"'))
        forged = [{"slidePart": "ppt/slides/slide1.xml", "shapeId": "10", "zipPart": "ppt/media/a.gif", "sha256": hashlib.sha256(GIF).hexdigest(), "sizeBytes": len(GIF)}]
        with self.assertRaisesRegex(ValueError, "gif-not-certified"):
            write_gif_background_pptx(source, self.root / "background.pptx", forged)

    def test_original_gif_bytes_are_extracted_with_hash_check(self):
        source = self.gif_deck(pic_xml(10, "rId2", *BOX) + pic_xml(11, "rId3", 5000000, 685800, 1000000, 1000000))
        images = analyze_pptx_gifs(source)["images"]
        extracted = list(read_certified_gifs(source, images))
        self.assertEqual([data for _image, data in extracted], [GIF, make_gif(frames=2)])
        with self.assertRaisesRegex(ValueError, "gif-hash-mismatch"):
            list(read_certified_gifs(source, [{**images[0], "sizeBytes": images[0]["sizeBytes"] + 1}]))


if __name__ == "__main__":
    unittest.main()
