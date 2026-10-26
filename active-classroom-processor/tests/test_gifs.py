"""GIF parser and PPTX GIF-freeze tests. Stdlib + pypdf; no LibreOffice required."""
import hashlib
import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
from pypdf import PdfWriter
import gifs
from converter import convert_office, validate_office
from gifs import MAX_FRAMES, PLACEHOLDER_GIF, GifError, freeze_first_frame, freeze_pptx_gifs, scan_gif

PALETTE = bytes([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
LOOP = b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NSDECL = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')


def sub_blocks(data):
    out = bytearray()
    for start in range(0, len(data), 255):
        chunk = data[start:start + 255]
        out.append(len(chunk))
        out += chunk
    return bytes(out + b"\x00")


def lzw(pixels, min_code=2):
    """Literal-only LZW with a clear code every two pixels (valid, not compressed)."""
    clear, end, size = 1 << min_code, (1 << min_code) + 1, min_code + 1
    codes = []
    for index, pixel in enumerate(pixels):
        if index % 2 == 0:
            codes.append(clear)
        codes.append(pixel)
    codes.append(end)
    out, accumulator, bits = bytearray(), 0, 0
    for code in codes:
        accumulator |= code << bits
        bits += size
        while bits >= 8:
            out.append(accumulator & 255)
            accumulator >>= 8
            bits -= 8
    if bits:
        out.append(accumulator & 255)
    return bytes([min_code]) + sub_blocks(bytes(out))


def make_gif(width=4, height=4, frames=3, transparent=False, local_palette=False, comment=None, loop=True, after_first=None):
    out = bytearray(b"GIF89a" + struct.pack("<HHBBB", width, height, 0x81, 0, 0) + PALETTE)
    if comment is not None:
        out += b"\x21\xfe" + sub_blocks(comment)
    if loop:
        out += LOOP
    for index in range(frames):
        out += b"\x21\xf9\x04" + bytes([1 if transparent else 0]) + struct.pack("<H", 10) + b"\x00\x00"
        out += b"\x2c" + struct.pack("<HHHHB", 0, 0, width, height, 0x81 if local_palette else 0)
        if local_palette:
            out += PALETTE
        out += lzw([index % 4] * (width * height))
        if index == 0 and after_first is not None:
            out += b"\x21\xfe" + sub_blocks(after_first)
    return bytes(out + b"\x3b")


def pic_xml(shape_id, rid, x, y, cx, cy, xfrm_attrs="", blip_children="", fill_children="<a:stretch><a:fillRect/></a:stretch>", shape_children=""):
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Pic {shape_id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}">{blip_children}</a:blip>{fill_children}</p:blipFill>'
            f'<p:spPr><a:xfrm{xfrm_attrs}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{shape_children}</p:spPr></p:pic>')


def text_xml(shape_id):
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="T{shape_id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>'


def make_pptx(path, slides, media=None, size=(9144000, 6858000), extra=()):
    """slides: list of (shapes_xml, {rid: relative target}, timing_xml)."""
    overrides = "".join(f'<Override PartName="/ppt/slides/slide{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(len(slides)))
    ids = "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 1}"/>' for i in range(len(slides)))
    slide_rels = "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i + 1}.xml"/>' for i in range(len(slides)))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", f'<Types xmlns="{CT_NS}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="gif" ContentType="image/gif"/>{overrides}</Types>')
        archive.writestr("ppt/presentation.xml", f'<p:presentation {NSDECL}><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="{size[0]}" cy="{size[1]}"/></p:presentation>')
        archive.writestr("ppt/_rels/presentation.xml.rels", f'<Relationships xmlns="{PKG_NS}">{slide_rels}</Relationships>')
        for index, (shapes, rels, timing) in enumerate(slides, start=1):
            archive.writestr(f"ppt/slides/slide{index}.xml", f'<p:sld {NSDECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{shapes}</p:spTree></p:cSld>{timing}</p:sld>')
            if rels:
                body = "".join(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{target}"/>' for rid, target in rels.items())
                archive.writestr(f"ppt/slides/_rels/slide{index}.xml.rels", f'<Relationships xmlns="{PKG_NS}">{body}</Relationships>')
        for name, data in (media or {}).items():
            archive.writestr(f"ppt/media/{name}", data)
        for name, data in extra:
            archive.writestr(name, data)
    return Path(path)


def members(path):
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class GifParserTests(unittest.TestCase):
    def test_frame_count_is_structural_not_byte_count(self):
        data = make_gif(frames=1, comment=b"," * 40)
        self.assertGreater(data.count(b"\x2c"), 20)
        info = scan_gif(io.BytesIO(data))
        self.assertEqual((info["frameCount"], info["complete"], info["width"], info["height"]), (1, True, 4, 4))
        self.assertEqual(scan_gif(io.BytesIO(make_gif(frames=5)))["frameCount"], 5)

    def test_palette_transparency_and_local_palette(self):
        self.assertTrue(scan_gif(io.BytesIO(make_gif(transparent=True)))["hasTransparency"])
        self.assertFalse(scan_gif(io.BytesIO(make_gif()))["hasTransparency"])
        info = scan_gif(io.BytesIO(make_gif(local_palette=True)))
        self.assertEqual((info["frameCount"], info["complete"], info["error"]), (3, True, None))
        self.assertEqual(scan_gif(io.BytesIO(make_gif(loop=False)))["frameCount"], 3)

    def test_placeholder_is_a_valid_single_frame_gif(self):
        info = scan_gif(io.BytesIO(PLACEHOLDER_GIF))
        self.assertEqual((info["frameCount"], info["complete"], info["error"], info["hasTransparency"]), (1, True, None, True))

    def test_truncated_after_first_frame_is_controlled(self):
        info = scan_gif(io.BytesIO(make_gif()[:-10]))
        self.assertEqual((info["frameCount"], info["truncated"], info["complete"], info["error"]), (2, True, False, None))

    def test_truncated_or_invalid_before_first_frame_raises(self):
        data = make_gif()
        for broken, code in [(data[:3], "truncated"), (data[:30], "truncated"), (b"GIF90a" + data[6:], "not-gif"),
                             (data[:25] + b"\x99" + data[25:], "invalid-block")]:
            with self.subTest(code=code), self.assertRaises(GifError) as caught:
                scan_gif(io.BytesIO(broken))
            self.assertEqual(caught.exception.code, code)

    def test_huge_dimensions_rejected_from_headers_only(self):
        canvas = b"GIF89a" + struct.pack("<HHBBB", 65535, 65535, 0, 0, 0) + b"\x3b"
        frame = b"GIF89a" + struct.pack("<HHBBB", 4, 4, 0, 0, 0) + b"\x2c" + struct.pack("<HHHHB", 0, 0, 65535, 65535, 0) + b"\x08"
        for data, code in [(canvas, "canvas-too-large"), (frame, "frame-too-large")]:
            with self.subTest(code=code), self.assertRaises(GifError) as caught:
                scan_gif(io.BytesIO(data))
            self.assertEqual(caught.exception.code, code)

    def test_byte_limit_and_frame_limit(self):
        with self.assertRaises(GifError) as caught:
            scan_gif(io.BytesIO(make_gif()), max_bytes=20)
        self.assertEqual(caught.exception.code, "gif-too-large")
        info = scan_gif(io.BytesIO(make_gif(frames=MAX_FRAMES + 2)))
        self.assertEqual((info["error"], info["complete"], info["frameCount"]), ("too-many-frames", False, MAX_FRAMES + 1))

    def test_stop_at_frame_does_not_read_whole_animation(self):
        data = make_gif(frames=100)
        stream = io.BytesIO(data)
        info = scan_gif(stream, stop_at_frame=2)
        self.assertTrue(info["stopped"])
        self.assertEqual(info["frameCount"], 2)
        self.assertLess(stream.tell(), len(data) // 10)


class FreezeFirstFrameTests(unittest.TestCase):
    def test_keeps_first_frame_bytes_and_gce_drops_animation(self):
        data = make_gif(frames=4, transparent=True, local_palette=True)
        frozen, _info = freeze_first_frame(io.BytesIO(data))
        info = scan_gif(io.BytesIO(frozen))
        self.assertEqual((info["frameCount"], info["complete"], info["stopped"], info["error"], info["hasTransparency"]), (1, True, False, None, True))
        self.assertIn(lzw([0] * 16), frozen)
        self.assertNotIn(lzw([1] * 16), frozen)
        self.assertIn(b"\x21\xf9\x04\x01", frozen)
        self.assertNotIn(b"NETSCAPE", frozen)
        self.assertLess(len(frozen), len(data))

    def test_damage_after_first_frame_still_freezes(self):
        frozen, _info = freeze_first_frame(io.BytesIO(make_gif()[:-10]))
        self.assertEqual(scan_gif(io.BytesIO(frozen))["frameCount"], 1)

    def test_corrupt_first_frame_raises(self):
        with self.assertRaises(GifError):
            freeze_first_frame(io.BytesIO(make_gif()[:40]))

    def test_does_not_expand_large_animation(self):
        data = make_gif(frames=500)
        stream = io.BytesIO(data)
        frozen, info = freeze_first_frame(stream)
        self.assertLess(stream.tell(), len(data) // 20)
        self.assertLess(len(frozen), 200)
        self.assertTrue(info["stopped"])


class FreezePptxTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def deck(self, media, name="deck.pptx"):
        return make_pptx(self.root / name, [("", {}, "")], media=media)

    def frame_counts(self, path):
        return {name: scan_gif(io.BytesIO(data))["frameCount"] for name, data in members(path).items() if name.startswith("ppt/media/")}

    def test_animated_gif_frozen_in_copy_original_untouched_order_kept(self):
        source = self.deck({"a.gif": make_gif(frames=3), "b.gif": make_gif(frames=6), "c.gif": make_gif(frames=1)})
        before, original = digest(source), members(source)
        target = self.root / "frozen.pptx"
        report = freeze_pptx_gifs(source, target)
        self.assertEqual(report, {"changed": True, "frozen": 2, "placeholders": 0, "warnings": ["gif-first-frame:2"]})
        self.assertEqual(digest(source), before)
        self.assertIsNone(zipfile.ZipFile(target).testzip())
        frozen = members(target)
        self.assertEqual(list(frozen), list(original))
        self.assertEqual(self.frame_counts(target), {"ppt/media/a.gif": 1, "ppt/media/b.gif": 1, "ppt/media/c.gif": 1})
        self.assertEqual(frozen["ppt/media/c.gif"], original["ppt/media/c.gif"])
        for name in original:
            if not name.startswith("ppt/media/"):
                self.assertEqual(frozen[name], original[name])

    def test_unchanged_when_no_gif_or_only_static_gifs(self):
        for media in [{"a.png": b"\x89PNG\r\n\x1a\n"}, {"a.gif": make_gif(frames=1)}]:
            target = self.root / "out.pptx"
            report = freeze_pptx_gifs(self.deck(media), target)
            self.assertEqual(report, {"changed": False, "frozen": 0, "placeholders": 0, "warnings": []})
            self.assertFalse(target.exists())

    def test_gif_with_other_extension_is_detected_by_content(self):
        target = self.root / "out.pptx"
        freeze_pptx_gifs(self.deck({"a.png": make_gif()}), target)
        self.assertEqual(self.frame_counts(target), {"ppt/media/a.png": 1})

    def test_corrupt_gifs_get_placeholder_and_do_not_abort(self):
        good = make_gif()
        source = self.deck({"bad.gif": b"GIF89a" + b"garbage" * 5, "cut.gif": good[:30], "ok.gif": good})
        target = self.root / "out.pptx"
        report = freeze_pptx_gifs(source, target)
        self.assertEqual((report["frozen"], report["placeholders"]), (1, 2))
        self.assertEqual(report["warnings"], ["gif-first-frame:1", "gif-placeholder:2"])
        frozen = members(target)
        self.assertEqual(frozen["ppt/media/bad.gif"], PLACEHOLDER_GIF)
        self.assertEqual(frozen["ppt/media/cut.gif"], PLACEHOLDER_GIF)
        validate_office(target, "pptx")

    def test_late_truncation_keeps_first_frame(self):
        target = self.root / "out.pptx"
        report = freeze_pptx_gifs(self.deck({"a.gif": make_gif()[:-10]}), target)
        self.assertEqual(report["warnings"], ["gif-first-frame:1"])
        self.assertEqual(self.frame_counts(target), {"ppt/media/a.gif": 1})

    def test_oversize_animation_is_limited_without_expansion(self):
        data = make_gif(frames=3, after_first=bytes(16 * 1024 * 1024))
        self.assertGreater(len(data), gifs.MAX_GIF_BYTES)
        target = self.root / "out.pptx"
        report = freeze_pptx_gifs(self.deck({"big.gif": data}), target)
        self.assertEqual(report["warnings"], ["gif-first-frame:1"])
        self.assertLess(len(members(target)["ppt/media/big.gif"]), 200)

    def test_member_budget_turns_excess_gifs_into_placeholders(self):
        source = self.deck({f"{i}.gif": make_gif() for i in range(4)})
        with patch.object(gifs, "MAX_GIF_MEMBERS", 2):
            report = freeze_pptx_gifs(source, self.root / "out.pptx")
        self.assertEqual(report["warnings"], ["gif-first-frame:2", "gif-placeholder:2"])


class ZipValidationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def test_duplicate_and_unsafe_names_rejected(self):
        cases = {
            "duplicate": [("ppt/media/x.bin", b"1"), ("ppt/media/x.bin", b"2")],
            "case-duplicate": [("ppt/media/x.bin", b"1"), ("ppt/media/X.bin", b"2")],
            "parent": [("../evil.txt", b"x")],
            "absolute": [("/abs.txt", b"x")],
            "backslash-parent": [("ppt/..\\x", b"x")],
        }
        for label, extra in cases.items():
            with self.subTest(label), warnings.catch_warnings():
                warnings.simplefilter("ignore")
                path = make_pptx(self.root / f"{label}.pptx", [("", {}, "")], extra=extra)
                with self.assertRaises(ValueError):
                    validate_office(path, "pptx")

    def test_external_relationships_still_rejected_and_clean_deck_passes(self):
        rels = f'<Relationships xmlns="{PKG_NS}"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://example.test/a.gif" TargetMode="External"/></Relationships>'
        bad = make_pptx(self.root / "bad.pptx", [("", {}, "")], extra=[("ppt/slides/_rels/slide9.xml.rels", rels)])
        with self.assertRaises(ValueError):
            validate_office(bad, "pptx")
        validate_office(make_pptx(self.root / "ok.pptx", [("", {}, "")], media={"a.gif": make_gif()}), "pptx")


class FakePopen:
    seen = []

    def __init__(self, command, **_kwargs):
        self.returncode, self.pid = 0, 1
        source = Path(command[-1])
        with zipfile.ZipFile(source) as archive:
            counts = {}
            for name in archive.namelist():
                if name.startswith("ppt/media/"):
                    data = archive.read(name)
                    counts[name] = scan_gif(io.BytesIO(data))["frameCount"] if data[:3] == b"GIF" else 0
        FakePopen.seen.append((source, counts))
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        with (Path(command[command.index("--outdir") + 1]) / f"{source.stem}.pdf").open("wb") as pdf:
            writer.write(pdf)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def wait(self, timeout=None):
        return 0


class ConvertOfficeGifTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.work = self.root / "work"
        self.work.mkdir()
        FakePopen.seen = []

    def convert(self, media):
        source = make_pptx(self.root / "document.pptx", [("", {}, "")], media=media)
        with patch("converter.subprocess.Popen", FakePopen):
            return source, convert_office(source, "pptx", self.work)

    def test_soffice_receives_frozen_copy_and_original_is_untouched(self):
        source = make_pptx(self.root / "document.pptx", [("", {}, "")], media={"a.gif": make_gif(frames=5)})
        before = digest(source)
        with patch("converter.subprocess.Popen", FakePopen):
            result = convert_office(source, "pptx", self.work)
        used, counts = FakePopen.seen[0]
        self.assertNotEqual(used, source)
        self.assertEqual(counts, {"ppt/media/a.gif": 1})
        self.assertEqual(digest(source), before)
        self.assertEqual(scan_gif(io.BytesIO(members(source)["ppt/media/a.gif"]))["frameCount"], 5)
        self.assertFalse((self.work / "frozen").exists())
        self.assertEqual((result["pageCount"], result["gifWarnings"]), (1, ["gif-first-frame:1"]))

    def test_corrupt_gif_does_not_abort_conversion(self):
        _source, result = self.convert({"a.gif": b"GIF89a-broken"})
        self.assertEqual(FakePopen.seen[0][1], {"ppt/media/a.gif": 1})
        self.assertEqual(result["gifWarnings"], ["gif-placeholder:1"])

    def test_deck_without_gif_converts_original_directly(self):
        source, result = self.convert({"a.png": b"png"})
        self.assertEqual(FakePopen.seen[0][0], source)
        self.assertEqual(result["gifWarnings"], [])


if __name__ == "__main__":
    unittest.main()
