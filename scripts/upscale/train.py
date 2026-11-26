# /// script
# requires-python = ">=3.12"
# dependencies = ["torch", "numpy"]
# ///
"""Trains the UI-text upscaler the compositor runs past the recording's pixel density (upscale.wgsl).

The pages from make.ts give each density its ground truth one level up: a page at 2x is what its 1x
rendering would show on a denser screen. The low side is the truth averaged down (each pixel the
mean of the s x s it covers, as a screen at that density draws it), then, half the time, put
through what a recording does to it: NV12 in BT.709 video range, HEVC at the recorder's bitrate.

The network sees luma only and adds detail over bilinear: four 3x3 layers and a pixel shuffle,
small enough to run as compute passes on every frame of an export. Color stays bilinear; the
recording's chroma is half resolution anyway.

Run: uv run scripts/upscale/train.py <pages dir> --scale 2   (needs ffmpeg with VideoToolbox)
     uv run scripts/upscale/train.py <pages dir> --scale 4
Each run writes its scale into src/engine/gpu/upscale.json and prints the held-out PSNR.
"""

import argparse
import json
import math
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

CSS = (800, 600)  # make.ts page size
HELD_OUT = 24  # last pages, never trained on
WEIGHTS = Path(__file__).resolve().parents[2] / "src/engine/gpu/upscale.json"


def read_png(path: Path, density: int) -> np.ndarray:
    w, h = CSS[0] * density, CSS[1] * density
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 3)


def hevc(rgb: np.ndarray, cache: Path) -> np.ndarray:
    """rgb as a recording keeps it: NV12, BT.709 video range, HEVC at the recorder's 0.12 bits per pixel at 60 fps,
    the last of 30 frames of it standing still."""
    h, w, _ = rgb.shape
    if not cache.exists():
        enc = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-framerate", "60", "-i", "-", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=nv12",
               "-c:v", "hevc_videotoolbox", "-b:v", str(int(w * h * 60 * 0.12)), "-tag:v", "hvc1", str(cache.with_suffix(".mp4"))]
        subprocess.run(enc, input=rgb.tobytes() * 30, check=True)
        dec = ["ffmpeg", "-v", "error", "-y", "-i", str(cache.with_suffix(".mp4")), "-vf", "select=eq(n\\,29),scale=in_color_matrix=bt709:in_range=tv,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", str(cache)]
        subprocess.run(dec, check=True)
        cache.with_suffix(".mp4").unlink()
    return np.fromfile(cache, np.uint8).reshape(h, w, 3)


def luma(rgb: np.ndarray) -> np.ndarray:
    return (rgb.astype(np.float32) / 255) @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def box(rgb: np.ndarray, s: int) -> np.ndarray:
    h, w, _ = rgb.shape
    return np.round(rgb.reshape(h // s, s, w // s, s, 3).astype(np.float32).mean((1, 3))).astype(np.uint8)


def pairs(root: Path, seeds: list[int], scale: int):
    """(low luma clean, low luma recorded, high luma) per page and density pair."""
    cache = root / "cache"
    cache.mkdir(exist_ok=True)
    for seed in seeds:
        for hi in [2, 4] if scale == 2 else [4]:
            truth = read_png(root / f"{seed}-{hi}x.png", hi)
            low = box(truth, scale)
            rec = hevc(low, cache / f"{seed}-{hi}x-{scale}.rgb")
            yield luma(low), luma(rec), luma(truth)


class Net(nn.Module):
    def __init__(self, scale: int, channels: int, layers: int):
        super().__init__()
        conv = lambda a, b: nn.Conv2d(a, b, 3, padding=1, padding_mode="replicate")
        body = [conv(1, channels), nn.ReLU()]
        for _ in range(layers):
            body += [conv(channels, channels), nn.ReLU()]
        body += [conv(channels, scale * scale)]
        self.body = nn.Sequential(*body)
        self.scale = scale
        nn.init.zeros_(body[-1].weight)
        nn.init.zeros_(body[-1].bias)

    def forward(self, y: torch.Tensor, half=False) -> torch.Tensor:
        x = y
        for m in self.body:
            x = m(x)
            if half and isinstance(m, nn.ReLU):
                x = x.half().float()  # the shader keeps features in rgba16float
        return bilinear(y, self.scale) + F.pixel_shuffle(x, self.scale)


def bilinear(y: torch.Tensor, s: int) -> torch.Tensor:
    return F.interpolate(y, scale_factor=s, mode="bilinear", align_corners=False)


def psnr(a: torch.Tensor, b: torch.Tensor) -> float:
    return float(10 * torch.log10(1 / F.mse_loss(a.clamp(0, 1), b)))


def crops(data, scale: int, size: int, per: int, rng: np.random.Generator):
    """Random size x size low crops with their truth, most of them on detail rather than flat fill."""
    lows, highs = [], []
    for clean, rec, truth in data:
        h, w = clean.shape
        got = 0
        while got < per:
            y, x = rng.integers(0, h - size), rng.integers(0, w - size)
            hi = truth[y * scale:(y + size) * scale, x * scale:(x + size) * scale]
            if hi.std() < 0.03 and rng.random() < 0.9:
                continue
            lo = (rec if rng.random() < 0.5 else clean)[y:y + size, x:x + size]
            lows.append(lo)
            highs.append(hi)
            got += 1
    return torch.from_numpy(np.stack(lows)).half()[:, None], torch.from_numpy(np.stack(highs)).half()[:, None]


def dihedral(t: torch.Tensor, k: int) -> torch.Tensor:
    if k & 4:
        t = t.transpose(-1, -2)
    return torch.rot90(t, k & 3, (-2, -1))


def export(net: Net) -> dict:
    """Layers as the shader reads them: per tap (row-major 3x3), per input group of 4 channels, per output group,
    one column-major mat4x4 (out[o] += M * in[i]), channels padded to a multiple of 4; then the biases."""
    layers = []
    for m in net.body:
        if not isinstance(m, nn.Conv2d):
            continue
        w = m.weight.detach().cpu().numpy()  # out, in, ky, kx
        o, i = w.shape[:2]
        go, gi = math.ceil(o / 4), math.ceil(i / 4)
        pad = np.zeros((go * 4, gi * 4, 3, 3), np.float32)
        pad[:o, :i] = w
        mats = pad.reshape(go, 4, gi, 4, 3, 3).transpose(4, 5, 2, 0, 3, 1)  # ky, kx, in group, out group, column (in), row (out)
        bias = np.zeros(go * 4, np.float32)
        bias[:o] = m.bias.detach().cpu().numpy()
        layers.append({"in": gi, "out": go, "w": [float(f"{v:.5g}") for v in mats.reshape(-1)], "b": [float(f"{v:.5g}") for v in bias]})
    return {"layers": layers}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", type=Path)
    ap.add_argument("--scale", type=int, choices=[2, 4], required=True)
    ap.add_argument("--channels", type=int, default=16)
    ap.add_argument("--layers", type=int, default=2, help="hidden channels x channels layers")
    ap.add_argument("--steps", type=int, default=30000)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--dry", action="store_true", help="evaluate only, do not write upscale.json")
    ap.add_argument("--preview", type=Path, help="write a crop of a held-out page: bilinear, upscaled, truth")
    a = ap.parse_args()
    torch.manual_seed(1)
    rng = np.random.default_rng(1)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    seeds = sorted(int(p.name.split("-")[0]) for p in a.pages.glob("*-4x.png"))
    train_seeds, test_seeds = seeds[:-HELD_OUT], seeds[-HELD_OUT:]
    t0 = time.time()
    bank = a.pages / "cache" / f"crops-x{a.scale}-{len(train_seeds)}.pt"
    if not bank.exists():
        torch.save(crops(pairs(a.pages, train_seeds, a.scale), a.scale, 40, 96, rng), bank)  # crops as the pages load: all of them at 4x fill gigabytes
    lo, hi = torch.load(bank)
    print(f"{len(lo)} crops in {time.time() - t0:.0f} s")
    lo, hi = lo.to(dev), hi.to(dev)

    net = Net(a.scale, a.channels, a.layers).to(dev)
    macs = sum(m.weight.numel() for m in net.body if isinstance(m, nn.Conv2d))
    print(f"{macs} multiply-adds per low-res pixel")
    opt = torch.optim.Adam(net.parameters(), 2e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 2e-3, total_steps=a.steps, pct_start=0.05)
    t0 = time.time()
    for step in range(a.steps):
        idx = torch.randint(0, len(lo), (a.batch,), device=dev)
        k = int(rng.integers(0, 8))
        x, y = dihedral(lo[idx].float(), k), dihedral(hi[idx].float(), k)
        loss = F.l1_loss(net(x), y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 2000 == 0 or step == a.steps - 1:
            print(f"step {step} loss {loss.item():.5f} {time.time() - t0:.0f} s")

    net.eval()
    rows = {"bilinear": [], "bicubic": [], "net": [], "net f16": []}
    with torch.no_grad():
        for i, (clean, rec, truth) in enumerate(pairs(a.pages, test_seeds, a.scale)):
            x = torch.from_numpy(rec)[None, None].to(dev)
            y = torch.from_numpy(truth)[None, None].to(dev)
            rows["bilinear"].append(psnr(bilinear(x, a.scale), y))
            rows["bicubic"].append(psnr(F.interpolate(x, scale_factor=a.scale, mode="bicubic", align_corners=False), y))
            rows["net"].append(psnr(net(x), y))
            rows["net f16"].append(psnr(net(x, half=True), y))
            if a.preview and i == 0:  # a crop of the first held-out page: bilinear, upscaled, truth
                a.preview.mkdir(parents=True, exist_ok=True)
                s = a.scale
                y0, x0, ch, cw = 40 * s, 40 * s, 200 * s, 300 * s
                strip = torch.cat([o[0, 0, y0:y0 + ch, x0:x0 + cw].clamp(0, 1) for o in [bilinear(x, s), net(x), y]], 1)
                img = (strip.cpu().numpy() * 255).round().astype(np.uint8)
                png = a.preview / f"x{s}-c{a.channels}-l{a.layers}.png"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{img.shape[1]}x{img.shape[0]}", "-i", "-", str(png)], input=img.tobytes(), check=True)
    for k, v in rows.items():
        print(f"held-out recorded pages, {k}: {np.mean(v):.2f} dB")

    if not a.dry:
        out = json.loads(WEIGHTS.read_text()) if WEIGHTS.exists() else {}
        out[str(a.scale)] = export(net.cpu())
        WEIGHTS.write_text(json.dumps(out, separators=(",", ":")) + "\n")
        print(f"wrote {WEIGHTS}")


if __name__ == "__main__":
    main()
