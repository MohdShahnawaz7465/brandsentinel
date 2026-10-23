"""File helpers: .docx text with image alt text, and image colour analysis. Port of src/files.js.
Pillow is used for images when it is installed."""
from __future__ import annotations

import html
import io
import re
import zipfile

_TOKEN = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:tab\s*/>|<w:br\s*/>|<wp:docPr\b([^>]*)>")


def docx_xml_to_text(xml: str) -> str:
    out = []
    for p in xml.split("</w:p>"):
        line = ""
        for m in _TOKEN.finditer(p):
            if m.group(1) is not None:
                line += html.unescape(m.group(1))
            elif m.group(2) is not None:
                d = re.search(r'\bdescr="([^"]*)"', m.group(2))
                line += (" " if line else "") + "![" + (html.unescape(d.group(1)).strip() if d else "") + "](image) "
            else:
                line += "\t" if m.group(0).startswith("<w:tab") else "\n"
        line = line.strip()
        if line:
            out.append(line)
    return "\n".join(out)


def read_docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if "word/document.xml" not in z.namelist():
                raise ValueError
            return docx_xml_to_text(z.read("word/document.xml").decode("utf-8"))
    except (zipfile.BadZipFile, ValueError, KeyError):
        raise ValueError("This does not look like a Word (.docx) file.") from None


def dominant_colours(rgba: bytes, top_n: int = 4) -> list[dict]:
    buckets: dict[int, list[int]] = {}
    total = 0
    for i in range(0, len(rgba) - 3, 4):
        if rgba[i + 3] < 128:
            continue
        r, g, b = rgba[i], rgba[i + 1], rgba[i + 2]
        e = buckets.setdefault((r >> 5) << 6 | (g >> 5) << 3 | (b >> 5), [0, 0, 0, 0])
        e[0] += 1; e[1] += r; e[2] += g; e[3] += b
        total += 1
    items = sorted(buckets.values(), key=lambda e: -e[0])[:top_n]
    return [{"hex": "#%02X%02X%02X" % (round(e[1] / e[0]), round(e[2] / e[0]), round(e[3] / e[0])), "share": e[0] / total if total else 0} for e in items]


def analyse_image(data: bytes) -> dict:
    """Width, height and main colours of an image. Needs Pillow."""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    width, height = im.size
    small = im.convert("RGBA").resize((64, 64))
    return {"width": width, "height": height, "dominant": dominant_colours(small.tobytes(), 4)}
