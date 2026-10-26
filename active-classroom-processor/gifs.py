"""Structural GIF handling, stdlib only. LZW pixel data is never decoded.

The scanner walks blocks (header, screen descriptor, palettes, extensions,
image descriptors, sub-blocks, trailer) and counts frames from image
descriptors, never from raw 0x2c bytes. Reading is incremental and bounded, so
huge animations are limited without being expanded.
"""
import shutil
import struct
import zipfile

MAX_GIF_BYTES = 15 * 1024 * 1024
MAX_FREEZE_PIXELS = 32_000_000
MAX_FRAMES = 1000
MAX_GIF_MEMBERS = 256
MAX_FREEZE_READ_BYTES = 256 * 1024 * 1024
MAGIC = (b"GIF87a", b"GIF89a")
# 1x1 transparent GIF used when a GIF cannot be frozen safely.
PLACEHOLDER_GIF = bytes.fromhex(
    "474946383961" "01000100800000" "000000ffffff" "21f9040100000000"
    "2c000000000100010000" "0202440100" "3b")


class GifError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class _Truncated(Exception):
    pass


class _Reader:
    def __init__(self, stream, limit):
        self.stream, self.limit, self.pos = stream, limit, 0

    def read(self, size):
        if self.pos + size > self.limit:
            raise GifError("gif-too-large")
        data = b""
        while len(data) < size:
            chunk = self.stream.read(size - len(data))
            if not chunk:
                raise _Truncated()
            data += chunk
        self.pos += size
        return data

    def blocks(self, keep):
        """Consume a sub-block sequence up to its zero terminator."""
        out = bytearray()
        while True:
            length = self.read(1)
            if keep:
                out += length
            if length[0] == 0:
                return bytes(out) if keep else None
            chunk = self.read(length[0])
            if keep:
                out += chunk


def _scan(reader, info, first, keep, stop_at):
    header = reader.read(6)
    if header not in MAGIC:
        raise GifError("not-gif")
    screen = reader.read(7)
    width, height, packed = struct.unpack("<HHB", screen[:5])
    if not width or not height:
        raise GifError("invalid-dimensions")
    if width * height > MAX_FREEZE_PIXELS:
        raise GifError("canvas-too-large")
    info["width"], info["height"] = width, height
    table = reader.read(3 << ((packed & 7) + 1)) if packed & 0x80 else b""
    first["head"] = header + screen + table
    gce = None
    while True:
        marker = reader.read(1)[0]
        if marker == 0x3B:
            if not info["frameCount"]:
                raise GifError("no-frames")
            info["complete"] = True
            return
        if marker == 0x21:
            label = reader.read(1)[0]
            body = reader.blocks(keep=label == 0xF9)
            if label == 0xF9:
                gce = body if len(body) == 6 and body[0] == 4 else None
        elif marker == 0x2C:
            if stop_at and info["frameCount"] + 1 >= stop_at:
                info["frameCount"] += 1
                info["stopped"] = True
                return
            descriptor = reader.read(9)
            frame_x, frame_y, frame_width, frame_height, flags = struct.unpack("<HHHHB", descriptor)
            if not frame_width or not frame_height or frame_width * frame_height > MAX_FREEZE_PIXELS:
                raise GifError("frame-too-large")
            if frame_x + frame_width > width or frame_y + frame_height > height:
                raise GifError("frame-outside-canvas")
            local = reader.read(3 << ((flags & 7) + 1)) if flags & 0x80 else b""
            if not table and not local:
                raise GifError("missing-palette")
            code_size = reader.read(1)
            if not 2 <= code_size[0] <= 8:
                raise GifError("invalid-lzw")
            data = reader.blocks(keep=keep and not info["frameCount"])
            info["frameCount"] += 1
            info["framePixels"] += frame_width * frame_height
            if info["frameCount"] == 1:
                first.update(gce=gce, descriptor=descriptor, local=local, code=code_size, data=data)
                info["hasTransparency"] = bool(gce and gce[1] & 1)
            if info["frameCount"] > MAX_FRAMES:
                raise GifError("too-many-frames")
            gce = None
        else:
            raise GifError("invalid-block")


def scan_gif(stream, max_bytes=MAX_GIF_BYTES, stop_at_frame=None, keep_first=False):
    """Scan a GIF from a binary stream without decoding pixels.

    Returns width, height, frameCount, framePixels, complete (trailer seen),
    truncated, stopped (stopped at image descriptor number ``stop_at_frame``;
    frameCount is then "at least"), error (code of a structural problem found
    after a complete first frame), hasTransparency and bytesRead. Raises
    GifError when nothing usable (header or first frame) can be established.
    """
    info = {"width": 0, "height": 0, "frameCount": 0, "framePixels": 0, "complete": False,
            "truncated": False, "stopped": False, "error": None, "hasTransparency": False}
    first = {}
    reader = _Reader(stream, max_bytes)
    try:
        _scan(reader, info, first, keep_first, stop_at_frame)
    except (GifError, _Truncated) as problem:
        if "data" not in first:
            if isinstance(problem, _Truncated):
                raise GifError("truncated") from None
            raise
        # First frame is intact: later damage only limits what we can certify.
        if isinstance(problem, _Truncated):
            info["truncated"] = True
        else:
            info["error"] = problem.code
    info["bytesRead"] = reader.pos
    if keep_first:
        info["first"] = first
    return info


def freeze_first_frame(stream, max_bytes=MAX_GIF_BYTES):
    """Return (bytes, info) of a single-frame GIF made from the first frame.

    The first frame's bytes, palettes and its Graphic Control Extension are kept
    verbatim; animation extensions and later frames are dropped. Reading stops
    at the second image descriptor.
    """
    info = scan_gif(stream, max_bytes, stop_at_frame=2, keep_first=True)
    first = info.pop("first")
    gce = b"\x21\xf9" + first["gce"] if first["gce"] else b""
    frozen = b"".join([first["head"], gce, b"\x2c", first["descriptor"], first["local"],
                       first["code"], first["data"], b"\x3b"])
    return frozen, info


def clone_zipinfo(item):
    """Fresh ZipInfo; writing through the source object would mutate its offsets."""
    clone = zipfile.ZipInfo(item.filename, item.date_time)
    clone.compress_type = item.compress_type
    clone.external_attr = item.external_attr
    clone.create_system = item.create_system
    return clone


def copy_member(archive, item, output):
    if item.is_dir():
        output.writestr(clone_zipinfo(item), b"")
        return
    with archive.open(item) as stream, output.open(clone_zipinfo(item), "w", force_zip64=item.file_size >= 0x7FFFFFFF) as destination:
        shutil.copyfileobj(stream, destination, 65536)


def _decide(archive, item):
    """Return (keep|freeze|placeholder, bytes consumed) for one GIF member."""
    try:
        with archive.open(item) as stream:
            info = scan_gif(stream, MAX_GIF_BYTES, stop_at_frame=2)
    except Exception:
        # Corrupt GIF, unreadable member or damaged deflate stream.
        return "placeholder", 1024 * 1024
    single = info["complete"] and not info["stopped"] and not info["error"] and info["frameCount"] == 1
    return ("keep" if single else "freeze"), info["bytesRead"]


def freeze_pptx_gifs(source, target):
    """Write ``target`` as a copy of ``source`` whose GIF media are single-frame.

    Streams the ZIP; ``source`` is never modified and ``target`` is only
    created when something changed. Animated or damaged-after-frame-1 GIFs are
    reduced to their first frame; GIFs with no usable first frame, or beyond
    the member/read budgets, become a transparent 1x1 placeholder. OOXML parts
    and relationships are copied untouched.
    Returns {"changed", "frozen", "placeholders", "warnings"}.
    """
    report = {"changed": False, "frozen": 0, "placeholders": 0, "warnings": []}
    decisions, spent = {}, 0
    with zipfile.ZipFile(source) as archive:
        for item in archive.infolist():
            name = item.filename
            if item.is_dir() or not name.startswith("ppt/") or name.endswith((".xml", ".rels")):
                continue
            try:
                with archive.open(item) as stream:
                    if stream.read(6) not in MAGIC and not name.lower().endswith(".gif"):
                        continue
            except Exception:
                continue
            if len(decisions) >= MAX_GIF_MEMBERS or spent >= MAX_FREEZE_READ_BYTES:
                decisions[name] = "placeholder"
                continue
            decisions[name], used = _decide(archive, item)
            spent += used
        pending = {name: action for name, action in decisions.items() if action != "keep"}
        if not pending:
            return report
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as output:
            for item in archive.infolist():
                action = pending.get(item.filename)
                if action is None:
                    copy_member(archive, item, output)
                    continue
                data = PLACEHOLDER_GIF
                if action == "freeze":
                    try:
                        with archive.open(item) as stream:
                            data, _info = freeze_first_frame(stream)
                    except Exception:
                        data = PLACEHOLDER_GIF
                report["frozen" if data is not PLACEHOLDER_GIF else "placeholders"] += 1
                output.writestr(clone_zipinfo(item), data)
    report["changed"] = True
    if report["frozen"]:
        report["warnings"].append(f"gif-first-frame:{report['frozen']}")
    if report["placeholders"]:
        report["warnings"].append(f"gif-placeholder:{report['placeholders']}")
    return report
