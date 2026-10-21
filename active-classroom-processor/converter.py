"""Local conversion boundary; no Firebase, Drive or cloud credentials."""
import hashlib
import os
from pathlib import Path
import subprocess
import signal
import zipfile
from pypdf import PdfReader

PROCESSOR_VERSION = "office-pdf-v1"
MAX_BYTES = 250 * 1024 * 1024
MAX_PAGES = 200


def file_integrity(path):
    digest = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("file-too-large")
            digest.update(chunk)
    return size, digest.hexdigest()


def validate_office(path, extension):
    if extension not in {"ppt", "pptx", "doc", "docx"}:
        raise ValueError("unsupported-office-format")
    with Path(path).open("rb") as source:
        signature = source.read(8)
    if extension.endswith("x"):
        if not signature.startswith(b"PK"):
            raise ValueError("invalid-office-file")
        with zipfile.ZipFile(path) as archive:
            items = archive.infolist()
            required = "ppt/presentation.xml" if extension == "pptx" else "word/document.xml"
            if required not in archive.namelist() or len(items) > 10000 or sum(item.file_size for item in items) > 512 * 1024 * 1024:
                raise ValueError("invalid-office-archive")
            # Links to remote document parts can make conversion fetch external content.
            # Hyperlinks are inert in conversion; other external relationships are rejected.
            from xml.etree import ElementTree
            for item in items:
                if item.filename.endswith(".rels"):
                    if item.file_size > 1024 * 1024:
                        raise ValueError("invalid-office-relationships")
                    root = ElementTree.fromstring(archive.read(item))
                    for relationship in root:
                        if relationship.get("TargetMode") == "External" and not relationship.get("Type", "").endswith("/hyperlink"):
                            raise ValueError("external-document-reference")
    elif signature != bytes.fromhex("d0cf11e0a1b11ae1"):
        raise ValueError("invalid-office-file")


def convert_office(source, extension, working_directory, timeout=180):
    validate_office(source, extension)
    workspace = Path(working_directory)
    output = workspace / "output"
    output.mkdir()
    profile = workspace / "profile"
    profile.mkdir()
    (profile / "user").mkdir()
    (profile / "user" / "registrymodifications.xcu").write_text(
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="AllowPrintJobCancel" oor:op="fuse"><value>true</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Common/Security"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>'
        '</oor:items>', encoding="utf-8")
    export = "impress_pdf_Export" if extension.startswith("ppt") else "writer_pdf_Export"
    # No shell, no original filename, no service credentials in child environment.
    command = [
        "soffice", f"-env:UserInstallation={profile.as_uri()}", "--headless", "--nologo",
        "--nodefault", "--nolockcheck", "--nofirststartwizard", "--convert-to",
        f"pdf:{export}", "--outdir", str(output), str(source),
    ]
    with subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(workspace), "LANG": "C.UTF-8", "SAL_USE_VCLPLUGIN": "svp"}) as process:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
    pdf = output / f"{Path(source).stem}.pdf"
    size, checksum = file_integrity(pdf)
    with pdf.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("invalid-pdf-result")
    reader = PdfReader(pdf, strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted-pdf-result")
    pages = len(reader.pages)
    if pages < 1 or pages > MAX_PAGES:
        raise ValueError("invalid-page-count")
    return {"path": pdf, "sizeBytes": size, "sha256": checksum, "pageCount": pages}
