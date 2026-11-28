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


A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def styled(text, inner="", attrs=' lang="es-ES" sz="1800"', paragraph=""):
    return f'{paragraph}<a:r><a:rPr{attrs}>{inner}</a:rPr><a:t>{text}</a:t></a:r>'


GRADIENT = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill>'


class FormatTests(StudioCase):
    FONTS = {"arial", "dejavu sans"}

    def apply(self, deck, edits):
        target = self.root / "edited.pptx"
        with patch("studio._installed_font_families", return_value=self.FONTS):
            apply_studio_edits(deck, target, edits)
        return target

    def inspect(self, deck):
        with patch("studio._installed_font_families", return_value=self.FONTS):
            return self.elements(deck)

    def rpr(self, path):
        return ET.fromstring(self.read(path)).find(f".//{A_NS}rPr")

    def test_inspect_expone_formato_explicito_editable(self):
        deck = self.deck(box(2, [styled("Hola", '<a:solidFill><a:srgbClr val="1a2B3c"/></a:solidFill><a:latin typeface="Arial"/>',
                                        paragraph='<a:pPr algn="ctr"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>')]))
        item = self.inspect(deck)["2"]
        self.assertEqual((item["color"], item["alignment"], item["lineSpacing"]), ("#1A2B3C", "center", 150))
        self.assertEqual((item["fontFamily"], item["fontAvailable"]), ("Arial", True))

    def test_inspect_no_inventa_formato_implicito_ni_en_varios_runs(self):
        deck = self.deck(box(2, [run("x")]) + box(3, [styled("a", '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>') + styled("b")]))
        items = self.inspect(deck)
        for key in ("color", "alignment", "lineSpacing", "fontFamily"):
            self.assertNotIn(key, items["2"])
            self.assertNotIn(key, items["3"])

    def test_inspect_no_muestra_colores_no_confiables_ni_formatos_no_editables(self):
        cases = {
            "tema": ('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>', "", {}),
            "transformado": ('<a:solidFill><a:srgbClr val="112233"><a:lumMod val="50000"/></a:srgbClr></a:solidFill>', "", {}),
            "degradado": (GRADIENT, "", {}),
            "alineacion distribuida": ("", '<a:pPr algn="dist"/>', {}),
            "interlineado en puntos": ("", '<a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr>', {}),
            "interlineado fuera de rango": ("", '<a:pPr><a:lnSpc><a:spcPct val="400000"/></a:lnSpc></a:pPr>', {}),
        }
        for name, (inner, paragraph, _expected) in cases.items():
            with self.subTest(name):
                item = self.inspect(self.deck(box(2, [styled("x", inner, paragraph=paragraph)])))["2"]
                self.assertFalse({"color", "alignment", "lineSpacing"} & set(item))

    def test_fuente_no_instalada_se_marca_no_disponible(self):
        item = self.inspect(self.deck(box(2, [styled("x", '<a:latin typeface="Comic Neue"/>')])))["2"]
        self.assertEqual((item["fontFamily"], item["fontAvailable"]), ("Comic Neue", False))

    def test_aplica_formato_creando_nodos_en_orden_de_esquema(self):
        deck = self.deck(box(2, [styled("Hola", '<a:ln w="9525"/><a:highlight><a:srgbClr val="FFFF00"/></a:highlight><a:ea typeface="MS Gothic"/>')]))
        target = self.apply(deck, [{"slideIndex": 0, "id": "2", "color": "#aabbcc", "fontFamily": "Arial", "alignment": "justify", "lineSpacing": 120}])
        properties = self.rpr(target)
        self.assertEqual([child.tag.removeprefix(A_NS) for child in properties], ["ln", "solidFill", "highlight", "latin", "ea"])
        self.assertEqual(properties.find(f"{A_NS}solidFill/{A_NS}srgbClr").get("val"), "AABBCC")
        self.assertEqual(properties.find(f"{A_NS}latin").get("typeface"), "Arial")
        paragraph = ET.fromstring(self.read(target)).find(f".//{A_NS}p")
        self.assertEqual(paragraph[0].tag, f"{A_NS}pPr")
        self.assertEqual(paragraph[0].get("algn"), "just")
        self.assertEqual(paragraph[0].find(f"{A_NS}lnSpc/{A_NS}spcPct").get("val"), "120000")
        item = self.inspect(target)["2"]
        self.assertEqual((item["color"], item["alignment"], item["lineSpacing"], item["fontFamily"]), ("#AABBCC", "justify", 120, "Arial"))

    def test_conserva_formatos_atributos_y_namespaces_al_cambiar(self):
        inner = '<a:solidFill><a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:latin typeface="DejaVu Sans" panose="020B0604020202020204"/>'
        paragraph = '<a:pPr marL="10" algn="r"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>'
        deck = self.deck(box(2, [styled("Hola", inner, attrs=' lang="es-ES" sz="1800" b="1"', paragraph=paragraph)]))
        target = self.apply(deck, [{"slideIndex": 0, "id": "2", "color": "#FF0000", "fontFamily": "Arial", "alignment": "left", "lineSpacing": 100}])
        raw = self.read(target).decode()
        self.assertIn("<a:solidFill>", raw)
        self.assertNotIn("ns0:", raw)
        properties = self.rpr(target)
        self.assertEqual((properties.get("lang"), properties.get("sz"), properties.get("b")), ("es-ES", "1800", "1"))
        color = properties.find(f"{A_NS}solidFill/{A_NS}srgbClr")
        self.assertEqual((color.get("val"), color.find(f"{A_NS}alpha").get("val")), ("FF0000", "50000"))
        self.assertEqual(properties.find(f"{A_NS}latin").attrib, {"typeface": "Arial"})
        pPr = ET.fromstring(self.read(target)).find(f".//{A_NS}pPr")
        self.assertEqual((pPr.get("marL"), pPr.get("algn")), ("10", "l"))
        self.assertEqual([child.tag.removeprefix(A_NS) for child in pPr], ["lnSpc", "spcBef"])
        self.assertEqual(pPr.find(f"{A_NS}lnSpc/{A_NS}spcPct").get("val"), "100000")

    def test_reemplaza_color_de_tema_y_crea_rpr_si_falta(self):
        deck = self.deck(box(2, [styled("a", '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>')]) + box(3, ['<a:r><a:t>b</a:t></a:r>']))
        items = self.inspect(self.apply(deck, [{"slideIndex": 0, "id": "2", "color": "#010203"}, {"slideIndex": 0, "id": "3", "color": "#040506", "fontFamily": "Arial"}]))
        self.assertEqual((items["2"]["color"], items["3"]["color"], items["3"]["fontFamily"], items["3"]["text"]), ("#010203", "#040506", "Arial", "b"))

    def test_rechaza_sin_modificar_cuando_destruiria_formato(self):
        cases = [
            ("degradado", box(2, [styled("x", GRADIENT)]), {"color": "#000000"}),
            ("sin relleno", box(2, [styled("x", "<a:noFill/>")]), {"color": "#000000"}),
            ("hipervinculo", box(2, [styled("x", '<a:hlinkClick r:id="rId9"/>')]), {"color": "#000000"}),
            ("alineacion distribuida", box(2, [styled("x", paragraph='<a:pPr algn="dist"/>')]), {"alignment": "left"}),
            ("interlineado en puntos", box(2, [styled("x", paragraph='<a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr>')]), {"lineSpacing": 100}),
            ("varios runs", box(2, [styled("a") + styled("b")]), {"alignment": "center"}),
            ("fuente no instalada", box(2, [styled("x")]), {"fontFamily": "Comic Neue"}),
            ("foto", picture(2), {"color": "#000000"}),
        ]
        for name, shapes, change in cases:
            with self.subTest(name), self.assertRaisesRegex(ValueError, "studio-edit-unsupported"):
                self.apply(self.deck(shapes), [{"slideIndex": 0, "id": "2", **change}])
            self.assertFalse((self.root / "edited.pptx").exists())

    def test_sin_fontconfig_no_se_permite_cambiar_la_fuente(self):
        target = self.root / "edited.pptx"
        with patch("studio._installed_font_families", return_value=None), self.assertRaisesRegex(ValueError, "studio-edit-unsupported"):
            apply_studio_edits(self.deck(), target, [{"slideIndex": 0, "id": "2", "fontFamily": "Arial"}])

    def test_la_fuente_se_compara_sin_distinguir_mayusculas_y_no_instala_nada(self):
        with patch("studio.subprocess.run") as runner:
            target = self.apply(self.deck(), [{"slideIndex": 0, "id": "2", "fontFamily": "dejavu SANS"}])
        runner.assert_not_called()
        self.assertEqual(self.rpr(target).find(f"{A_NS}latin").get("typeface"), "dejavu SANS")

    def test_valida_parches_de_formato(self):
        base = {"slideIndex": 0, "id": "2"}
        valid = [{"color": "#aBc123"}, {"fontFamily": "x" * 120}, {"alignment": "justify"}, {"lineSpacing": 50}, {"lineSpacing": 300}]
        for change in valid:
            with self.subTest(change=str(change)[:30]):
                self.assertEqual(parse_studio_edits([{**base, **change}]), [{**base, **change}])
        invalid = [
            {"color": "#abc"}, {"color": "abcdef"}, {"color": "#abcdeg"}, {"color": "#abcdef\n"}, {"color": 0xabcdef}, {"color": "#abcdef00"},
            {"fontFamily": ""}, {"fontFamily": " "}, {"fontFamily": " Arial"}, {"fontFamily": "x" * 121}, {"fontFamily": "A\x00"}, {"fontFamily": 5},
            {"alignment": "centre"}, {"alignment": "ctr"}, {"alignment": "Left"}, {"alignment": 1},
            {"lineSpacing": 49}, {"lineSpacing": 301}, {"lineSpacing": 100.5}, {"lineSpacing": True}, {"lineSpacing": "100"},
        ]
        for change in invalid:
            with self.subTest(change=str(change)[:30]), self.assertRaisesRegex(ValueError, "invalid-studio-edits"):
                parse_studio_edits([{**base, **change}])


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

    def test_convert_rechaza_studio_render_slides_mal_formados_antes_de_descargar(self):
        for value in ([], [1, 1], [2, 1], [-1], [True], ["0"], 0):
            with self.subTest(value=value), patch.object(processor, "validate_request", return_value={}), patch.object(processor, "download_source") as download:
                response = processor.app.test_client().post("/convert", json={"studioRenderSlides": value})
            self.assertEqual((response.status_code, response.get_json()), (400, {"error": "invalid-studio-render-slides"}))
            download.assert_not_called()


class RenderSlidesTests(unittest.TestCase):
    """Selective regeneration with a fake plan and renderer; no network or credentials."""
    PLAN = {
        "slides": [{"index": 0, "steps": [["2"]], "warnings": []}, {"index": 1, "steps": [], "warnings": []}, {"index": 2, "steps": [["2"], ["3"]], "warnings": []}],
        "stateCount": 6,
        "animationPlan": [{"slideIndex": 1, "images": []}, {"slideIndex": 2, "images": []}],
    }

    def url(self, index):
        return f"https://storage.googleapis.com/bucket/{processor.raster_path('r' * 36, index)}?X-Goog-Signature=x"

    def run_upload(self, selection, urls, animations=None):
        data = {"revision": "r" * 36, "processorVersion": "pptx-builds-png-v2", "stateUploadUrls": urls}
        if selection is not None:
            data["studioRenderSlides"] = selection
        if animations is not None:
            data["animationUploadUrls"] = animations
        calls = {}

        def fake_render(source, workspace, plan, deadline_seconds, on_state):
            calls["plan"] = plan
            states = []
            for local in range(plan["stateCount"]):
                state = {"path": Path(workspace) / f"{local}.png", "sizeBytes": 1, "sha256": str(local)}
                on_state(local, state)
                states.append(state)
            return states

        uploaded = []
        with patch.dict("os.environ", {"STORAGE_BUCKET": "bucket"}), patch.object(processor, "pptx_plan", return_value=self.PLAN), \
                patch.object(processor, "render_pptx", side_effect=fake_render), \
                patch.object(processor, "upload_animations", return_value=[]) as animation_upload:
            with patch.object(processor, "Request", side_effect=lambda url, **_kw: uploaded.append(url) or url), \
                    patch.object(processor, "urlopen") as opener, patch.object(Path, "open", create=True) as opened:
                opener.return_value.__enter__.return_value.status = 200
                opened.return_value.__enter__.return_value.read.return_value = b"\x89PNG\r\n\x1a\n" + bytes(8) + (10).to_bytes(4, "big") + (20).to_bytes(4, "big")
                result = processor.upload_pngs(data, Path("x.pptx"), tempfile.gettempdir())
        return result, calls, uploaded, animation_upload

    def test_sin_seleccion_conserva_todos_los_estados(self):
        urls = [self.url(index) for index in range(6)]
        result, calls, uploaded, _ = self.run_upload(None, urls)
        self.assertEqual(calls["plan"]["stateCount"], 6)
        self.assertEqual(uploaded, urls)
        self.assertTrue(all(state is not None for state in result["states"]))

    def test_seleccion_renderiza_subconjunto_con_indices_globales(self):
        urls = [None, None, *[self.url(index) for index in range(2, 6)]]
        result, calls, uploaded, _ = self.run_upload([1, 2], urls)
        self.assertEqual([slide["index"] for slide in calls["plan"]["slides"]], [1, 2])
        self.assertEqual(calls["plan"]["stateCount"], 4)
        self.assertEqual(uploaded, [self.url(2), self.url(3), self.url(4), self.url(5)])
        self.assertEqual([state is None for state in result["states"]], [True, True, False, False, False, False])
        self.assertEqual(len(result["states"]), 6)
        self.assertEqual(result["slides"], self.PLAN["slides"])
        self.assertEqual(result["pageCount"], 3)

    def test_rechaza_capacidades_incoherentes_con_la_seleccion(self):
        good = [None, None, self.url(2), self.url(3), self.url(4), self.url(5)]
        cases = {
            "url en estado no seleccionado": [self.url(0), None, *good[2:]],
            "falta url seleccionada": [None, None, None, *good[3:]],
            "longitud no global": good[2:],
            "url de otro indice": [None, None, self.url(3), self.url(2), self.url(4), self.url(5)],
        }
        for name, urls in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                self.run_upload([1, 2], urls)

    def test_rechaza_indice_inexistente(self):
        with self.assertRaisesRegex(ValueError, "invalid-studio-render-slides"):
            self.run_upload([3], [None] * 6)

    def test_animaciones_solo_de_slides_seleccionadas(self):
        urls = [None, None, self.url(2), self.url(3), self.url(4), self.url(5)]
        _, _, _, animation_upload = self.run_upload([1, 2], urls)
        self.assertEqual([item["slideIndex"] for item in animation_upload.call_args.args[3]["animationPlan"]], [1, 2])
        _, _, _, animation_upload = self.run_upload([2], [None] * 3 + [self.url(3), self.url(4), self.url(5)])
        self.assertEqual([item["slideIndex"] for item in animation_upload.call_args.args[3]["animationPlan"]], [2])


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
