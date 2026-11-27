"""Runs one real, non-personal segment against an ephemeral IPP Everywhere virtual printer."""
import contextlib
import plistlib
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import agent
from test_agent import sample_pdf


def main():
    with tempfile.TemporaryDirectory(prefix="as-ipp-") as temp:
        work = Path(temp)
        spool = work / "spool"
        spool.mkdir(mode=0o700)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        uri = "ipp://localhost:" + str(port)
        process = subprocess.Popen([agent.binary("ippeveprinter"), "-n", "localhost", "-r", "off", "-p", str(port),
            "-d", str(spool), "-k", "-f", "application/pdf", "-s", "600", "AS-Test"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(40):
                if process.poll() is not None:
                    raise RuntimeError(process.stderr.read().decode()[:300])
                try:
                    with socket.create_connection(("localhost", port), timeout=0.3):
                        break
                except OSError:
                    time.sleep(0.15)
            src = work / "book.pdf"
            src.write_bytes(sample_pdf(120))
            part = agent.prepare_pdf(src, work / "part.pdf", {"from": 41, "to": 80, "copies": 1, "pages": 120})
            description = work / "print.test"
            desc = Path("/usr/share/cups/ipptool/print-job.test").read_text()
            desc = desc.replace("ATTR mimeMediaType document-format $filetype", "ATTR mimeMediaType document-format $filetype\n ATTR name job-name AS-Virtual-41-80")
            description.write_text(desc)
            def invoke(*args):
                result = subprocess.run([agent.binary("ipptool"), "-X", *args], capture_output=True, timeout=30)
                if result.returncode:
                    raise RuntimeError(result.stderr.decode()[:200] or result.stdout.decode()[-650:])
                return plistlib.loads(result.stdout)["Tests"][0]["ResponseAttributes"]
            answer = invoke("-f", str(part), uri + "/ipp/print", str(description))
            job = next(item for item in answer if "job-uri" in item)
            path = urlsplit(job["job-uri"]).path
            if not re.fullmatch(r"/ipp/print/[0-9]+", path):
                raise RuntimeError("Identificador inesperado de la impresora virtual.")
            for _ in range(80):
                attrs = invoke(uri + path, str(Path(__file__).with_name("job-status.test")))
                status = next(item for item in attrs if "job-state" in item)
                if status["job-state"] == 9 and status["job-name"] == "AS-Virtual-41-80":
                    break
                time.sleep(.25)
            else:
                raise RuntimeError("CUPS no confirmó la terminación del trabajo virtual.")
            received = list(spool.glob("*.pdf"))
            if len(received) != 1 or received[0].read_bytes() != part.read_bytes():
                raise RuntimeError("El PDF recibido por IPP difiere del segmento original.")
            print("IPP virtual: páginas 41–80 de 120, una copia, bytes y nombre comprobados, estado final completed.")
        finally:
            process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=3)
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stderr.close()


if __name__ == "__main__":
    main()
