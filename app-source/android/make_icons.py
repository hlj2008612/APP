#!/usr/bin/env python
# -*- coding: UTF-8 -*-
"""
为「美琴的照片墙」APP 生成自适应图标资源。

设计意图（与原项目视觉语言一致）：
  背景  用主色 #8b6ce8 的深色渐变，和 main.css 里 --theme-color 同源
  图形  三张错落叠放的圆角照片卡，直接点题「照片墙」
  描边  浅紫高光，避免纯色块在深色启动画面上发闷

Android 自适应图标结构（API 26+）：
  ic_launcher_background  纯背景层，会被系统裁成各种形状
  ic_launcher_foreground  前景层，安全区是中间 66%（108dp 里的 72dp）
  必需保证前景的「主体」落在安全区内，否则圆角/圆形遮罩会切掉。

旧版（API < 26）仍需要 flat 的 mipmap ic_launcher / ic_launcher_round。

用法：py make_icons.py
"""
import os
import struct
import zlib

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    raise SystemExit("需要 Pillow：py -m pip install Pillow")

ROOT = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(ROOT, "app", "src", "main", "res")

# 与 main.css --theme-color 同源，往深里压一点，保证白色前景有对比
BG_TOP = (108, 76, 200)     # #6c4cc8
BG_BOTTOM = (32, 20, 60)    # #20143c
ACCENT = (255, 255, 255)
ACCENT_SOFT = (214, 198, 255)   # #d6c6ff

# density -> 传统 mipmap 边长（48dp 基准）
LEGACY_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# 自适应图标每层固定 108dp
ADAPTIVE_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}


def vertical_gradient(size, top, bottom):
    """造一张竖向渐变底图。逐行画，size 最大 432，性能无所谓。"""
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        # 用一点缓动让过渡更自然
        t = t ** 0.85
        r = round(top[0] + (bottom[0] - top[0]) * t)
        g = round(top[1] + (bottom[1] - top[1]) * t)
        b = round(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def radial_glow(size, color, center, radius, alpha=110):
    """叠一团柔和辉光，让背景不至于太死。"""
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 26
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(alpha * (1 - i / steps) ** 1.6)
        if a <= 0:
            continue
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(color[0], color[1], color[2], a))
    return glow.filter(ImageFilter.GaussianBlur(radius * 0.06))


def draw_photo_cards(size, scale, opacity=255):
    """
    画三张错落的圆角照片卡。
    size  画布边长
    scale 图形整体缩放（自适应图标前景要用 0.62 左右，缩进安全区）
    """
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    cx = cy = size / 2
    # 以「108dp 画布」为设计坐标系，再整体按 size/108 * scale 映射
    unit = size / 108.0 * scale

    def P(x, y):
        return (cx + (x - 54) * unit, cy + (y - 54) * unit)

    card_w, card_h = 40, 50
    radius = 7

    # 后两张先画（被压住），略微旋转效果用偏移模拟
    cards = [
        # (中心x, 中心y, 旋转偏移量x, 透明度)
        (36, 62, -1, 150),
        (70, 60, 1, 150),
        (54, 50, 0, 255),
    ]
    for (ccx, ccy, dx, a) in cards:
        x0, y0 = P(ccx - card_w / 2 + dx, ccy - card_h / 2)
        x1, y1 = P(ccx + card_w / 2 + dx, ccy + card_h / 2)
        w = x1 - x0
        d.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=max(1, int(radius * unit)),
            fill=(ACCENT[0], ACCENT[1], ACCENT[2], int(a * opacity / 255)),
        )

    # 最上面那张：挖出「照片内容」的深色块，看起来像一张真的相片
    x0, y0 = P(54 - card_w / 2, 50 - card_h / 2)
    x1, y1 = P(54 + card_w / 2, 50 + card_h / 2)
    inset = 5 * unit
    # 相片内容区（上方大块）
    content_t = y0 + inset
    content_b = y0 + (y1 - y0) * 0.62
    d.rounded_rectangle(
        [x0 + inset, content_t, x1 - inset, content_b],
        radius=max(1, int(3.5 * unit)),
        fill=(BG_BOTTOM[0], BG_BOTTOM[1], BG_BOTTOM[2], 255),
    )
    # 内容区里加个小太阳 + 地平线，明确是「照片」
    sun_r = 4.2 * unit
    scx = (x0 + x1) / 2 - 5 * unit
    scy = content_t + 8 * unit
    d.ellipse([scx - sun_r, scy - sun_r, scx + sun_r, scy + sun_r],
              fill=(ACCENT_SOFT[0], ACCENT_SOFT[1], ACCENT_SOFT[2], 255))
    # 山形：两个三角形构成
    base_y = content_b - 2 * unit
    mid_x = (x0 + x1) / 2
    d.polygon([
        (x0 + inset + 2 * unit, base_y),
        (mid_x - 3 * unit, base_y - 9 * unit),
        (mid_x + 4 * unit, base_y),
    ], fill=(ACCENT_SOFT[0], ACCENT_SOFT[1], ACCENT_SOFT[2], 210))
    d.polygon([
        (mid_x - 1 * unit, base_y),
        (mid_x + 7 * unit, base_y - 6 * unit),
        (x1 - inset - 2 * unit, base_y),
    ], fill=(ACCENT_SOFT[0], ACCENT_SOFT[1], ACCENT_SOFT[2], 150))

    # 底部两条「标题栏」短线
    ly = content_b + 6.5 * unit
    d.rounded_rectangle(
        [x0 + inset, ly, x0 + inset + 16 * unit, ly + 2.6 * unit],
        radius=max(1, int(1.3 * unit)),
        fill=(BG_BOTTOM[0], BG_BOTTOM[1], BG_BOTTOM[2], 190),
    )
    d.rounded_rectangle(
        [x0 + inset + 19 * unit, ly, x0 + inset + 27 * unit, ly + 2.6 * unit],
        radius=max(1, int(1.3 * unit)),
        fill=(BG_BOTTOM[0], BG_BOTTOM[1], BG_BOTTOM[2], 120),
    )
    return layer


def make_legacy(size):
    """传统方图（API<26 与部分启动器仍读这个）。"""
    bg = vertical_gradient(size, BG_TOP, BG_BOTTOM)
    glow = radial_glow(size, (150, 110, 255), (size * 0.5, size * 0.28),
                       size * 0.55, alpha=90)
    base = Image.alpha_composite(bg.convert("RGBA"), glow)
    fg = draw_photo_cards(size, scale=0.92)
    out = Image.alpha_composite(base, fg)
    return out.convert("RGBA")


def make_round(size):
    """
    圆形图标。直接把方图套圆形遮罩 —— 图形本身是居中的卡片群，
    套圆后仍然完整落在圆内。
    """
    sq = make_legacy(size)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse(
        [0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(sq, (0, 0), mask)
    return out


def make_adaptive_bg(size):
    """
    自适应背景层。系统会把这一层放大并裁成各种形状，
    所以必须铺满、不能留透明边，渐变也要留够余量。
    """
    bg = vertical_gradient(size, BG_TOP, BG_BOTTOM)
    glow = radial_glow(size, (150, 110, 255), (size * 0.5, size * 0.3),
                       size * 0.62, alpha=100)
    glow2 = radial_glow(size, (90, 160, 255), (size * 0.78, size * 0.8),
                        size * 0.42, alpha=60)
    out = Image.alpha_composite(bg.convert("RGBA"), glow)
    out = Image.alpha_composite(out, glow2)
    return out.convert("RGBA")


def make_adaptive_fg(size):
    """
    自适应前景层。108dp 画布里，104dp 直径的遮罩会切掉四周，
    安全区只有中间 66dp（约 61%）。图形缩到 0.62 保证不被切。
    """
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fg = draw_photo_cards(size, scale=0.62)
    return Image.alpha_composite(layer, fg)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    return path


def main():
    made = []
    for density, size in LEGACY_SIZES.items():
        d = os.path.join(RES, "mipmap-" + density)
        made.append(save(make_legacy(size), os.path.join(d, "ic_launcher.png")))
        made.append(save(make_round(size), os.path.join(d, "ic_launcher_round.png")))

    for density, size in ADAPTIVE_SIZES.items():
        d = os.path.join(RES, "mipmap-" + density)
        made.append(save(make_adaptive_bg(size),
                         os.path.join(d, "ic_launcher_background.png")))
        made.append(save(make_adaptive_fg(size),
                         os.path.join(d, "ic_launcher_foreground.png")))

    # 启动画面用的 1024 大图（可选，Capacitor 的 SplashScreen 插件会优先用 drawable）
    save(make_legacy(1024), os.path.join(ROOT, "assets", "icon-only.png"))
    save(make_legacy(512), os.path.join(ROOT, "assets", "icon-512.png"))

    for p in made:
        print("写好了:", os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
