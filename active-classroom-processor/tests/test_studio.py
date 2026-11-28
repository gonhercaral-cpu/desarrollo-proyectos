"""Studio inspection, editing and rasterization on synthetic PPTX files."""
from pathlib import Path
import hashlib
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from xml.etree import ElementTree as ET
import app as processor
from studio import apply_studio_edits, inspect_slide, parse_studio_edits

NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
MEDIA = bytes(range(256)) * 8


def xfrm(x=100, y=200, cx=3000, cy=4000, tag="p:spPr"):
    return f'<{tag}><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm></{tag}>'


def box(shape_id, runs, extra="", geometry=None):
    body = "".join(f"<a:p>{run}</a:p>" for run in runs)
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="T{shape_id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'{geometry or xfrm()}<p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody></p:sp>')


def run(text, size=None, bold=False):
    attrs = (f' sz="{size}"' if size else "") + (' b="1"' if bold else "")
    return f'<a:r><a:rPr lang="es-ES"{attrs}/><a:t>{text}</a:t></a:r>'


def picture(shape_id):
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>{xfrm(5, 6, 700, 800)}</p:pic>')


def slide(shapes):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            f'<p:grpSpPr/>{shapes}</p:spTree></p:cSld></p:sld>')


def make_deck(path, slides):
    ids = "".join(f'<p:sldId id="{256 + i}" r:id="rId{10 + i}"/>' for i in range(len(slides)))
    rels = "".join(f'<Relationship Id="rId{10 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i + 1}.xml"/>' for i in range(len(slides)))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("ppt/presentation.xml", f'<p:presentation {NS}><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>')
        archive.writestr("ppt/_rels/presentation.xml.rels", f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
        for i, shapes in enumerate(slides):
            archive.writestr(f"ppt/slides/slide{i + 1}.xml", slide(shapes))
            archive.writestr(f"ppt/slides/_rels/slide{i + 1}.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/a.png"/></Relationships>')
        archive.writestr("ppt/media/a.png", MEDIA, zipfile.ZIP_STORED)


class StudioCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def deck(self, *slides):
        path = self.root / "deck.pptx"
        make_deck(path, slides or [self.default_slide()])
        return path

    def default_slide(self):
        return "".join([
            box(2, [run("Hola", size=1800)]),
            box(3, [run("Uno ", bold=True) + run("dos")]),
            picture(4),
            box(5, [f'<a:fld id="{{00000000-0000-0000-0000-000000000000}}" type="slidenum"><a:t>1</a:t></a:fld>']),
            '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' + box(7, [run("dentro")]) + "</p:grpSp>",
            box(8, [run("sin xfrm")], geometry="<p:spPr/>"),
            box(9, [run("a")]) + box(9, [run("b")]),
        ])

    def read(self, path, name="ppt/slides/slide1.xml"):
        with zipfile.ZipFile(path) as archive:
            return archive.read(name)

    def elements(self, path, index=0):
        return {item["id"]: item for item in inspect_slide(path, index)["elements"]}


class InspectTests(StudioCase):
    def test_lista_solo_elementos_compatibles_en_emu_con_ids_string(self):
        result = inspect_slide(self.deck(), 0)
        self.assertEqual((result["width"], result["height"]), (9144000, 6858000))
        self.assertEqual([item["id"] for item in result["elements"]], ["2", "3", "4"])

    def test_texto_de_un_run_es_editable_y_expone_tamano_explicito(self):
        item = self.elements(self.deck())["2"]
        self.assertEqual(item, {"id": "2", "x": 100, "y": 200, "width": 3000, "height": 4000, "text": "Hola", "editable": True, "fontSize": 1800})

    def test_varios_runs_permiten_geometria_pero_no_texto(self):
        item = self.elements(self.deck())["3"]
        self.assertEqual((item["text"], item["editable"]), ("Uno dos", False))
        self.assertNotIn("fontSize", item)

    def test_sin_tamano_explicito_no_se_inventa_fontsize(self):
        deck = self.deck(box(2, [run("x")]))
        self.assertNotIn("fontSize", self.elements(deck)["2"])

    def test_foto_top_level_con_transform_real(self):
        item = self.elements(self.deck())["4"]
        self.assertEqual((item["x"], item["y"], item["width"], item["height"], item["text"], item["editable"]), (5, 6, 700, 800, "", False))

    def test_slide_fuera_de_rango_o_no_entero_falla(self):
        deck = self.deck()
        for index in (1, -1, True, "0", None):
            with self.subTest(index=index), self.assertRaises(ValueError):
                inspect_slide(deck, index)

    def test_rechaza_dtd(self):
        path = self.root / "dtd.pptx"
        make_deck(path, [box(2, [run("x")])])
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(self.root / "evil.pptx", "w") as target:
            for item in source.infolist():
                data = source.read(item)
                if item.filename == "ppt/slides/slide1.xml":
                    data = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]>' + data.split(b"?>", 1)[1]
                target.writestr(item, data)
        with self.assertRaises(ValueError):
            inspect_slide(self.root / "evil.pptx", 0)


class ParseTests(unittest.TestCase):
    def test_ausente_es_none(self):
        self.assertIsNone(parse_studio_edits(None))

    def test_acepta_parche_valido(self):
        edit = {"slideIndex": 0, "id": "2", "x": 0, "y": -5, "width": 1, "height": 9, "text": "Hola", "fontSize": 100}
        self.assertEqual(parse_studio_edits([edit]), [edit])

    def test_rechaza_parches_invalidos(self):
        base = {"slideIndex": 0, "id": "2", "x": 1}
        invalid = [
            [], {}, "x", [1], [{}], [{"slideIndex": 0, "id": "2"}],
            [{**base, "extra": 1}], [{**base, "id": 2}], [{**base, "id": "a"}], [{**base, "slideIndex": -1}],
            [{**base, "slideIndex": True}], [{**base, "x": 1.5}], [{**base, "x": True}], [{**base, "width": 0}],
            [{**base, "height": -1}], [{**base, "width": 10**9}], [{**base, "text": 5}], [{**base, "text": "a\x00b"}],
            [{**base, "text": "a\nb"}], [{**base, "text": "x" * 10001}], [{**base, "fontSize": 99}], [{**base, "fontSize": 10001}],
            [{**base, "fontSize": 12.5}], [base, dict(base)], [{"slideIndex": 0, "id": str(i), "x": 1} for i in range(101)],
        ]
        for value in invalid:
            with self.subTest(value=str(value)[:60]), self.assertRaisesRegex(ValueError, "invalid-studio-edits"):
                parse_studio_edits(value)

    def test_acepta_hasta_100_parches(self):
        self.assertEqual(len(parse_studio_edits([{"slideIndex": 0, "id": str(i), "x": 1} for i in range(100)])), 100)


class ApplyTests(StudioCase):
    def apply(self, deck, edits):
        target = self.root / "edited.pptx"
        apply_studio_edits(deck, target, edits)
        return target

    def test_aplica_geometria_texto_y_tamano_sin_tocar_original_ni_media(self):
        deck = self.deck()
        before = deck.read_bytes()
        target = self.apply(deck, [{"slideIndex": 0, "id": "2", "x": 10, "y": 20, "width": 30, "height": 40, "text": "Adiós & <ok>", "fontSize": 2400},
                                   {"slideIndex": 0, "id": "4", "x": 7}])
        self.assertEqual(deck.read_bytes(), before)
        with zipfile.ZipFile(target) as archive, zipfile.ZipFile(deck) as original:
            self.assertEqual(archive.read("ppt/media/a.png"), MEDIA)
            self.assertEqual(archive.infolist()[-1].compress_type, zipfile.ZIP_STORED)
            self.assertEqual([item.filename for item in archive.infolist()], [item.filename for item in original.infolist()])
        items = self.elements(target)
        self.assertEqual(items["2"], {"id": "2", "x": 10, "y": 20, "width": 30, "height": 40, "text": "Adiós & <ok>", "editable": True, "fontSize": 2400})
        self.assertEqual((items["4"]["x"], items["4"]["y"], items["4"]["width"]), (7, 6, 700))
        self.assertEqual(items["3"]["text"], "Uno dos")

    def test_conserva_el_formato_del_run(self):
        target = self.apply(self.deck(), [{"slideIndex": 0, "id": "2", "text": "Nuevo"}])
        root = ET.fromstring(self.read(target))
        properties = root.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}rPr")
        self.assertEqual((properties.get("lang"), properties.get("sz")), ("es-ES", "1800"))

    def test_varios_runs_aceptan_geometria(self):
        items = self.elements(self.apply(self.deck(), [{"slideIndex": 0, "id": "3", "x": 55}]))
        self.assertEqual((items["3"]["x"], items["3"]["text"]), (55, "Uno dos"))

    def test_rechaza_texto_en_varios_runs_y_fontsize_implicito_y_texto_en_foto(self):
        deck = self.deck(box(2, [run("a") + run("b")]) + box(3, [run("x")]) + picture(4))
        for edit in ({"id": "2", "text": "n"}, {"id": "3", "fontSize": 1200}, {"id": "4", "text": "n"}):
            with self.subTest(edit=edit), self.assertRaisesRegex(ValueError, "studio-edit-unsupported"):
                self.apply(deck, [{"slideIndex": 0, **edit}])
            self.assertFalse((self.root / "edited.pptx").exists())

    def test_rechaza_elementos_incompatibles_o_inexistentes(self):
        deck = self.deck()
        for shape_id in ("5", "6", "7", "8", "9", "99"):
            with self.subTest(shape=shape_id), self.assertRaisesRegex(ValueError, "studio-element-not-found"):
                self.apply(deck, [{"slideIndex": 0, "id": shape_id, "x": 1}])
        with self.assertRaisesRegex(ValueError, "studio-element-not-found"):
            self.apply(deck, [{"slideIndex": 3, "id": "2", "x": 1}])

    def test_mismo_id_en_otro_slide_es_independiente(self):
        deck = self.deck(box(2, [run("a")]), box(2, [run("b")]))
        target = self.apply(deck, [{"slideIndex": 0, "id": "2", "x": 1}, {"slideIndex": 1, "id": "2", "x": 2}])
        self.assertEqual((self.elements(target, 0)["2"]["x"], self.elements(target, 1)["2"]["x"]), (1, 2))


class AppIntegrationTests(StudioCase):
    def test_sin_studio_edits_usa_el_original(self):
        deck = self.deck()
        data = {"extension": "pptx", "processorVersion": "pptx-builds-png-v2"}
        self.assertIs(processor.studio_source(data, deck, self.root), deck)

    def test_con_studio_edits_crea_copia_temporal(self):
        deck = self.deck()
        data = {"extension": "pptx", "processorVersion": "pptx-builds-png-v2", "studioEdits": [{"slideIndex": 0, "id": "2", "x": 1}]}
        edited = processor.studio_source(data, deck, self.root)
        self.assertNotEqual(edited, deck)
        self.assertEqual(self.elements(edited)["2"]["x"], 1)
        self.assertEqual(self.elements(deck)["2"]["x"], 100)

    def test_studio_edits_no_se_acepta_con_pdf_directo(self):
        data = {"extension": "pptx", "processorVersion": "office-pdf-v1", "studioEdits": [{"slideIndex": 0, "id": "2", "x": 1}]}
        with self.assertRaisesRegex(ValueError, "invalid-studio-edits"):
            processor.studio_source(data, self.deck(), self.root)

    def test_ruta_inspect(self):
        deck = self.deck()
        body = {"extension": "pptx", "processorVersion": "pptx-builds-png-v2", "slideIndex": 0}
        with patch.object(processor, "validate_request", return_value={}), patch.object(processor, "download_source", return_value=deck):
            response = processor.app.test_client().post("/studio/inspect", json=body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual([item["id"] for item in response.get_json()["elements"]], ["2", "3", "4"])
            response = processor.app.test_client().post("/studio/inspect", json={**body, "slideIndex": 5})
            self.assertEqual((response.status_code, response.get_json()), (422, {"error": "invalid-studio-edits"}))

    def test_convert_rechaza_studio_edits_invalidos_antes_de_descargar(self):
        body = {"studioEdits": [{"slideIndex": 0, "id": "2"}]}
        with patch.object(processor, "validate_request", return_value={}), patch.object(processor, "download_source") as download:
            response = processor.app.test_client().post("/convert", json=body)
        self.assertEqual((response.status_code, response.get_json()), (400, {"error": "invalid-studio-edits"}))
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class StudioRasterTests(unittest.TestCase):
    def test_real_raster_keeps_other_slides_and_reveal_steps(self):
        from builds import analyze_pptx, render_pptx
        from test_builds import interactive_fixture

        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            source = interactive_fixture(workspace)
            expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()
            layout = inspect_slide(source, 0)
            answer = next(shape for shape in layout["elements"] if shape["text"] == "Answer 1")
            candidate = workspace / "candidate.pptx"
            apply_studio_edits(source, candidate, [{
                "slideIndex": 0, "id": answer["id"], "width": answer["width"] + 1500000,
                "text": "Respuesta corregida",
            }])
            original_plan = analyze_pptx(source)
            candidate_plan = analyze_pptx(candidate)
            self.assertEqual(original_plan, candidate_plan)
            hashes = []
            for document, plan in ((source, original_plan), (candidate, candidate_plan)):
                raster = workspace / document.stem
                raster.mkdir()
                hashes.append([state["sha256"] for state in render_pptx(document, raster, plan)])
            self.assertEqual(hashes[0][0], hashes[1][0], "la respuesta continúa oculta antes del clic")
            self.assertNotEqual(hashes[0][1], hashes[1][1], "la corrección aparece al revelar la respuesta")
            self.assertEqual(hashes[0][3:], hashes[1][3:], "las demás diapositivas conservan su SHA-256")
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), expected_sha)
