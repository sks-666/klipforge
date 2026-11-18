#!/usr/bin/env python3
"""
Renders caption "cards" (transparent PNGs) for animated clip captions: bold text, colour emoji,
outlines, pills and meme boxes. ffmpeg then animates and composites them (see captions.service.ts).

Usage: render_caption_cards.py <spec.json> <out_dir>
spec: {"width": 1080, "cards": [{"id": "c0", "text": "GOOOAL! ⚽", "style": "impact",
        "color": "#ffd400", "size": 0.11, "maxWidth": 0.9,
        "left": {"text": "MILAN", "color": "#d7262e"}, "right": {...}}]}
  style: impact | pill | meme | score     size: font size as a fraction of the frame width
Prints JSON: {"cards": [{"id", "path", "w", "h"}]}
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

TEXT_FONTS = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
EMOJI_BITMAP_SIZE = 160  # Apple Color Emoji only has fixed bitmap strikes


def text_font(px):
    for path in TEXT_FONTS:
        if not os.path.exists(path):
            continue
        try:
            f = ImageFont.truetype(path, px, index=0)
            try:
                f.set_variation_by_name("Black")
            except Exception:
                try:
                    f.set_variation_by_name("Heavy")
                except Exception:
                    pass
            return f
        except Exception:
            continue
    return ImageFont.load_default(px)


_emoji_font = None


def emoji_font():
    global _emoji_font
    if _emoji_font is None and os.path.exists(EMOJI_FONT):
        try:
            _emoji_font = ImageFont.truetype(EMOJI_FONT, EMOJI_BITMAP_SIZE)
        except Exception:
            _emoji_font = False
    return _emoji_font or None


def is_emoji(ch):
    o = ord(ch)
    return (
        0x1F000 <= o <= 0x1FAFF
        or 0x2600 <= o <= 0x27BF
        or 0x2B00 <= o <= 0x2BFF
        or 0x2190 <= o <= 0x21FF
        or o in (0x231A, 0x231B, 0x23F0, 0x23F3, 0x23E9, 0x23EA, 0x2934, 0x2935, 0x3030, 0x303D)
    )


def runs(text):
    """Split into (is_emoji, string) runs; drops variation selectors / joiners."""
    out = []
    for ch in text:
        if ch in ("️", "‍"):
            continue
        e = is_emoji(ch)
        if out and out[-1][0] == e and not e:
            out[-1][1] += ch
        else:
            out.append([e, ch])
    return out


def measure_run(is_e, s, font, px):
    if is_e:
        return int(px * 1.1)
    return int(font.getlength(s))


def wrap(text, font, px, max_w):
    words = text.split(" ")
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        width = sum(measure_run(e, s, font, px) for e, s in runs(trial))
        if cur and width > max_w:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def draw_line(img, x, y, line, font, px, fill, stroke, stroke_fill):
    draw = ImageDraw.Draw(img)
    ef = emoji_font()
    for e, s in runs(line):
        if e:
            if ef is not None:
                glyph = Image.new("RGBA", (EMOJI_BITMAP_SIZE + 40, EMOJI_BITMAP_SIZE + 40), (0, 0, 0, 0))
                ImageDraw.Draw(glyph).text((20, 10), s, font=ef, embedded_color=True)
                bbox = glyph.getbbox()
                if bbox:
                    glyph = glyph.crop(bbox)
                    size = int(px * 1.0)
                    glyph = glyph.resize((size, max(1, int(size * glyph.height / glyph.width))), Image.LANCZOS)
                    img.alpha_composite(glyph, (int(x + px * 0.05), int(y + px * 0.08)))
            x += measure_run(True, s, font, px)
        else:
            draw.text((x, y), s, font=font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
            x += measure_run(False, s, font, px)


def hex_rgb(h, alpha=255):
    h = (h or "#ffffff").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def is_light(rgb):
    r, g, b = rgb[:3]
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170


def text_block(text, px, max_w, fill, stroke, stroke_fill, align="center"):
    font = text_font(px)
    lines = wrap(text, font, px, max_w)
    line_h = int(px * 1.18)
    widths = [sum(measure_run(e, s, font, px) for e, s in runs(l)) for l in lines]
    pad = stroke + 4
    w = max(widths) + pad * 2
    h = line_h * len(lines) + pad * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for i, (line, lw) in enumerate(zip(lines, widths)):
        x = pad + ((w - pad * 2 - lw) // 2 if align == "center" else 0)
        draw_line(img, x, pad + i * line_h, line, font, px, fill, stroke, stroke_fill)
    return img


def with_shadow(img, offset, blur, alpha=150):
    shadow = Image.new("RGBA", (img.width + offset * 4, img.height + offset * 4), (0, 0, 0, 0))
    mask = img.split()[3].point(lambda a: alpha if a > 0 else 0)
    shadow.paste((0, 0, 0, 255), (offset * 2, offset * 2), mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    shadow.alpha_composite(img, (offset, offset))
    return shadow


def boxed(inner, bg, radius, pad_x, pad_y):
    w, h = inner.width + pad_x * 2, inner.height + pad_y * 2
    box = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(box).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=bg)
    box.alpha_composite(inner, (pad_x, pad_y))
    return box


def render_card(card, frame_w):
    style = card.get("style", "impact")
    px = max(18, int(frame_w * float(card.get("size", 0.08))))
    max_w = int(frame_w * float(card.get("maxWidth", 0.88)))
    color = hex_rgb(card.get("color", "#ffffff"))
    text = card.get("text", "")

    if style == "impact":
        stroke = max(3, int(px * 0.11))
        img = text_block(text, px, max_w, color, stroke, (0, 0, 0, 255))
        return with_shadow(img, max(2, px // 18), max(2, px // 14))

    if style == "pill":
        fg = (20, 20, 20, 255) if is_light(color) else (255, 255, 255, 255)
        inner = text_block(text, px, max_w - px, fg, 0, (0, 0, 0, 0))
        return with_shadow(boxed(inner, color, int(px * 0.55), int(px * 0.55), int(px * 0.22)), 3, 6, 110)

    if style == "meme":
        inner = text_block(text, px, max_w - px, (255, 255, 255, 255), 0, (0, 0, 0, 0))
        return boxed(inner, (0, 0, 0, 215), int(px * 0.35), int(px * 0.5), int(px * 0.28))

    if style == "score":
        left, right = card.get("left", {}), card.get("right", {})
        parts = []
        for side in (left, right):
            c = hex_rgb(side.get("color", "#ffffff"))
            fg = (20, 20, 20, 255) if is_light(c) else (255, 255, 255, 255)
            parts.append(boxed(text_block(side.get("text", ""), px, max_w // 2, fg, 0, (0, 0, 0, 0)),
                               c, int(px * 0.3), int(px * 0.4), int(px * 0.12)))
        mid = boxed(text_block(text, int(px * 1.15), max_w // 3, (255, 255, 255, 255), 0, (0, 0, 0, 0)),
                    (15, 15, 20, 235), int(px * 0.3), int(px * 0.45), int(px * 0.05))
        gap = int(px * 0.18)
        w = parts[0].width + mid.width + parts[1].width + gap * 2
        h = max(p.height for p in parts + [mid])
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        x = 0
        for piece in (parts[0], mid, parts[1]):
            img.alpha_composite(piece, (x, (h - piece.height) // 2))
            x += piece.width + gap
        return with_shadow(img, 3, 6, 110)

    if style == "neon":
        core = text_block(text, px, max_w, (255, 255, 255, 255), max(2, px // 30), color)
        glow = Image.new("RGBA", (core.width + px, core.height + px), (0, 0, 0, 0))
        mask = core.split()[3]
        tint = Image.new("RGBA", core.size, color)
        for radius, alpha in ((px // 3, 255), (px // 7, 255)):
            layer = Image.new("RGBA", glow.size, (0, 0, 0, 0))
            layer.paste(tint, (px // 2, px // 2), mask)
            layer = layer.filter(ImageFilter.GaussianBlur(max(1, radius)))
            glow.alpha_composite(layer)
        glow.alpha_composite(core, (px // 2, px // 2))
        return glow

    if style == "outline":
        stroke = max(4, int(px * 0.14))
        img = text_block(text, px, max_w, (255, 255, 255, 255), stroke, color)
        return with_shadow(img, max(2, px // 18), max(2, px // 14), 120)

    if style == "sticker":
        ef = emoji_font()
        size = max(32, px)
        img = Image.new("RGBA", (size + 8, size + 8), (0, 0, 0, 0))
        if ef is not None:
            glyph = Image.new("RGBA", (EMOJI_BITMAP_SIZE + 40, EMOJI_BITMAP_SIZE + 40), (0, 0, 0, 0))
            first = next((s for e, s in runs(text) if e), text[:1])
            ImageDraw.Draw(glyph).text((20, 10), first, font=ef, embedded_color=True)
            bbox = glyph.getbbox()
            if bbox:
                glyph = glyph.crop(bbox).resize((size, size), Image.LANCZOS)
                img.alpha_composite(glyph, (4, 4))
        return with_shadow(img, 3, 6, 90)

    return text_block(text, px, max_w, color, 0, (0, 0, 0, 0))


def main():
    spec = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    frame_w = int(spec.get("width", 1080))
    results = []
    for card in spec.get("cards", []):
        img = render_card(card, frame_w)
        # even dimensions keep yuv420 overlays/scales happy
        if img.width % 2 or img.height % 2:
            canvas = Image.new("RGBA", (img.width + img.width % 2, img.height + img.height % 2), (0, 0, 0, 0))
            canvas.alpha_composite(img)
            img = canvas
        path = os.path.join(out_dir, f"{card['id']}.png")
        img.save(path)
        results.append({"id": card["id"], "path": path, "w": img.width, "h": img.height})
    print(json.dumps({"cards": results}))


if __name__ == "__main__":
    main()
