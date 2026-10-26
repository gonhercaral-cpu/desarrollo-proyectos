"""Local processor contract tests. No cloud, credentials or LibreOffice."""
import hashlib
import os
from pathlib import Path
import struct
import tempfile
import time
import unittest
from unittest.mock import patch

import app as processor
from builds import analyze_pptx
from test_gifs import make_gif, make_pptx, pic_xml, text_xml

REVISION = "12345678-1234-1234-1234-123456789abc"


def png():
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + struct.pack(">II", 1600, 1200)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.gif = make_gif(frames=3, transparent=True)
        self.source = make_pptx(self.root / "deck.pptx", [(text_xml(2) + pic_xml(10, "rId2", 914400, 685800, 2743200, 2743200), {"rId2": "../media/a.gif"}, "")], media={"a.gif": self.gif})
        self.environment = patch.dict(os.environ, {"STORAGE_BUCKET": "local-test"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def grant(self, asset):
        return "https://storage.googleapis.com/local-test/" + processor.animation_path(REVISION, 0, asset) + "?X-Goog-Signature=test"

    def data(self):
        return {"revision": REVISION, "animationUploadUrls": [{"slideIndex": 0, "backgroundUrl": self.grant("background"), "imageUrls": [self.grant("gif-0")]}]}

    def test_plan_maps_pixel_dimensions_to_percentages_and_keeps_static_state(self):
        plan = processor.pptx_plan(self.source)
        self.assertEqual(plan["stateCount"], analyze_pptx(self.source)["stateCount"])
        image = plan["animationPlan"][0]["images"][0]
        self.assertEqual((image["x"], image["y"], image["width"], image["height"]), (10, 10, 30, 40))
        self.assertEqual(image["sha256"], hashlib.sha256(self.gif).hexdigest())

    def test_optional_analysis_failure_keeps_static_plan(self):
        with patch("app.analyze_pptx_gifs", side_effect=ValueError("bad-image")):
            plan = processor.pptx_plan(self.source)
        self.assertEqual(plan["animationPlan"], [])
        self.assertEqual(plan["stateCount"], 1)
        self.assertIn("gif-analysis-static-fallback", plan["slides"][0]["warnings"])

    def test_original_gif_and_background_upload_to_exact_grants(self):
        plan = processor.pptx_plan(self.source)
        source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        uploads = []

        def convert(source, extension, workspace, **_kwargs):
            target = Path(workspace) / "background.pdf"
            target.write_bytes(b"%PDF-1.4")
            return {"path": target}

        def raster(command, **_kwargs):
            Path(command[-1] + ".png").write_bytes(png())

        def upload(url, path, mime, _deadline):
            content = path.read_bytes()
            uploads.append((url, content, mime))
            return {"sizeBytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}

        with patch("app.convert_office", convert), patch("app.subprocess.run", raster), patch("app.upload_animation_file", upload):
            results = processor.upload_animations(self.data(), self.source, self.root, plan, time.monotonic() + 100)
        self.assertEqual(len(results), 1)
        self.assertEqual(uploads[0][0], self.grant("background"))
        self.assertEqual(uploads[1], (self.grant("gif-0"), self.gif, "image/gif"))
        self.assertEqual(results[0]["background"]["width"], 1600)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), source_hash)
        self.assertFalse(list(self.root.glob("hybrid-*")))

    def test_invalid_capability_budget_and_network_failure_fall_back(self):
        plan = processor.pptx_plan(self.source)
        data = self.data(); data["animationUploadUrls"][0]["imageUrls"][0] = "https://evil.test/upload"
        with patch("app.convert_office") as convert:
            self.assertEqual(processor.upload_animations(data, self.source, self.root, plan, time.monotonic() + 100), [])
            self.assertEqual(processor.upload_animations(self.data(), self.source, self.root, plan, time.monotonic() + 1), [])
            convert.assert_not_called()
        with patch("app.convert_office", side_effect=OSError("interrupted")):
            self.assertEqual(processor.upload_animations(self.data(), self.source, self.root, plan, time.monotonic() + 100), [])

    def test_primary_states_are_uploaded_and_removed_during_rasterization(self):
        data = {"processorVersion": "pptx-builds-png-v2", "revision": REVISION, "stateUploadUrls": ["https://storage.googleapis.com/local-test/" + processor.raster_path(REVISION, 0) + "?X-Goog-Signature=test"]}
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return False
        def render(_source, workspace, _plan, on_state=None, **_kwargs):
            path = Path(workspace) / "state.png"; content = png(); path.write_bytes(content)
            state = {"path": path, "sizeBytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
            on_state(0, state)
            self.assertNotIn("path", state)
            return [state]
        with patch("app.render_pptx", render), patch("app.urlopen", return_value=Response()):
            result = processor.upload_pngs(data, self.source, self.root)
        self.assertEqual(result["states"][0]["width"], 1600)
        self.assertEqual(result["animations"], [])

    def test_public_errors_never_echo_document_details(self):
        self.assertEqual(processor.public_conversion_error(ValueError("https://private.test/token")), "conversion-failed")
        self.assertEqual(processor.public_conversion_error(TimeoutError()), "conversion-timeout")


if __name__ == "__main__":
    unittest.main()
