#!/usr/bin/env python3
"""AS Print Agent. Only the enrolled CUPS queues can receive frozen production PDFs."""
import argparse
import contextlib
import fcntl
import getpass
import hashlib
import json
import os
import plistlib
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "https://us-central1-sistema-desarrollo-proyectos.cloudfunctions.net/printAgentGateway"
ROOT = Path.home() / ".local" / "state" / "as-print-agent"
QUEUE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,126}\Z")
MAX_PDF = 500 * 1024 * 1024
TOKEN = re.compile(r"[a-f0-9]{32}\.[a-f0-9]{48}\Z")
MATERIALS = {"a4": "A4", "a3": "A3", "a5": "A5", "carta": "Letter", "letter": "Letter",
             "legal": "Legal", "oficio": "Legal"}
# CUPS and PDF inspection tools never come from job or server parameters.
BIN_DIRS = ("/usr/bin", "/usr/sbin", "/opt/homebrew/bin", "/usr/local/bin", "/bin")


class AgentError(Exception):
    pass


class IntegrityError(AgentError):
    pass


class RemoteError(Exception):
    def __init__(self, status):
        super().__init__("Respuesta del servicio HTTP " + str(status))
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def binary(name):
    for directory in BIN_DIRS:
        candidate = Path(directory) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise AgentError("Falta el ejecutable " + name)


def run_tool(name, args, timeout=45):
    env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PATH": ":".join(BIN_DIRS)}
    # Only query the local spooler configured on this computer.
    env.pop("CUPS_SERVER", None)
    try:
        return subprocess.run([binary(name), *args], shell=False, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, errors="replace", timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AgentError("El comando " + name + " no terminó correctamente.") from exc


def options(text):
    result = {}
    for line in text.splitlines():
        match = re.match(r"^([A-Za-z0-9_-]+)(?:/[^:]*)?:\s*(.*)$", line)
        if match:
            result[match[1]] = [word.lstrip("*") for word in match[2].split()
                                if re.fullmatch(r"\*?[a-zA-Z0-9_.-]{1,64}", word)]
    return result


def quality_choices(settings):
    quality = settings.get("cupsPrintQuality", [])
    terms = {"draft": ("draft", "3"), "normal": ("normal", "4"), "high": ("high", "5")}
    return {key: next((v for v in quality if v.lower() in names), None) for key, names in terms.items()}


def capabilities(queue, available, settings):
    paper = settings.get("PageSize", settings.get("media", []))
    modes = settings.get("ColorModel", settings.get("print-color-mode", []))
    sides = settings.get("Duplex", settings.get("sides", []))
    names = list(dict.fromkeys(normalize_paper(name) for name in paper))
    return {"queue": queue, "online": available, "paperSizes": names[:128],
            "capabilities": {"pageRange": any(os.access(Path(d) / "qpdf", os.X_OK) for d in BIN_DIRS),
                "trays": settings.get("InputSlot", [])[:64], "quality": [k for k,v in quality_choices(settings).items() if v]},
            "color": any(v.lower() in ("color", "rgb", "srgb", "adobergb", "cmyk", "cmy") for v in modes),
            "duplex": any(v.lower() in ("duplexnotumble", "two-sided-long-edge") for v in sides)}


def ipp_request(uri, test):
    # Machine-readable IPP attributes also work on Macs that ignore LC_ALL for CUPS messages.
    result = run_tool("ipptool", ["-X", uri, str(Path(__file__).with_name(test))], timeout=15)
    if result.returncode:
        raise AgentError("No se pudo consultar el servidor local de impresión.")
    try:
        tests = plistlib.loads(result.stdout.encode())["Tests"]
        return tests[0].get("ResponseAttributes", [])
    except (ValueError, IndexError, KeyError, plistlib.InvalidFileException) as err:
        raise AgentError("CUPS devolvió atributos inválidos.") from err


def discover(allowed=None):
    result = {}
    for item in ipp_request("ipp://localhost/", "printers.test"):
        queue = item.get("printer-name", "")
        if not QUEUE.fullmatch(queue) or (allowed is not None and queue not in allowed):
            continue
        reasons = item.get("printer-state-reasons", [])
        reasons = reasons if isinstance(reasons, list) else [reasons]
        unavailable = any("offline" in reason or "missing-filter" in reason or
                          "shutdown" in reason or reason.endswith("-error") for reason in reasons)
        available = item.get("printer-is-accepting-jobs") is True and item.get("printer-state") in (3, 4) and not unavailable
        raw = run_tool("lpoptions", ["-p", queue, "-l"], timeout=15)
        settings = options(raw.stdout)
        cap = capabilities(queue, available, settings)
        cap["statusReasons"] = reasons[:12]
        result[queue] = (cap, settings)
    return result


def normalize_paper(value):
    key = str(value).strip().lower()
    for prefix, name in (("iso_a4_", "A4"), ("iso_a3_", "A3"), ("iso_a5_", "A5"),
                         ("na_letter_", "Letter"), ("na_legal_", "Legal")):
        if key.startswith(prefix):
            return name
    return MATERIALS.get(key, value)


def selected_options(task, settings):
    cfg = task.get("config", {})
    result = []
    paper = normalize_paper(cfg.get("paper", "Letter"))
    paper_values = settings.get("PageSize", settings.get("media", []))
    selected = next((value for value in paper_values if normalize_paper(value) == paper), None)
    if not selected:
        raise AgentError("Papel no anunciado por la cola.")
    result += ["-o", "media=" + selected]
    duplex = cfg.get("duplex", False)
    if not isinstance(duplex, bool):
        raise AgentError("Formato dúplex no compatible.")
    if duplex and not capabilities(task["queue"], True, settings)["duplex"]:
        raise AgentError("La cola no anuncia impresión dúplex.")
    result += ["-o", "sides=" + ("two-sided-long-edge" if duplex else "one-sided")]
    color = str(cfg.get("color", False)).strip().lower()
    if color not in ("true", "color", "a color", "false", "mono", "monochrome", "bw", "grayscale", "blanco y negro", "bn", "b/n"):
        raise AgentError("Modo de color no compatible.")
    use_color = color in ("true", "color", "a color")
    cmap = ("color", "rgb", "srgb", "adobergb", "cmyk", "cmy") if use_color else ("monochrome", "gray", "grey", "grayscale", "black", "blackonly", "mono")
    color_key = "ColorModel" if "ColorModel" in settings else "print-color-mode"
    modes = settings.get(color_key, [])
    choice = next((word for word in modes if word.lower() in cmap), None)
    if not choice and (use_color or modes):
        raise AgentError("Modo de color no anunciado por la cola.")
    result += ["-o", color_key + "=" + choice] if choice else ["-o", "print-color-mode=monochrome"]
    if cfg.get("layout", "standard") != "standard" or cfg.get("pagesPerSheet", 1) != 1:
        raise AgentError("Esta versión admite una página por cara, sin imposición de cuadernillos.")
    if cfg.get("orientation") == "portrait":
        result += ["-o", "orientation-requested=3"]
    if cfg.get("orientation", "auto") not in ("auto", "portrait", "vertical", ""):
        if cfg.get("orientation") not in ("landscape", "horizontal"):
            raise AgentError("Orientación no compatible.")
        result += ["-o", "orientation-requested=4"]
    if cfg.get("scale") not in (None, "", 100, "100", "actual", "none"):
        raise AgentError("Solo se admite la escala original.")
    result += ["-o", "print-scaling=none"]
    for key in ("tray", "mediaType", "quality"):
        value = cfg.get(key)
        if value in (None, "", "auto", "default", "normal", "standard", "estándar"):
            continue
        local = {"tray": "InputSlot", "mediaType": "MediaType", "quality": "cupsPrintQuality"}[key]
        if key == "quality":
            value = quality_choices(settings).get(value)
        if value not in settings.get(local, []):
            raise AgentError("La cola no anuncia el ajuste " + key + ".")
        result += ["-o", local + "=" + value]
    if cfg.get("order", "normal") not in ("normal", "forward", ""):
        if cfg["order"] != "reverse":
            raise AgentError("Orden no admitido.")
        result += ["-o", "outputorder=reverse"]
    if not isinstance(cfg.get("collate", True), bool):
        raise AgentError("Intercalado inválido.")
    result += ["-o", "Collate=" + ("True" if cfg.get("collate", True) else "False")]
    return result


class Client:
    def __init__(self, identity):
        self.identity = identity
        self.opener = urllib.request.build_opener(NoRedirect())

    def send(self, op, **data):
        request = urllib.request.Request(ENDPOINT, data=json.dumps({"op": op, **data}).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Print-Agent": self.identity["id"],
                     "Authorization": "Bearer " + self.identity["credential"]})
        try:
            return self.opener.open(request, timeout=65)
        except urllib.error.HTTPError as err:
            err.close()
            raise RemoteError(err.code) from None

    def call(self, op, **data):
        with self.send(op, **data) as response:
            return json.loads(response.read(1024 * 1024))

    def download(self, task, dest):
        offset, total, generation, last_renew = 0, None, None, time.monotonic()
        sha = hashlib.sha256()
        with dest.open("xb") as out:
            while total is None or offset < total:
                if time.monotonic() - last_renew >= 45:
                    self.call("renew", **ticket(task))
                    last_renew = time.monotonic()
                with self.send("chunk", **ticket(task), offset=offset, generation=generation) as response:
                    size = int(response.headers["X-Pdf-Size"])
                    gen = response.headers["X-Pdf-Generation"]
                    if not 0 < size <= MAX_PDF or (total is not None and (total, generation) != (size, gen)):
                        raise IntegrityError("Tamaño o versión del archivo inválidos.")
                    total, generation = size, gen
                    data = response.read(4 * 1024 * 1024 + 1)
                    if len(data) != min(4 * 1024 * 1024, total-offset):
                        raise IntegrityError("Fragmento incompleto.")
                    sha.update(data)
                    out.write(data)
                    offset += len(data)
        if not secrets.compare_digest(sha.hexdigest(), task["sha256"]):
            raise IntegrityError("La huella del documento no coincide.")


def ticket(task):
    return {field: task[field] for field in ("jobId", "partId", "lease")}


def prepare_pdf(source, dest, task):
    count = run_tool("qpdf", ["--show-npages", str(source)], 90)
    if count.returncode or not count.stdout.strip().isdigit():
        raise AgentError("PDF dañado o cifrado.")
    pages = int(count.stdout.strip())
    first, last = task["from"], task["to"]
    if pages != task.get("pages") or not (1 <= first <= last <= pages):
        raise IntegrityError("La paginación no coincide con la versión registrada.")
    if not isinstance(task["copies"], int) or not 1 <= task["copies"] <= 999:
        raise AgentError("Cantidad no admitida por CUPS.")
    if (first, last) == (1, pages):
        return source
    # QPDF imports the original page objects, preserving content, fonts, dimensions and marks.
    result = run_tool("qpdf", ["--empty", "--pages", str(source), str(first) + "-" + str(last), "--", str(dest)], 120)
    if result.returncode:
        raise AgentError("No se pudo extraer el rango de páginas.")
    return dest


def spool_id(output, queue):
    match = re.search(r"(?:^|\s)" + re.escape(queue) + r"-(\d+)(?:\s|$)", output)
    return int(match[1]) if match else None


def spool_state(spool, job_name):
    try:
        groups = ipp_request("ipp://localhost/jobs/" + str(int(spool)), "job-status.test")
    except AgentError:
        return "unknown"
    job = next((g for g in groups if g.get("job-name") == job_name), {})
    state = job.get("job-state")
    if state == 9:
        return "spoolCompleted"
    if state in (6, 7, 8):
        return "stopped"
    if state not in (3, 4, 5):
        return "unknown"
    return "active"


def job_title(task):
    return "AS-" + hashlib.sha256(task["lease"].encode()).hexdigest()[:24]


def open_journal(directory):
    db = sqlite3.connect(directory / "journal.sqlite")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA synchronous=FULL")
    db.execute("""CREATE TABLE IF NOT EXISTS attempts(
      lease TEXT PRIMARY KEY, task TEXT NOT NULL, phase TEXT NOT NULL,
      spool INTEGER, reason TEXT, changed REAL NOT NULL)""")
    return db


def mark(db, lease, phase, spool=None, reason=None):
    with db:
        db.execute("UPDATE attempts SET phase=?, spool=COALESCE(?, spool), reason=?, changed=? WHERE lease=?",
                   (phase, spool, reason, time.time(), lease))


def remember(db, task):
    # Do not store document bytes, participant names, observations or sources in the local journal.
    saved = {k: task[k] for k in ("jobId", "partId", "lease", "queue", "from", "to", "copies", "config", "sha256", "pages")}
    saved["config"] = {k: v for k, v in saved["config"].items() if k in
                       ("paper", "duplex", "color", "scale", "quality", "orientation", "tray", "mediaType", "order", "collate", "layout", "pagesPerSheet")}
    with db:
        db.execute("INSERT OR IGNORE INTO attempts VALUES(?,?,'ready',NULL,NULL,?)",
                   (task["lease"], json.dumps(saved), time.time()))


def process_ready(client, db, task, queues, cache):
    lease = task["lease"]
    try:
        info = queues.get(task["queue"])
        if not info or not info[0]["online"]:
            raise AgentError("Cola inhabilitada.")
        options_ = selected_options(task, info[1])
        with tempfile.TemporaryDirectory(dir=cache) as tmp:
            original = Path(tmp) / "original.pdf"
            client.download(task, original)
            document = prepare_pdf(original, Path(tmp) / "segment.pdf", task)
            # Commit BEFORE an irreversible 'lp'. Any interruption from here needs reconciliation.
            mark(db, lease, "arming")
            client.call("start", **ticket(task))
            mark(db, lease, "submitting")
            printed = run_tool("lp", ["-d", task["queue"], "-n", str(task["copies"]), "-t", job_title(task),
                                      *options_, "--", str(document)], timeout=90)
            spool = spool_id(printed.stdout, task["queue"])
            if printed.returncode or not spool:
                mark(db, lease, "confirmation", reason="uncertain")
            else:
                mark(db, lease, "accepted", spool=spool)
    except (AgentError, OSError) as exc:
        current = db.execute("SELECT phase FROM attempts WHERE lease=?", (lease,)).fetchone()[0]
        if current in ("arming", "submitting"):
            mark(db, lease, "confirmation", reason="uncertain")
        else:
            # Network/OS failure before 'start' can be retried without submitting anything.
            if isinstance(exc, OSError):
                raise
            mark(db, lease, "error", reason="integrity" if isinstance(exc, IntegrityError) else "input")


def reconcile(client, db, row, queues, cache):
    task = json.loads(row["task"])
    lease, phase = row["lease"], row["phase"]
    try:
        if phase == "ready":
            process_ready(client, db, task, queues, cache)
        elif phase in ("arming", "submitting"):
            # Unknown outcome after crash. Never infer "unprinted" from an empty CUPS history.
            mark(db, lease, "confirmation", reason="uncertain")
        elif phase == "accepted":
            client.call("report", **ticket(task), state="submitted", spoolId=row["spool"])
            mark(db, lease, "monitor", spool=row["spool"])
        elif phase == "monitor":
            state = spool_state(row["spool"], job_title(task))
            if state == "spoolCompleted":
                mark(db, lease, state)
            elif state == "stopped" or (state == "unknown" and time.time() - row["changed"] >= 300):
                mark(db, lease, "confirmation", reason="stopped" if state == "stopped" else "uncertain")
        elif phase in ("confirmation", "error", "spoolCompleted"):
            client.call("report", **ticket(task), state=phase, reason=row["reason"])
            mark(db, lease, "done")
    except RemoteError as err:
        if err.status in (404, 409):
            # A revoked/superseded attempt can never become a new launch.
            mark(db, lease, "obsolete")
        else:
            raise


def read_identity(directory):
    path = directory / "identity.json"
    if not path.exists() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise AgentError("Vincula este agente primero. La identidad debe tener permisos 0600.")
    return json.loads(path.read_text())


def save_identity(directory, data):
    fd, name = tempfile.mkstemp(dir=directory)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(name, directory / "identity.json")


def pair(directory, allowed):
    listing = discover()
    if not allowed or len(allowed) > 30 or len(set(allowed)) != len(allowed) or not set(allowed) <= listing.keys():
        raise AgentError("Selecciona de una a treinta colas distintas mostradas por diagnose.")
    code = getpass.getpass("Código de vinculación: ").strip()
    if not TOKEN.fullmatch(code):
        raise AgentError("Código inválido.")
    agent_id, token = code.split(".")
    if (directory / "identity.json").exists():
        identity = read_identity(directory)
        if identity["id"] != agent_id:
            raise AgentError("Existe una identidad anterior. Revócala en la web y usa un directorio de estado nuevo.")
    else:
        identity = {"id": agent_id, "credential": secrets.token_hex(32), "queues": allowed}
        save_identity(directory, identity)
    service = Client(identity)
    service.call("pair", code=token)
    identity["queues"] = allowed
    save_identity(directory, identity)
    service.call("heartbeat", printers=[listing[q][0] for q in allowed])
    print("Agente vinculado. Colas autorizadas:", ", ".join(allowed))


def work(directory):
    identity = read_identity(directory)
    client, db = Client(identity), open_journal(directory)
    # Only clean the private cache, after acquiring the single-instance lock in main().
    cache = directory / "pdf-cache"
    if cache.exists():
        shutil.rmtree(cache)
    cache.mkdir(mode=0o700)
    queues, cursor, next_heartbeat = {}, None, 0
    while True:
        try:
            if time.monotonic() >= next_heartbeat:
                queues = discover(identity["queues"])
                client.call("heartbeat", printers=[v[0] for v in queues.values()])
                next_heartbeat = time.monotonic() + 60
            rows = db.execute("SELECT * FROM attempts WHERE phase NOT IN ('done','obsolete') ORDER BY changed").fetchall()
            for row in rows:
                reconcile(client, db, row, queues, cache)
            online = [q for q, cap in queues.items() if cap[0]["online"]]
            reply = client.call("claim", queues=online, cursor=cursor) if online else {}
            cursor = reply.get("cursor")
            if reply.get("task"):
                remember(db, reply["task"])
            with db:
                db.execute("DELETE FROM attempts WHERE phase IN ('done','obsolete') AND changed < ?", (time.time() - 30*86400,))
            time.sleep(1 if reply.get("task") or cursor or any(r["phase"] != "monitor" for r in rows) else 20)
        except (RemoteError, OSError, AgentError, ValueError) as err:
            # No credentials, document names or HTTP request contents enter logs.
            print("Agente:", str(err), file=sys.stderr, flush=True)
            if isinstance(err, RemoteError) and err.status in (401, 403):
                return 2
            time.sleep(15)


@contextlib.contextmanager
def locked(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink() or directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077:
        raise AgentError("El directorio de estado debe ser privado y pertenecer al usuario actual.")
    with (directory / "agent.lock").open("a") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AgentError("Este agente ya se está ejecutando.") from None
        yield


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("--state", type=Path, default=ROOT)
    cmds = arg.add_subparsers(dest="cmd", required=True)
    cmds.add_parser("diagnose")
    cmds.add_parser("run")
    enroll = cmds.add_parser("pair")
    enroll.add_argument("--queue", action="append", required=True)
    args = arg.parse_args()
    os.umask(0o077)
    if args.cmd == "diagnose":
        listing = discover()
        for name in ("lp", "lpstat", "lpoptions", "ipptool", "qpdf"):
            try: print(name, binary(name))
            except AgentError as err: print(err)
        print(json.dumps([v[0] for v in listing.values()], ensure_ascii=False, indent=2))
        return 0
    with locked(args.state):
        if args.cmd == "pair":
            pair(args.state, args.queue)
            return 0
        return work(args.state)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AgentError, OSError, RemoteError) as error:
        sys.exit(str(error))
