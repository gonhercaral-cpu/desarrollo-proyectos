import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import agent


def sample_pdf(pages):
    # Valid xref/object offsets; no fixture includes personalized data.
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               ("<< /Type /Pages /Kids ["+" ".join(str(i+3)+" 0 R" for i in range(pages))+"] /Count "+str(pages)+" >>").encode()]
    objects.extend(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>" for _ in range(pages))
    data = bytearray(b"%PDF-1.5\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(str(index).encode()+b" 0 obj\n"+obj+b"\nendobj\n")
    xref = len(data)
    data.extend(("xref\n0 "+str(len(offsets))+"\n0000000000 65535 f \n").encode())
    for off in offsets[1:]:
        data.extend(("%010d 00000 n \n" % off).encode())
    data.extend(("trailer\n<< /Root 1 0 R /Size "+str(len(offsets))+" >>\nstartxref\n"+str(xref)+"\n%%EOF\n").encode())
    return bytes(data)


class Client:
    def __init__(self, pdf):
        self.pdf = pdf
        self.calls = []

    def download(self, task, dest):
        dest.write_bytes(self.pdf)

    def call(self, op, **args):
        self.calls.append((op, args))


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.db = agent.open_journal(self.path)
        self.client = Client(sample_pdf(120))
        self.task = dict(lease="a"*48, jobId="book", partId="p1", queue="T", copies=100, pages=120,
                         to=40, config={"paper": "A4", "color": "mono", "duplex": True}, sha256=hashlib.sha256(self.client.pdf).hexdigest())
        self.task["from"] = 1
        self.settings = agent.options("PageSize/Papel: A4 *Letter\nColorModel/Color: *Gray RGB\nDuplex/Dúplex: *None DuplexNoTumble")
        self.queues = {"T": (agent.capabilities("T", True, self.settings), self.settings)}

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def row(self):
        return self.db.execute("SELECT * FROM attempts").fetchone()

    def test_pdf_real_120_paginas_tres_segmentos(self):
        inp = self.path/"source.pdf"
        inp.write_bytes(self.client.pdf)
        for i in range(3):
            segment = dict(self.task, to=(i+1)*40)
            segment["from"] = i*40+1
            dest = agent.prepare_pdf(inp, self.path/("range" + str(i) + ".pdf"), segment)
            self.assertEqual(agent.run_tool("qpdf", ["--show-npages", str(dest)]).stdout.strip(), "40")
        with self.assertRaises(agent.IntegrityError):
            agent.prepare_pdf(inp, self.path/"bad.pdf", dict(self.task, pages=121))

    def test_confirmacion_sqlite_despues_de_reinicio_sin_reimpresion(self):
        agent.remember(self.db, self.task)
        agent.mark(self.db, self.task["lease"], "submitting")
        self.db.close()
        self.db = agent.open_journal(self.path)
        with patch.object(agent, "run_tool", side_effect=AssertionError("reenvío")):
            agent.reconcile(self.client, self.db, self.row(), self.queues, self.path)
            agent.reconcile(self.client, self.db, self.row(), self.queues, self.path)
        self.assertEqual(self.row()["phase"], "done")
        self.assertEqual(self.client.calls[-1][1]["state"], "confirmation")

    def test_cola_controlada_spool_aceptado_una_vez(self):
        agent.remember(self.db, self.task)
        sent = []
        real_tool = agent.run_tool
        def controlled(name, args, *other, **opts):
            if name != "lp":
                return real_tool(name, args, *other, **opts)
            sent.append(args)
            self.assertEqual(self.row()["phase"], "submitting")
            self.assertEqual(real_tool("qpdf", ["--show-npages", args[-1]]).stdout.strip(), "40")
            return subprocess.CompletedProcess([], 0, "request id is T-9 (1 file(s))", "")
        with patch.object(agent, "run_tool", side_effect=controlled):
            for _ in range(2):
                agent.reconcile(self.client, self.db, self.row(), self.queues, self.path)
            with patch.object(agent, "spool_state", return_value="spoolCompleted"):
                for _ in range(2):
                    agent.reconcile(self.client, self.db, self.row(), self.queues, self.path)
        self.assertEqual(len(sent), 1)
        self.assertIn("100", sent[0])
        self.assertIn("sides=two-sided-long-edge", sent[0])
        self.assertEqual([c[1].get("state") for c in self.client.calls], [None, "submitted", "spoolCompleted"])
        self.assertEqual(len(list(self.path.glob("*.pdf"))), 0)

    def test_papel_no_disponible_se_rechaza_antes_del_envio(self):
        self.task["config"]["paper"] = "A3"
        agent.remember(self.db, self.task)
        with patch.object(agent, "run_tool", side_effect=AssertionError("reenvío")):
            agent.reconcile(self.client, self.db, self.row(), self.queues, self.path)
        self.assertEqual(self.row()["phase"], "error")
        self.assertEqual(self.client.calls, [])

    def test_cola_ajena_y_ajustes_invalidos(self):
        for queue in ("../x", "-dX", "A $b", "A/B"):
            self.assertFalse(agent.QUEUE.fullmatch(queue))
        with self.assertRaises(agent.AgentError):
            agent.selected_options(dict(self.task, config={"paper": "A4", "color": "invalido"}), self.settings)


if __name__ == "__main__":
    unittest.main()
