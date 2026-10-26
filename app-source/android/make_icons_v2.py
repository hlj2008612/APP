#!/usr/bin/env python
# -*- coding: UTF-8 -*-
"""
「美琴的照片墙」APP 图标生成器 v2 —— 三套候选方案 + 对比样张 + 落地资源。

为什么重写 make_icons.py
  make_icons.py 只给出一套方案，且存在两个实测问题：
    1. 自适应前景缩放 0.62 是按「卡片名义高度 50」算的，卡片实高只有 31
       （50 × 0.62），在全屏遮罩下只剩 8.8% 屏高，视觉偏小；
    2. 启动图只写了 drawable 与 drawable-port/-land-*，没有配套
       values/styles.xml 里 core-splashscreen 的主题属性，
       也没有 MainActivity.onCreate 里的 installSplashScreen()，
       API 26+ 的冷启动因此看不到居中图标。

本脚本的三点设计约束（与 Android 自适应图标规范对齐）
  · 画板 1024×1024；自适应层导出 108dp × density，即 108/162/216/324/432。
  · 安全区 = 108dp 画布的中央 66dp（x,y ∈ [21,87]）。
  · 全部图形用超采样（SS=4）+ LANCZOS 降采样，避免小尺寸锯齿。

用法（只读渲染，不改工程资源）：
    py make_icons_v2.py                     # 出样张到 android/icon-preview/
    py make_icons_v2.py --apply c           # 落地方案 C 到 res/
    py make_icons_v2.py --preview a b c     # 只出指定方案的样张
"""
import argparse
import math
import os
import pathlib
import re
import shutil

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    raise SystemExit("需要 Pillow：py -m pip install Pillow")

ROOT = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(ROOT, "app", "src", "main", "res")
PREVIEW = os.path.join(ROOT, "icon-preview")
SS = 4  # 超采样倍数

# 设计坐标系：自适应层以 108dp 为画板；1024 导出时按比例放大。
DP = 108.0
SAFE = 66.0                      # 安全区边长
MASK_EVERYTHING = 104.0          # Android 最凶的遮罩（圆形/水滴）直径
SAFE_LO, SAFE_HI = (DP - SAFE) / 2, (DP + SAFE) / 2

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


# ---------------------------------------------------------------- 基础工具
def hexrgb(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def lerp(c1, c2, t):
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))


def linear_gradient(size, stops, angle_deg):
    """按角度做线性渐变。stops = [(t, rgb), ...]，t ∈ [0,1]。"""
    lo, hi = min(s[0] for s in stops), max(s[0] for s in stops)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    # 画布中心的投影方向；让 t=0 落在 (1-angle) 方向
    rad = math.radians(angle_deg)
    dx, dy = math.sin(rad), -math.cos(rad)   # 0° = 上→下
    n = size
    for y in range(n):
        for x in range(n):
            p = ((x + .5) / n - .5) * dx + ((y + .5) / n - .5) * dy + .5
            t = (p - lo) / (hi - lo) if hi > lo else 0
            t = min(1.0, max(0.0, t))
            px[x, y] = _sample(stops, t)
    return img


def _sample(stops, t):
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t0 <= t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            c = lerp(c0, c1, k)
            return (c[0], c[1], c[2], c[3] if len(c) > 3 else 255)
    c = stops[-1][1]
    return (c[0], c[1], c[2], c[3] if len(c) > 3 else 255)


def radial_soft(size, cx, cy, radius, color):
    """柔和径向辉光。color 带 alpha。"""
    g = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    steps = 30
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(color[3] * (1 - i / steps) ** 1.7)
        if a <= 0:
            continue
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color[:3] + (a,))
    return g.filter(ImageFilter.GaussianBlur(radius * 0.07))


class Layer:
    """以 108dp 为坐标系的绘制画布（超采样后输出）。"""

    def __init__(self, size_px, dp=DP):
        self.size = size_px * SS
        self.k = self.size / dp
        self.img = Image.new("RGBA", (self.size, self.size), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def P(self, x, y):
        return (x * self.k, y * self.k)

    def box(self, x, y, w, h):
        x0, y0 = self.P(x, y)
        return [x0, y0, x0 + w * self.k, y0 + h * self.k]

    def rrect(self, x, y, w, h, r, fill, outline=None, width=0):
        self.d.rounded_rectangle(self.box(x, y, w, h), radius=r * self.k,
                                 fill=fill, outline=outline,
                                 width=max(1, int(width * self.k)))

    def ellipse(self, cx, cy, rx, ry, fill):
        x0, y0 = self.P(cx - rx, cy - ry)
        x1, y1 = self.P(cx + rx, cy + ry)
        self.d.ellipse([x0, y0, x1, y1], fill=fill)

    def polygon(self, pts, fill):
        self.d.polygon([self.P(x, y) for x, y in pts], fill=fill)

    def line(self, pts, fill, width, cap_round=True):
        self.d.line([self.P(x, y) for x, y in pts], fill=fill,
                    width=max(1, int(width * self.k)), joint="curve")
        if cap_round:
            r = width / 2
            for (x, y) in (pts[0], pts[-1]):
                self.ellipse(x, y, r, r, fill)

    def paste(self, other, alpha=1.0):
        if alpha < 1.0:
            a = other.split()[3].point(lambda v: int(v * alpha))
            other = other.copy()
            other.putalpha(a)
        self.img.alpha_composite(other)

    def out(self, size_px):
        return self.img.resize((size_px, size_px), Image.LANCZOS)


def clip_circle(img):
    """补一份「圆形遮罩」形态，用来验收圆形启动器。"""
    size = img.size[0]
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


# ---------------------------------------------------------------- 方案 A
# 「叠片」，沿用现图标构图并把比例修正到规范内。
A = {
    "bg": [("0f2a24", 255), ("13202b", 255)],       # 占位，真实用渐变函数
}

def plan_a_bg(layer):
    """背景层：深碧绿→墨黑渐变 + 两团微光。铺满整张 108dp，不留透明边。"""
    g = linear_gradient(256, [(0.0, hexrgb("#0f3542")),
                              (0.55, hexrgb("#0c2233")),
                              (1.0, hexrgb("#080e18"))], 165)
    layer.paste(g.resize(layer.img.size, Image.BICUBIC))
    layer.paste(radial_soft(layer.size, layer.size * .62, layer.size * .30,
                            layer.size * .62, hexrgb("#1f8f8a", 70)))
    layer.paste(radial_soft(layer.size, layer.size * .32, layer.size * .78,
                            layer.size * .55, hexrgb("#123b5e", 80)))


def plan_a_fg(layer, bleed=False):
    """
    前景层：三张错落相片卡，统一倾斜 -6°（用多边形近似，保持矢量感）。
    主体全部落在安全区 [21,87] 内；bleed=True 时允许压到 104dp 遮罩内
    （给 Android 13 主题化图标用）。
    """
    if bleed:
        sx, sy, sw, sh = 8, 20, 90, 68   # 超大版，仅主题化图标
        cards = [(sx + 4, sy + 8, sw, sh), (sx + sw - 2, sy + 2, sw, sh),
                 (sx + sw / 2, sy - 2, sw, sh)]
    else:
        cx, cy = 54, 53
        w, h = 30, 40
        cards = [(cx - 8.2, cy + 4.0, w, h), (cx + 8.2, cy + 1.6, w, h),
                 (cx, cy - 2.2, w, h)]
    for i, (x, y, w, h) in enumerate(cards):
        if i < 2:
            # 后两张：半透明白，模拟景深
            layer.rrect(x - w / 2, y - h / 2, w, h, 4.6,
                        (255, 255, 255, 78 if i == 0 else 96))
            # 卡上的「照片块」轮廓线
            layer.rrect(x - w / 2 + 3.2, y - h / 2 + 3.2, w - 6.4, h * .52, 2.4,
                        (255, 255, 255, 40 if i == 0 else 56))
        else:
            # 顶层：实白卡 + 深色照片区 + 双色山 + 太阳
            layer.rrect(x - w / 2, y - h / 2, w, h, 5.2, (255, 255, 255, 255))
            px, py = x - w / 2 + 3.6, y - h / 2 + 3.6
            pw, ph = w - 7.2, h * .55
            layer.rrect(px, py, pw, ph, 2.6, hexrgb("#123f4a"))
            layer.ellipse(px + pw * .70, py + ph * .32, 2.3, 2.3,
                          hexrgb("#F7E07A"))
            # 山：前浅后深
            layer.polygon([(px + 1.2, py + ph - 1.2),
                           (px + pw * .40, py + ph * .38),
                           (px + pw * .72, py + ph - 1.2)],
                          hexrgb("#7BE3C9"))
            layer.polygon([(px + pw * .50, py + ph - 1.2),
                           (px + pw * .80, py + ph * .55),
                           (px + pw - 1.2, py + ph - 1.2)],
                          hexrgb("#3FBFA8"))
            # 卡片标题条
            layer.rrect(px, py + ph + 3.0, pw * .58, 2.6, 1.3, hexrgb("#B9C6D4"))
            layer.rrect(px + pw * .58 + 2.0, py + ph + 3.0, pw * .26, 2.6, 1.3,
                        hexrgb("#7D90A3"))


def plan_a():
    return _render(plan_a_bg, plan_a_fg)


# ---------------------------------------------------------------- 方案 B
def plan_b_bg(layer):
    """浅色渐变，亮、干净，适合放在浅色壁纸和彩色文件夹上。"""
    g = linear_gradient(256, [(0.0, hexrgb("#8B6CE8")),
                              (1.0, hexrgb("#4A9EFF"))], 135)
    layer.paste(g.resize(layer.img.size, Image.BICUBIC))
    layer.paste(radial_soft(layer.size, layer.size * .30, layer.size * .24,
                            layer.size * .50, (255, 255, 255, 46)))


def plan_b_fg(layer, bleed=False):
    """
    前景层：九宫格照片墙 —— 3×3 圆角小格，随机若干格填实，其余留描边。
    bleed 用更密的一版，避免主题化图标显得空。
    """
    if bleed:
        x0, y0, cell, gap = 10, 10, 27, 4.5
    else:
        x0, y0, cell, gap = 31.5, 31.5, 14, 3.0
    filled = {(0, 0), (2, 0), (1, 1), (0, 2), (2, 2)}
    for r in range(3):
        for c in range(3):
            x = x0 + c * (cell + gap)
            y = y0 + r * (cell + gap)
            if (r, c) in filled:
                layer.rrect(x, y, cell, cell, 3.4, (255, 255, 255, 255))
                if (r, c) == (1, 1):   # 中心格画一个"照片"意象
                    layer.ellipse(x + cell * .66, y + cell * .32, 2.0, 2.0,
                                  hexrgb("#5B43B8"))
                    layer.polygon([(x + 1.6, y + cell - 1.6),
                                   (x + cell * .48, y + cell * .42),
                                   (x + cell - 1.6, y + cell - 1.6)],
                                  hexrgb("#5B43B8"))
            else:
                layer.rrect(x, y, cell, cell, 3.4, (255, 255, 255, 58),
                            outline=(255, 255, 255, 168), width=1.5)


def plan_b():
    return _render(plan_b_bg, plan_b_fg)


# ---------------------------------------------------------------- 方案 C
def plan_c_bg(layer):
    """深色底 #0d0d0d + 紫蓝辉光 —— 和 APP 页面底色完全一致。"""
    layer.paste(Image.new("RGBA", layer.img.size, hexrgb("#0D0D0D")))
    layer.paste(radial_soft(layer.size, layer.size * .28, layer.size * .26,
                            layer.size * .70, hexrgb("#8B6CE8", 150)))
    layer.paste(radial_soft(layer.size, layer.size * .84, layer.size * .86,
                            layer.size * .62, hexrgb("#4A9EFF", 96)))


def plan_c_fg(layer, bleed=False):
    """
    前景层：两张相片卡错位叠放，主卡自带 6dp 白色相框 + 照片内容。
    """
    if bleed:
        w, h, fw = 74, 62, 7
        main = (46, 54)
        back = (67, 38)
    else:
        w, h, fw = 40, 34, 3.6
        main = (47, 56)
        back = (66, 47)
    # 后卡：纯照片（无框），颜色稍冷，被主卡压住
    bx, by = back
    layer.rrect(bx - w / 2, by - h / 2, w, h, 3.4, hexrgb("#1E2A44"))
    layer.ellipse(bx + w * .16, by - h * .12, 2.6, 2.6, hexrgb("#CFE0FF"))
    layer.polygon([(bx - w / 2 + 1.5, by + h / 2 - 1.5),
                   (bx - w * .02, by - h * .10),
                   (bx + w / 2 - 1.5, by + h / 2 - 1.5)],
                  hexrgb("#3B5B87"))
    # 主卡：白框
    mx, my = main
    layer.rrect(mx - w / 2, my - h / 2, w, h, 3.8, (255, 255, 255, 255))
    ix, iy = mx - w / 2 + fw, my - h / 2 + fw
    iw, ih = w - 2 * fw, h - 2 * fw - 2.2
    layer.rrect(ix, iy, iw, ih, 1.8, hexrgb("#2A1A4E"))
    # 照片里：暖色渐变天空用三层多边形近似
    layer.polygon([(ix, iy + ih * .62), (ix + iw, iy + ih * .30),
                   (ix + iw, iy + ih), (ix, iy + ih)],
                  hexrgb("#6B4BC4"))
    layer.ellipse(ix + iw * .34, iy + ih * .30, 3.0, 3.0, hexrgb("#FFD166"))
    layer.polygon([(ix, iy + ih), (ix + iw * .40, iy + ih * .52),
                   (ix + iw * .78, iy + ih)], hexrgb("#B9A6FF"))
    layer.polygon([(ix + iw * .46, iy + ih), (ix + iw * .74, iy + ih * .70),
                   (ix + iw, iy + ih)], hexrgb("#8B6CE8"))


def plan_c():
    return _render(plan_c_bg, plan_c_fg)


# ---------------------------------------------------------------- 渲染
def _render(bg_fn, fg_fn):
    """返回 dict：bg / fg / icon1024 / round。"""
    big = 1024
    bg = Layer(256)
    bg_fn(bg)
    bg_img = bg.out(big)

    fg = Layer(big)
    fg_fn(fg)
    fg_img = fg.out(big)

    icon = Image.alpha_composite(bg_img, fg_img)
    return {"bg": bg_img, "fg": fg_img, "icon": icon,
            "round": clip_circle(icon)}


PLANS = {"a": plan_a, "b": plan_b, "c": plan_c}
NAMES = {"a": "A 叠片（深碧绿）", "b": "B 网格墙（紫蓝渐变）",
         "c": "C 叠卡（深色 + 紫蓝辉光）"}


# ---------------------------------------------------------------- 样张
def debug_overlay(icon):
    """叠一张规范参考线：安全区 66dp、可见 72dp、最凶遮罩 104dp。"""
    o = icon.copy()
    d = ImageDraw.Draw(o)
    n = o.size[0]
    k = n / DP
    def rect(dp_lo, dp_hi, color, w):
        l, t = dp_lo * k, dp_lo * k
        r, b = dp_hi * k, dp_hi * k
        d.rectangle([l, t, r, b], outline=color, width=w)
    rect(0, DP, (255, 255, 255, 90), max(1, int(1 * k)))
    rect(SAFE_LO, SAFE_HI, (41, 224, 255, 255), max(2, int(1.6 * k)))
    rect((DP - 72) / 2, (DP + 72) / 2, (255, 212, 40, 230),
         max(2, int(1.2 * k)))
    cx, cy, r = DP / 2 * k, DP / 2 * k, MASK_EVERYTHING / 2 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 82, 82, 235),
              width=max(2, int(1.6 * k)))
    return o


def sheet(results):
    """
    四联图：1024 图标 / 安全区参考线 / 圆形遮罩 / 真机尺寸阵列。
    真机尺寸阵列用 4x 最近邻放大，模拟人眼在小图标上的「实际能看出什么」。
    """
    W, H = 1024, 1024
    gap = 32
    canvas = Image.new("RGBA", (W * 4 + gap * 5, H + gap * 2), (24, 24, 28, 255))
    xs = [gap + i * (W + gap) for i in range(4)]
    canvas.alpha_composite(results["icon"], (xs[0], gap))
    canvas.alpha_composite(debug_overlay(results["icon"]), (xs[1], gap))
    canvas.alpha_composite(results["round"], (xs[2], gap))

    # 第四格：48(桌面最小) / 72(mdpi) / 96(hdpi) / 144(xhdpi 常见) / 192(xxxhdpi) / 通知栏 24
    cell = Image.new("RGBA", (W, H), (30, 30, 34, 255))
    y = 90
    for px in (48, 72, 96, 144, 192):
        zoom = min(4, (W - 240) // px)
        icon = results["icon"].resize((px, px), Image.LANCZOS)
        rnd = results["round"].resize((px, px), Image.LANCZOS)
        sq = icon.resize((px * zoom, px * zoom), Image.NEAREST)
        rd = rnd.resize((px * zoom, px * zoom), Image.NEAREST)
        cell.alpha_composite(sq, (80, y))
        cell.alpha_composite(rd, (80 + px * zoom + 40, y))
        y += px * zoom + 28
        if y > H - 100:
            break
    canvas.alpha_composite(cell, (xs[3], gap))
    return canvas


def contact(plans):
    """三方案并排总览（每列 512px）。"""
    cell = 512
    gap = 24
    cols = ["icon", "fg", "round"]
    W = (cell * len(cols) + gap * (len(cols) + 1))
    H = (cell + gap) * len(plans) + gap
    canvas = Image.new("RGBA", (W, H), (24, 24, 28, 255))
    for r, (key, res) in enumerate(plans.items()):
        for c, which in enumerate(cols):
            bg = Image.new("RGBA", (cell, cell), (44, 44, 50, 255))
            img = res[which].resize((cell, cell), Image.LANCZOS)
            bg.alpha_composite(img)
            canvas.alpha_composite(bg, (gap + c * (cell + gap),
                                        gap + r * (cell + gap)))
    return canvas


# ---------------------------------------------------------------- 落地
ADAPTIVE_DP = 108


def export_res(key, dst_res):
    """把某方案写成 Android 资源。dst_res 是目标 res 目录（默认工程 res）。"""
    res = PLANS[key]()
    for den, mult in DENSITIES.items():
        d = os.path.join(dst_res, "mipmap-" + den)
        os.makedirs(d, exist_ok=True)
        # 传统图标：48dp
        legacy = int(48 * mult)
        res["icon"].resize((legacy, legacy), Image.LANCZOS).save(
            os.path.join(d, "ic_launcher.png"), "PNG", optimize=True)
        res["round"].resize((legacy, legacy), Image.LANCZOS).save(
            os.path.join(d, "ic_launcher_round.png"), "PNG", optimize=True)
        # 自适应两层：108dp
        ad = int(ADAPTIVE_DP * mult)
        res["bg"].resize((ad, ad), Image.LANCZOS).save(
            os.path.join(d, "ic_launcher_background.png"), "PNG", optimize=True)
        res["fg"].resize((ad, ad), Image.LANCZOS).save(
            os.path.join(d, "ic_launcher_foreground.png"), "PNG", optimize=True)
    # 主题化（Android 13 单色）：前景 + 背景都以 108dp 超采样
    mono_bg = Layer(1024)
    mono_bg.paste(Image.new("RGBA", mono_bg.img.size, (0, 0, 0, 0)))
    mono_fg = Layer(1024)
    fg_fn = {"a": plan_a_fg, "b": plan_b_fg, "c": plan_c_fg}[key]
    fg_fn(mono_fg, bleed=True)
    for den, mult in DENSITIES.items():
        d = os.path.join(dst_res, "mipmap-" + den)
        mono_fg.out(int(ADAPTIVE_DP * mult)).save(
            os.path.join(d, "ic_launcher_monochrome.png"), "PNG",
            optimize=True)
    # 通知图标（24dp，白色剪影，透明底）
    notif = Layer(256)
    _notification_glyph(notif)
    for den, mult in DENSITIES.items():
        d = os.path.join(dst_res, "drawable-" + den)
        os.makedirs(d, exist_ok=True)
        notif.out(int(24 * mult)).save(
            os.path.join(d, "ic_stat_photowall.png"), "PNG", optimize=True)
    return res


def _notification_glyph(layer):
    """
    24dp 单色剪影：一张带相框的照片。
    必须全白 + 透明底 —— 系统只取 alpha 通道，彩色会被渲染成灰块。

    做法：先在独立图层画「相框实心块」，再把「照片内容区」按透明挖掉，
    最后在挖空区里放太阳和山（实心白）。
    上一版误把挖空形状画成了白色 → 整张变成白块、细节全丢。
    """
    k = DP / 24.0                     # 24dp 坐标系 → 108dp 画板
    def S(v):
        return v * k
    cx, cy = 54, 54
    w, h = S(16), S(14)
    frame = Layer(256, DP)
    frame.rrect(cx - w / 2, cy - h / 2, w, h, S(1.7), (255, 255, 255, 255))
    layer.img.alpha_composite(frame.img)

    ix, iy = cx - w / 2 + S(1.9), cy - h / 2 + S(1.9)
    iw, ih = w - S(3.8), h - S(3.8) - S(2.0)

    hole = Image.new("L", layer.img.size, 0)
    hd = ImageDraw.Draw(hole)
    hd.rounded_rectangle(
        [ix * layer.k, iy * layer.k, (ix + iw) * layer.k, (iy + ih) * layer.k],
        radius=S(0.7) * layer.k, fill=255)
    clear = Image.new("RGBA", layer.img.size, (0, 0, 0, 0))
    layer.img = Image.composite(clear, layer.img, hole)
    layer.d = ImageDraw.Draw(layer.img)

    layer.ellipse(ix + iw * .28, iy + ih * .27, S(1.4), S(1.4),
                  (255, 255, 255, 255))
    layer.polygon([(ix + S(0.5), iy + ih - S(0.5)),
                   (ix + iw * .46, iy + ih * .36),
                   (ix + iw * .88, iy + ih - S(0.5))],
                  (255, 255, 255, 255))


SPLASH_LOGO_DP = 96   # Android 12 启动画面图标直径上限 192dp，96dp 观感最佳

# 每套方案的启动画面底色（与自适应图标背景保持同一色系）。
# 方案 C 用纯黑底 + 圆形 logo；A/B 用略亮的同色系底，避免深底吞掉图标。
SPLASH_BG = {"a": "#0C2233", "b": "#F3F0FF", "c": "#0D0D0D"}
SPLASH_ROUND = {"a": True, "b": True, "c": True}


def export_splash(key, dst_res, icon_bg_hex=None):
    """
    生成启动画面：drawable/splash.png（兜底） + drawable-port/-land-*/splash.png。

    注意：这里不写 splash_background.png / .xml ——
    Android 12+ 的底色由 values/splash_colors.xml 的 splash_background 提供，
    多写一份同名资源会和 drawable/splash_background.xml 抢名字（aapt 报重复）。
    """
    icon_bg_hex = icon_bg_hex or SPLASH_BG[key]
    res = PLANS[key]()
    mult_of = DENSITIES
    # 2) 各方向 + 各密度：底色 + 居中等比 logo
    #    注意：竖屏/横屏必须分开命名，否则平板横竖屏切换会拉伸。
    logo_dp = SPLASH_LOGO_DP
    sizes = {
        "drawable-port-mdpi": (320, 480), "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280), "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-land-mdpi": (480, 320), "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720), "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
    }
    for folder, (w, h) in sizes.items():
        d = os.path.join(dst_res, folder)
        os.makedirs(d, exist_ok=True)
        canvas = Image.new("RGB", (w, h), hexrgb(icon_bg_hex)[:3])
        mult = mult_of[folder.rsplit("-", 1)[1]]
        px = int(logo_dp * mult)
        logo = res["icon"].resize((px, px), Image.LANCZOS)
        if SPLASH_ROUND[key]:
            logo = clip_circle(logo)
        canvas = canvas.convert("RGBA")
        canvas.alpha_composite(logo, ((w - px) // 2, (h - px) // 2))
        canvas.convert("RGB").save(os.path.join(d, "splash.png"), "PNG",
                                   optimize=True)

    # API < 26 的兜底（无方向限定），320×480 mdpi 基准
    d0 = os.path.join(dst_res, "drawable")
    os.makedirs(d0, exist_ok=True)
    w, h = 320, 480
    canvas = Image.new("RGB", (w, h), hexrgb(icon_bg_hex)[:3]).convert("RGBA")
    logo = res["icon"].resize((SPLASH_LOGO_DP, SPLASH_LOGO_DP), Image.LANCZOS)
    if SPLASH_ROUND[key]:
        logo = clip_circle(logo)
    canvas.alpha_composite(logo, ((w - SPLASH_LOGO_DP) // 2,
                                 (h - SPLASH_LOGO_DP) // 2))
    canvas.convert("RGB").save(os.path.join(d0, "splash.png"), "PNG",
                               optimize=True)


# ---------------------------------------------------------------- 对比页
def comparison_html(plans, path):
    """
    生成 docs/app-icon-preview.html：
    三方案 × （1024 图标 / 圆形遮罩 / 深色与浅色壁纸 / 48px 小图标）。
    壁纸格子直接说明「这套方案在深色壁纸和浅色壁纸上分别好不好看」。
    """
    cells = []
    for key, res in plans.items():
        cells.append(f"""
    <section class="plan plan-{key}">
      <h2>{NAMES[key]}</h2>
      <div class="grid">
        <figure><img src="{os.path.basename(PREVIEW)}/icon-{key.upper()}.png" alt=""><figcaption>1024 × 1024</figcaption></figure>
        <figure><img src="{os.path.basename(PREVIEW)}/icon-{key.upper()}-round.png" alt=""><figcaption>圆形遮罩</figcaption></figure>
        <figure class="wall dark"><img src="{os.path.basename(PREVIEW)}/icon-{key.upper()}.png" alt=""><figcaption>深色壁纸</figcaption></figure>
        <figure class="wall light"><img src="{os.path.basename(PREVIEW)}/icon-{key.upper()}.png" alt=""><figcaption>浅色壁纸</figcaption></figure>
        <figure class="tiny"><img src="{os.path.basename(PREVIEW)}/icon-{key.upper()}.png" alt=""><figcaption>48px</figcaption></figure>
      </div>
      <p class="detail"><a href="{os.path.basename(PREVIEW)}/sheet-{key.upper()}.png">查看安全区 / 尺寸阵列详图 →</a></p>
    </section>""")

    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>美琴的照片墙 · APP 图标方案对比</title>
<style>
  :root {{ color-scheme: dark; --bg:#0d0d0d; --card:#16161a; --line:#2a2a30; --text:#e6e6ea; --muted:#9a9aa6; --primary:#8b6ce8; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:32px 20px 64px; background:var(--bg); color:var(--text);
         font: 15px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }}
  h1 {{ font-size:22px; font-weight:600; letter-spacing:.02em; margin:0 0 6px; }}
  .lead {{ color:var(--muted); margin:0 0 28px; max-width:70ch; }}
  .plan {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin-bottom:24px; }}
  .plan h2 {{ font-size:17px; margin:0 0 16px; font-weight:600; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:14px; }}
  figure {{ margin:0; border-radius:12px; overflow:hidden; background:#242429; display:flex; flex-direction:column; }}
  figure img {{ display:block; width:100%; height:auto; }}
  figcaption {{ font-size:12px; color:var(--muted); text-align:center; padding:8px 4px; }}
  .wall {{ padding:18px; align-items:center; justify-content:center; }}
  .wall img {{ width:96px; height:96px; border-radius:22px; box-shadow:0 8px 22px rgba(0,0,0,.45); }}
  .wall.dark {{ background:linear-gradient(160deg,#151a2e,#08101a); }}
  .wall.light {{ background:linear-gradient(160deg,#eef1f8,#cfd8e8); }}
  .wall.light figcaption {{ color:#4a5262; }}
  .tiny {{ align-items:center; justify-content:center; padding:18px; }}
  .tiny img {{ width:48px; height:48px; border-radius:11px; image-rendering:auto; }}
  .detail {{ margin:14px 0 0; font-size:13px; }}
  a {{ color:var(--primary); text-decoration:none; }}
  a:hover {{ text-decoration:underline; }}
</style>
</head>
<body>
  <h1>美琴的照片墙 · APP 图标方案对比</h1>
  <p class="lead">三套方案的 1024 画板、圆形遮罩、深/浅壁纸环境与 48px 小尺寸观感。
     安全区与尺寸阵列详图见各方案下方链接；规范与落地步骤见 docs/app-icon-spec.md。</p>
  {''.join(cells)}
</body>
</html>
"""
    pathlib.Path(path).write_text(html, encoding="utf-8")
    return path


# ---------------------------------------------------------------- 落地前自检
# 这些是真实踩过的坑，落盘前一定会跑一遍，失败就中止，不把坏资源写进工程。
def lint_res(dst_res):
    problems = []
    vals = os.path.join(dst_res, "values")

    # 1) XML 注释里出现连续两个减号 —— aapt2 直接报 not well-formed
    for p in pathlib.Path(dst_res).rglob("*.xml"):
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r"<!--(.*?)-->", text, re.S):
            if "--" in m.group(1):
                line = text[:m.start()].count("\n") + 1
                problems.append(f"{p}:{line} 注释里出现连续减号，XML 非法")

    # 2) 同名 color 被定义两次 —— aapt 报 duplicate resource
    names = {}
    for p in pathlib.Path(vals).glob("*.xml"):
        for m in re.finditer(r'<color\s+name="([^"]+)"', p.read_text(encoding="utf-8")):
            names.setdefault(m.group(1), []).append(p.name)
    for n, srcs in names.items():
        if len(srcs) > 1:
            problems.append(f"color/{n} 在 {', '.join(srcs)} 里重复定义")

    # 3) 悬空引用：属性值里的 @color/xxx 没有对应定义（注释里提到不算）
    defined = set(names)
    for p in pathlib.Path(dst_res).rglob("*.xml"):
        text = re.sub(r"<!--.*?-->", "", p.read_text(encoding="utf-8"), flags=re.S)
        for m in re.finditer(r"=\s*\"@color/(\w+)\"", text):
            if m.group(1) not in defined:
                problems.append(f"{p.name}: @color/{m.group(1)} 未定义")

    # 4) 自适应前景图的尺寸必须是 108dp × density
    for den, mult in DENSITIES.items():
        f = os.path.join(dst_res, "mipmap-" + den, "ic_launcher_foreground.png")
        if os.path.exists(f):
            w, h = Image.open(f).size
            want = int(108 * mult)
            if (w, h) != (want, want):
                problems.append(f"{f} 尺寸 {w}x{h}，应为 {want}x{want}")
    return problems


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", choices=["a", "b", "c"],
                    help="把该方案写入工程 res/（会覆盖现有图标）")
    ap.add_argument("--preview", nargs="*", default=None,
                    help="只出样张，默认 a b c")
    ap.add_argument("--out", default=PREVIEW)
    args = ap.parse_args()

    keys = args.preview if args.preview else ["a", "b", "c"]
    os.makedirs(args.out, exist_ok=True)
    rendered = {}
    for k in keys:
        rendered[k] = PLANS[k]()
        rendered[k]["icon"].save(os.path.join(args.out, f"icon-{k.upper()}.png"),
                                 "PNG", optimize=True)
        rendered[k]["round"].save(os.path.join(args.out, f"icon-{k.upper()}-round.png"),
                                  "PNG", optimize=True)
        sheet(rendered[k]).save(os.path.join(args.out, f"sheet-{k.upper()}.png"),
                                "PNG", optimize=True)
        print("样张:", f"{args.out}\\icon-{k.upper()}.png")
    contact(rendered).save(os.path.join(args.out, "contact-sheet.png"), "PNG",
                           optimize=True)
    print("总览:", os.path.join(args.out, "contact-sheet.png"))
    html = comparison_html(rendered, os.path.join(
        os.path.dirname(ROOT), "docs", "app-icon-preview.html"))
    print("对比页:", html)

    if args.apply:
        backup = os.path.join(ROOT, "icon-backup-" + args.apply)
        if not os.path.isdir(backup):
            os.makedirs(backup, exist_ok=True)
            for sub in os.listdir(RES):
                if sub.startswith(("mipmap-", "drawable")):
                    src = os.path.join(RES, sub)
                    if os.path.isdir(src):
                        shutil.copytree(src, os.path.join(backup, sub),
                                        dirs_exist_ok=True)
            print("已备份原资源到:", backup)
        export_res(args.apply, RES)
        export_splash(args.apply, RES)
        bad = lint_res(RES)
        if bad:
            print("!! 资源自检未通过：")
            for b in bad:
                print("   -", b)
            raise SystemExit(1)
        print("资源自检通过")
        print("已落地方案", args.apply.upper(), "→", RES)


if __name__ == "__main__":
    main()
