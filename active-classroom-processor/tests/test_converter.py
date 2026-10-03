import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from pypdf import PdfReader
from converter import convert_office, validate_office
from app import validate_request

NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
      'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
      'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"')


def office_fixture(workspace, extension):
    if extension.startswith("ppt"):
        pages = ''.join(f'<draw:page draw:name="Slide{i}" draw:master-page-name="Default"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="10cm"><draw:text-box><text:p>Classroom slide {i}</text:p></draw:text-box></draw:frame></draw:page>' for i in range(1, 4))
        body = f'<office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles><office:body><office:presentation>{pages}</office:presentation></office:body>'
        kind, suffix = "presentation", "fodp"
        filters = {"pptx": "pptx:Impress MS PowerPoint 2007 XML", "ppt": "ppt:MS PowerPoint 97"}
    else:
        body = '<office:body><office:text><text:p>Canción para alumnos. Documento original.</text:p></office:text></office:body>'
        kind, suffix = "text", "fodt"
        filters = {"docx": "docx:Office Open XML Text", "doc": "doc:MS Word 97"}
    fixture = Path(workspace) / f"fixture.{suffix}"
    fixture.write_text(f'<?xml version="1.0" encoding="UTF-8"?><office:document {NS} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.{kind}">{body}</office:document>', encoding="utf-8")
    profile = Path(workspace) / "fixture-profile"
    subprocess.run(["soffice", f"-env:UserInstallation={profile.as_uri()}", "--headless", "--convert-to", filters[extension], "--outdir", str(workspace), str(fixture)], check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Path(workspace) / f"fixture.{extension}"


class ConverterTests(unittest.TestCase):
    def test_ppt_pptx_doc_docx_real(self):
        self.assertIsNotNone(shutil.which("soffice"), "Requiere el contenedor Linux real")
        for extension in ["ppt", "pptx", "doc", "docx"]:
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as workspace:
                source = office_fixture(workspace, extension)
                original = source.read_bytes()
                result = convert_office(source, extension, workspace)
                self.assertEqual(result["pageCount"], 3 if extension.startswith("ppt") else 1)
                self.assertEqual(result["sha256"], hashlib.sha256(result["path"].read_bytes()).hexdigest())
                self.assertEqual(result["sizeBytes"], result["path"].stat().st_size)
                self.assertEqual(source.read_bytes(), original)
                self.assertIn("Classroom" if extension.startswith("ppt") else "alumnos", ''.join(page.extract_text() for page in PdfReader(result["path"]).pages))

    def test_corrupt_source_and_unsupported_input(self):
        with tempfile.TemporaryDirectory() as workspace:
            source = Path(workspace) / "invalid.pptx"
            source.write_bytes(b"corrupt")
            with self.assertRaises(ValueError):
                convert_office(source, "pptx", workspace)
            with self.assertRaises(ValueError):
                validate_office(source, "exe")

    def test_conversion_timeout(self):
        with tempfile.TemporaryDirectory() as workspace:
            source = office_fixture(workspace, "docx")
            with self.assertRaises(subprocess.TimeoutExpired):
                convert_office(source, "docx", workspace, timeout=0.000001)

    def test_request_cannot_choose_url_bucket_or_arbitrary_path(self):
        os.environ["STORAGE_BUCKET"] = "test-private-bucket"
        valid = {"revision": "a" * 36, "processorVersion": "office-pdf-v1", "extension": "pptx", "original": {"path": "active-classroom/publications/files/" + "a" * 64, "generation": "1", "sizeBytes": 12, "checksums": {"sha256": "b" * 64}}}
        valid["sourceUrl"] = f"https://storage.googleapis.com/test-private-bucket/{valid['original']['path']}?generation=1&X-Goog-Signature=test"
        target = "active-classroom/publications/files/" + hashlib.sha256(f"{valid['revision']}:pdf".encode()).hexdigest()
        valid["uploadUrl"] = f"https://storage.googleapis.com/test-private-bucket/{target}?X-Goog-Signature=test"
        self.assertEqual(validate_request(valid), valid["original"])
        for path in ["https://example.com/secret", "active-classroom/resources/private", "../../secret"]:
            data = {**valid, "original": {**valid["original"], "path": path}}
            with self.assertRaises(ValueError):
                validate_request(data)


if __name__ == "__main__":
    unittest.main()
