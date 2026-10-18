// Grip compositor. One module, one entry point per pass; renderer.ts drives them.
// Colors are sRGB-encoded. Blended passes output premultiplied alpha. Coordinates are output px,
// origin top-left; "u" is unzoomed px (scene space), mapped to output by the zoom view.
// The frame target's alpha is not coverage: it is the dither mark (1 = smooth synthetic content
// such as gradients and shadows that needs dithering, 0 = video that must stay untouched).

struct Frame {
  a: vec4f,        // output w, h, unit (px per style unit), view samples
  viewT: vec4f,    // view at t: center x, y, scale; viewport corner radius
  scr: vec4f,      // rect of the whole recording (unzoomed px)
  scr2: vec4f,     // screen radius, has screen, mask count, shadow strength
  scr3: vec4f,     // screen source w, h (px), pixelate block (source px), blur mip level
  dev: vec4f,      // device parts, first part drawn over the screen, shadow casters, inset (px)
  sh: array<vec4f, 4>,      // shadow casters: rect, (radius)
  views: array<vec4f, 16>,  // shutter samples of the view: center x, y, scale
  parts: array<vec4f, 48>,  // device parts: rect, radii (tl tr br bl), top rgba, bottom rgba
  masks: array<vec4f, 32>,  // rect (screen source px), (kind 0 blur 1 pixelate 2 highlight, opacity, radius)
  cur: vec4f,      // cursor samples, opacity, samples per pixel, has cursor
  curImg: vec4f,   // image w, h, hotspot x, y (image px)
  curTex: vec4f,   // texture px per image px, clipped to the screen frame (a cropped recording)
  curBox: vec4f,   // swept bounds x0, y0, x1, y1 (output px)
  curS: array<vec4f, 16>,   // shutter samples of the cursor: x, y (unzoomed), unzoomed px per image px, angle
  cam: vec4f,      // rect (output px)
  cam1: vec4f,     // radius, shadow, opacity, mirror
  cam2: vec4f,     // crop (normalized)
  cam3: vec4f,     // remove background, has lut, lut size
  cam4: vec4f,     // camera source w, h
  lutMin: vec4f,
  lutMax: vec4f,
  fin: vec4f,      // has overlay, click effect (0 none, 1 swell, 2 wave, 3 circle, 4 focus ring)
  vp: vec4f,       // viewport (output px): the zoom view shows through it, everything outside is unzoomed
  vis: vec4f,      // shown part of the recording (unzoomed px): all of scr, or its crop; the frame is this grown by dev.w
  clicks: array<vec4f, 4>, // click effects: x, y, radius (unzoomed px), strength
  loupes: array<vec4f, 8>, // lenses at t, two slots each: center x, y (unzoomed), radius (unzoomed px), magnification;
                           // opacity, samples in loupeS (1: still), stretch (along the motion, length = elongation). Radius 0: none
  loupeS: array<vec4f, 72>, // each lens across the shutter: LENS_SAMPLES samples of two slots, laid out like loupes
}

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var bgTex: texture_2d<f32>;
@group(0) @binding(3) var smallTex: texture_2d<f32>;
@group(0) @binding(4) var lutTex: texture_3d<f32>;
@group(1) @binding(0) var screenTex: texture_external;
@group(1) @binding(1) var camTex: texture_external;
@group(1) @binding(2) var matteTex: texture_external;
@group(2) @binding(0) var cursorTex: texture_2d<f32>;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VO {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

// Quad over b = (x0, y0, x1, y1) in output px, drawn as a 4-vertex triangle strip.
fn box(i: u32, b: vec4f) -> VO {
  let c = vec2f(f32(i & 1u), f32(i >> 1u));
  let p = mix(b.xy, b.zw, c);
  var o: VO;
  o.pos = vec4f(p.x / F.a.x * 2.0 - 1.0, 1.0 - p.y / F.a.y * 2.0, 0.0, 1.0);
  o.uv = c;
  return o;
}

// ---- Shared math ----

fn unview(p: vec2f, v: vec3f) -> vec2f { return (p - F.a.xy * 0.5) / v.z + v.xy; }
fn toOut(u: vec2f, v: vec3f) -> vec2f { return (u - v.xy) * v.z + F.a.xy * 0.5; }

// View across the shutter, f in 0..1, piecewise linear between samples.
fn viewAt(f: f32) -> vec3f {
  let n = i32(F.a.w);
  if (n <= 1) { return F.views[0].xyz; }
  let x = clamp(f, 0.0, 1.0) * f32(n - 1);
  let i = min(i32(x), n - 2);
  return mix(F.views[i].xyz, F.views[i + 1].xyz, x - f32(i));
}

fn curAt(f: f32) -> vec4f {
  let n = i32(F.cur.x);
  if (n <= 1) { return F.curS[0]; }
  let x = clamp(f, 0.0, 1.0) * f32(n - 1);
  let i = min(i32(x), n - 2);
  return mix(F.curS[i], F.curS[i + 1], x - f32(i));
}

// Interleaved gradient noise: deterministic per pixel, so every render of a frame is identical.
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

// Signed distance to a rounded box centered at the origin; r4 = corner radii (tl, tr, br, bl).
fn sdBox(p: vec2f, half: vec2f, r4: vec4f) -> f32 {
  let rs = select(r4.xw, r4.yz, p.x > 0.0);
  let r = select(rs.x, rs.y, p.y > 0.0);
  let q = abs(p) - half + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

// Antialiased coverage of a signed distance, aa = size of one output pixel in the same units.
fn cover(sd: f32, aa: f32) -> f32 { return clamp(0.5 - sd / aa, 0.0, 1.0); }

// How much of output pixel p is inside the zoom viewport: 1 everywhere unless a split layout gives
// the screen its own panel, whose zoomed content must stay inside it.
fn inView(p: vec2f) -> f32 {
  let half = F.vp.zw * 0.5;
  return cover(sdBox(p - F.vp.xy - half, half, vec4f(F.viewT.w)), 1.0);
}

// Gaussian-blurred rounded box: exact along x (erf), 4-tap integration along y.
fn erf2(x: vec2f) -> vec2f {
  let s = sign(x);
  let a = abs(x);
  var r = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  r = r * r;
  return s - s / (r * r);
}
fn shadowRow(x: f32, y: f32, sigma: f32, r: f32, half: vec2f) -> f32 {
  let d = min(half.y - r - abs(y), 0.0);
  let c = half.x - r + sqrt(max(0.0, r * r - d * d));
  let i = 0.5 + 0.5 * erf2((x + vec2f(-c, c)) * (0.70710678 / sigma));
  return i.y - i.x;
}
fn boxShadow(p: vec2f, half: vec2f, sigma: f32, r: f32) -> f32 {
  let a = clamp(-3.0 * sigma, p.y - half.y, p.y + half.y);
  let b = clamp(3.0 * sigma, p.y - half.y, p.y + half.y);
  let step = (b - a) * 0.25;
  var y = a + step * 0.5;
  var v = 0.0;
  for (var i = 0; i < 4; i++) {
    v += shadowRow(p.x, p.y - y, sigma, r, half) * exp(-y * y / (2.0 * sigma * sigma)) * step;
    y += step;
  }
  return v / (2.50662827 * sigma);
}

// ---- Zoomed layer: background, shadow, device, screen with masks ----

fn background(u: vec2f) -> vec3f { return textureSampleLevel(bgTex, samp, u / F.a.xy, 0.0).rgb; }

fn shadowAlpha(u: vec2f) -> f32 {
  let unit = F.a.z;
  let s1 = 30.0 * unit;
  let o1 = 16.0 * unit;
  let s2 = 3.0 * unit;
  var a = 0.0;
  for (var i = 0; i < i32(F.dev.z); i++) {
    let r = F.sh[i * 2];
    let rad = F.sh[i * 2 + 1].x;
    let half = r.zw * 0.5;
    let p = u - r.xy - half;
    let sd = sdBox(p, half, vec4f(rad));
    if (sd < -2.0 || sd > 3.0 * s1 + o1) { continue; } // hidden under the opaque caster, or too far
    let key = boxShadow(p - vec2f(0.0, o1), half, s1, rad);
    let amb = boxShadow(p - vec2f(0.0, unit), half, s2, rad);
    a = max(a, 1.0 - (1.0 - key * 0.65 * F.scr2.w) * (1.0 - amb * 0.35 * F.scr2.w));
  }
  return a;
}

fn part(c: vec3f, u: vec2f, i: i32, aa: f32) -> vec3f {
  let r = F.parts[i * 4];
  let half = r.zw * 0.5;
  let p = u - r.xy - half;
  if (any(abs(p) > half + vec2f(aa))) { return c; }
  let k = cover(sdBox(p, half, F.parts[i * 4 + 1]), aa);
  let col = mix(F.parts[i * 4 + 2], F.parts[i * 4 + 3], clamp((u.y - r.y) / r.w, 0.0, 1.0));
  return mix(c, col.rgb, k * col.a);
}

// Box-filtered screen sample: m = source px per output px. Minified video gets k x k bilinear
// taps so text does not shimmer or alias in small previews.
fn screenSample(uv: vec2f, m: f32) -> vec3f {
  if (m <= 1.3) { return textureSampleBaseClampToEdge(screenTex, samp, uv).rgb; }
  let k = min(ceil(m / 1.5), 4.0);
  let step = m / k / F.scr3.xy;
  var c = vec3f(0.0);
  for (var j = 0.0; j < k; j += 1.0) {
    for (var i = 0.0; i < k; i += 1.0) {
      c += textureSampleBaseClampToEdge(screenTex, samp, uv + (vec2f(i, j) - 0.5 * (k - 1.0)) * step).rgb;
    }
  }
  return c / (k * k);
}

// Blur mask color: a tent filter over a coarse level of the quarter-res screen pyramid.
fn blurred(uv: vec2f) -> vec3f {
  let lod = F.scr3.w;
  let t = exp2(lod) * 4.0 / F.scr3.xy;
  var c = vec3f(0.0);
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let w = (3.0 - abs(f32(i))) * (3.0 - abs(f32(j)));
      c += textureSampleLevel(smallTex, samp, uv + vec2f(f32(i), f32(j)) * t, lod).rgb * w;
    }
  }
  return c / 81.0;
}

// Blur and pixelate masks, in screen source px so they stay locked to the content through zooms.
fn masked(c0: vec3f, uv: vec2f, m: f32) -> vec4f {
  var c = c0;
  var mark = 0.0;
  let ps = uv * F.scr3.xy;
  for (var i = 0; i < i32(F.scr2.z); i++) {
    let r = F.masks[i * 2];
    let k = F.masks[i * 2 + 1];
    if (k.x > 1.5) { continue; }
    let half = r.zw * 0.5;
    let cv = cover(sdBox(ps - r.xy - half, half, vec4f(k.z)), max(m, 1.0)) * k.y;
    if (cv <= 0.0) { continue; }
    var e: vec3f;
    if (k.x < 0.5) {
      e = blurred(uv);
    } else {
      let b = F.scr3.z;
      let cell = r.xy + (floor((ps - r.xy) / b) + 0.5) * b;
      e = textureSampleLevel(smallTex, samp, cell / F.scr3.xy, log2(b / 4.0)).rgb;
    }
    c = mix(c, e, cv);
    mark = max(mark, cv);
  }
  return vec4f(c, mark);
}

// Coverage of the screen frame at unzoomed point u: the shown recording grown by the inset, rounded.
fn frameCover(u: vec2f, aa: f32) -> f32 {
  let half = F.vis.zw * 0.5;
  return cover(sdBox(u - F.vis.xy - half, half + F.dev.w, vec4f(F.scr2.x)), aa);
}

// The recording at unzoomed point u with its masks: rgb + dither mark.
fn screenAt(u: vec2f, aa: f32) -> vec4f {
  let r = F.scr;
  let uv = (clamp(u, F.vis.xy, F.vis.xy + F.vis.zw) - r.xy) / r.zw; // held to the shown part: the inset takes its edge color
  let m = F.scr3.x / r.z * aa;
  return masked(screenSample(uv, m), uv, m);
}

// ---- Click effects on the screen's glass (CLICK_FX in overlays/index.ts times them) ----
// clicks[i] is x, y, radius (unzoomed px), strength; fin.y picks the effect: 1 swell, 2 wave,
// 3 circle, 4 focus ring. They are drawn in this pass, so the loupe and motion blur carry them and
// the cursor, drawn later, floats above.
//
// Swell and wave raise one crest per click, h(r) = g((r - f) / w) + g((-r - f) / w) with
// g(x) = exp(-x^2), whose front f runs out from the click, mirrored so the surface stays smooth at
// its center. The recording is sampled along the slope, so the crest magnifies what it passes like
// a thin lens and dispersion bends the colors around it into a rainbow. Each crest stays several
// times wider than its shift, so text bends and swells instead of folding into rainbow noise.
// The swell is broad, unlit, and blurred along the bend. The wave is narrower and
// catches the loupe's key light, so it still shows over flat UI.

const SLOPE = 0.857764; // steepest |g'|, sqrt(2 / e)

struct Crest {
  w: f32,     // width, units
  shift: f32, // refraction at the steepest slope, units
  tilt: f32,  // surface tilt at the steepest slope, for the light
  shade: f32, // how much the light brightens and darkens the slopes
  spec: f32,  // specular highlight strength
  disp: f32,  // dispersion: red bends 1 - disp as far as green, blue 1 + disp
  blur: f32,  // smear along the bend, as a fraction of the shift
}

fn crest() -> Crest {
  if (F.fin.y == 1.0) { return Crest(60.0, 6.0, 0.0, 0.0, 0.0, 0.72, 0.5); }
  return Crest(22.0, 4.5, 0.45, 0.1, 0.6, 0.48, 0.0);
}

// Slope of every live crest at unzoomed point u: dimensionless, outward is uphill.
fn ripples(u: vec2f, k: Crest) -> vec2f {
  let w = k.w * F.a.z;
  var v = vec2f(0.0);
  for (var i = 0; i < 4; i++) {
    let c = F.clicks[i]; // x, y, front, strength
    let q = u - c.xy;
    let r = length(q);
    if (c.w <= 0.0 || r > c.z + 3.0 * w) { continue; } // gone, or ahead of the front: still glass
    let a = (r - c.z) / w;
    let b = (r + c.z) / w;
    v += q / max(r, 1e-3) * -2.0 * (a * exp(-a * a) + b * exp(-b * b)) * c.w; // g'(a) - g'(-b)
  }
  return v;
}

// The recording shifted by off, red bending least and blue most.
fn bent(u: vec2f, off: vec2f, d: f32, aa: f32) -> vec4f {
  let s = screenAt(u + off, aa);
  return vec4f(screenAt(u + off * (1.0 - d), aa).r, s.g, screenAt(u + off * (1.0 + d), aa).b, s.a);
}

fn rippled(u: vec2f, v: vec2f, k: Crest, aa: f32) -> vec4f {
  let off = v * (k.shift / SLOPE) * F.a.z;
  var s: vec4f;
  if (k.blur > 0.0) { // taps along the bend: blur follows the distortion, still glass stays sharp
    s = vec4f(0.0);
    for (var i = 0; i < 7; i++) { s += bent(u, off * (1.0 + k.blur * (f32(i) / 3.0 - 1.0)), k.disp, aa); }
    s /= 7.0;
  } else {
    s = bent(u, off, k.disp, aa);
  }
  let tilt = k.tilt / SLOPE;
  let n = normalize(vec3f(-v * tilt, 1.0));
  let L = normalize(KEY);
  let lit = dot(n, L) / L.z - 1.0; // 0 on still glass, > 0 facing the light
  let spec = pow(max(dot(n, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), 90.0) * k.spec;
  return vec4f(max(s.rgb * (1.0 + k.shade * lit), vec3f(0.0)) + spec, max(s.a, min(length(v) * tilt * 4.0, 1.0)));
}

const FOCUS_W = 2.5; // focus ring line width, units
const FOCUS_TINT = vec3f(0.525, 0.463, 1.0); // violet, sRGB

// The circle and the focus ring over the recording's color c at u: rgb and coverage (for the dither mark).
fn clickMarks(c: vec3f, u: vec2f, aa: f32) -> vec4f {
  var o = c;
  var cover = 0.0;
  let circle = F.fin.y == 3.0;
  for (var i = 0; i < 4; i++) {
    let k = F.clicks[i]; // x, y, radius, opacity
    if (k.w <= 0.0) { continue; }
    let r = length(u - k.xy);
    if (circle) {
      // A tinted disc, lighter in the middle with a crisp rim. It darkens light UI and lightens dark
      // UI, with one tone per click taken from around it so it never flips color across text.
      if (r > k.z + 2.0 * aa) { continue; }
      var l = 0.0;
      for (var j = 0; j < 8; j++) {
        let ang = f32(j) * 0.785398;
        l += dot(screenAt(k.xy + vec2f(cos(ang), sin(ang)) * 14.0 * F.a.z, aa).rgb, vec3f(0.2126, 0.7152, 0.0722));
      }
      let tone = select(vec3f(1.0), vec3f(0.0), l > 4.0);
      let inside = 1.0 - smoothstep(k.z - aa, k.z + aa, r);
      let rim = 1.0 - smoothstep(0.0, 1.5 * aa, abs(r - k.z + aa));
      let rn = min(r / k.z, 1.0);
      let a = k.w * clamp(inside * (0.55 + 0.45 * rn * rn) + 0.96 * rim, 0.0, 1.0);
      o = mix(o, tone, a);
      cover = max(cover, a);
    } else {
      // A violet line with a soft light rim that keeps it off dark text.
      let w = FOCUS_W * F.a.z;
      let d = abs(r - k.z);
      let halo = exp(-pow(d / (1.8 * w + F.a.z), 2.0));
      let line = 1.0 - smoothstep(0.5 * (w - aa), 0.5 * (w + aa), d);
      o = mix(mix(o, vec3f(1.0), 0.5 * halo * k.w), FOCUS_TINT, 0.95 * line * k.w);
      cover = max(cover, max(0.5 * halo, line) * k.w);
    }
  }
  return vec4f(o, cover);
}

// Everything under the zoom view except the cursor, at unzoomed point u. rgb + dither mark.
fn zoomed(u: vec2f, aa: f32) -> vec4f {
  var c = background(u);
  if (F.scr2.y < 0.5) { return vec4f(c, 1.0); }
  if (F.scr2.w > 0.0) { c *= 1.0 - shadowAlpha(u); }
  let n = i32(F.dev.x);
  let over = i32(F.dev.y);
  for (var i = 0; i < over; i++) { c = part(c, u, i, aa); }
  var mark = 1.0;
  let cv = frameCover(u, aa);
  if (cv > 0.0) {
    let fx = F.fin.y;
    var s: vec4f;
    var v = vec2f(0.0);
    var k: Crest;
    if (fx == 1.0 || fx == 2.0) { k = crest(); v = ripples(u, k); }
    if (dot(v, v) > 1e-8) { s = rippled(u, v, k, aa); } else { s = screenAt(u, aa); }
    if (fx >= 3.0) { let m = clickMarks(s.rgb, u, aa); s = vec4f(m.rgb, max(s.a, m.a)); }
    c = mix(c, s.rgb, cv);
    mark = mix(1.0, s.a, cv);
  }
  for (var i = over; i < n; i++) { c = part(c, u, i, aa); }
  return vec4f(c, mark);
}

@fragment fn fs_main(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let k = inView(p);
  var c = vec4f(0.0);
  if (k > 0.0) { c = zoomed(unview(p, F.viewT.xyz), 1.0 / F.viewT.z); }
  if (k < 1.0) { c = mix(zoomed(p, 1.0), c, k); }
  return c;
}

// Motion blur of the zoomed layer, drawn from the frame rendered at t (zTex). Everything under the
// view is still in scene space, so the content under pixel p at shutter time f sits exactly at
// toOut(unview(p, view_f), view_t) in that frame: averaging those taps equals rendering every
// sub-frame, at one texture fetch per tap. The tap count follows the pixel's own displacement.
@group(0) @binding(30) var zTex: texture_2d<f32>;

@fragment fn fs_viewblur(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  if (inView(p) < 1.0) { return textureLoad(zTex, vec2i(p), 0); } // unzoomed there: nothing moves
  let n = i32(F.a.w);
  let vt = F.viewT.xyz;
  let d = length(unview(p, F.views[n - 1].xyz) - unview(p, F.views[0].xyz)) * vt.z;
  let count = clamp(i32(ceil(d / 1.25)), 1, 64);
  if (count == 1) { return textureLoad(zTex, vec2i(p), 0); }
  let j = ign(p);
  var acc = vec4f(0.0);
  var w = 0.0;
  for (var i = 0; i < count; i++) {
    let q = toOut(unview(p, viewAt((f32(i) + j) / f32(count))), vt);
    if (all(q >= vec2f(0.0)) && all(q <= F.a.xy) && inView(q) >= 1.0) { // outside the rendered zoomed layer: skip, never smear the edge
      acc += textureSampleLevel(zTex, samp, q / F.a.xy, 0.0);
      w += 1.0;
    }
  }
  return select(textureLoad(zTex, vec2i(p), 0), acc / w, w > 0.0);
}

// ---- Cursor ----

// vs: output px per unzoomed px.
fn cursorAt(u: vec2f, s: vec4f, vs: f32) -> vec4f {
  let d = u - s.xy;
  let ca = cos(s.w);
  let sa = sin(s.w);
  let q = vec2f(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / s.z + F.curImg.zw;
  let uv = q / F.curImg.xy;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  let lod = log2(max(F.curTex.x / (s.z * vs), 1e-4));
  let c = textureSampleLevel(cursorTex, samp, uv, max(lod - 0.5, 0.0)); // slight sharpening bias: the art is 8x supersampled
  // A crop hides the cursor past the shown part, like the content under it.
  return select(c, c * frameCover(u, 1.0 / vs), F.curTex.y > 0.5);
}

@vertex fn vs_cursor(@builtin(vertex_index) i: u32) -> VO { return box(i, F.curBox); }

@fragment fn fs_cursor(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let count = i32(F.cur.z);
  if (count <= 1) { return cursorAt(unview(p, viewAt(0.5)), curAt(0.5), viewAt(0.5).z) * F.cur.y * inView(p); }
  let j = ign(p);
  var acc = vec4f(0.0);
  for (var i = 0; i < count; i++) {
    let f = (f32(i) + j) / f32(count);
    let w = viewAt(f);
    acc += cursorAt(unview(p, w), curAt(f), w.z);
  }
  return acc / f32(count) * F.cur.y * inView(p);
}

// ---- Highlight masks: dim everything outside them ----

fn dimAt(u: vec2f, aa: f32) -> f32 {
  var inside = 0.0;
  var op = 0.0;
  let k = F.scr.zw / F.scr3.xy; // unzoomed px per source px
  for (var i = 0; i < i32(F.scr2.z); i++) {
    let m = F.masks[i * 2 + 1];
    if (m.x < 1.5) { continue; }
    let r = F.masks[i * 2];
    let half = r.zw * k * 0.5;
    inside = max(inside, cover(sdBox(u - F.scr.xy - r.xy * k - half, half, vec4f(m.z * k.x)), aa));
    op = max(op, m.y);
  }
  return 0.55 * op * (1.0 - inside);
}

@fragment fn fs_highlight(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let k = inView(p);
  var d = 0.0;
  if (k > 0.0) { d = dimAt(unview(p, F.viewT.xyz), 1.0 / F.viewT.z); }
  if (k < 1.0) { d = mix(dimAt(p, 1.0), d, k); }
  return vec4f(0.0, 0.0, 0.0, d);
}

// ---- Glass loupe: a lens over the zoomed layer, masks, cursor and highlight included ----
// A flat-topped glass disc with a rounded bevel. The flat top magnifies almost to the edge;
// across the bevel the content runs on ever slower and stands still at the rim, so whatever reaches
// the edge stretches and curls along it, the way a thick lens bends lines at its rim. Squeezing the
// frame around the lens into the bevel instead aliases into streaks. No outline: the bending is the
// edge. Lit by one key light from above: the bevel shades darker turned away from it, a hairline of
// light catches the rim, Fresnel reflection at grazing angles, and dispersion splits the colors where
// the bevel bends hardest. Moving, the drop stretches along its motion, keeping its
// area, and what it shows smears across the shutter like the rest of the frame. The frame dims most
// right around a lens and less further out, so the lens lifts off the screen without the whole frame
// going dark. Several lenses draw in order, a later one over an earlier one.

const BEVEL = 0.15; // bevel width, fraction of the radius
const CURL = 1.0 / 3.0; // the bevel shows this share of what the flat top would show across it, the least that
// stays monotone: the content slows as (1 - s)^2 and stretches into a curl along the rim
const DISPERSION = 0.045; // how far red and blue bend apart at the rim, fraction of the radius
const KEY = vec3f(-0.38, -0.82, 0.43); // key light direction (output px axes, z toward the viewer)
const AROUND = 0.14; // how much the frame right around a lens dims
const AROUND_REACH = 0.8; // ...and half that this many radii out from its edge
const AROUND_SHIFT = 0.3; // the dim sits this many radii off the lens, away from the light, like its shadow
const LENSES = 4u;
const LENS_SAMPLES = 9u; // per lens in F.loupeS (renderer.ts LOUPE_SAMPLES)

// Cubic Hermite from (0, p0) with slope m0 to (1, p1) with slope m1, at s: value, slope.
fn hermite(s: f32, p0: f32, m0: f32, p1: f32, m1: f32) -> vec2f {
  let s2 = s * s;
  let s3 = s2 * s;
  return vec2f(
    (2.0 * s3 - 3.0 * s2 + 1.0) * p0 + (s3 - 2.0 * s2 + s) * m0 + (3.0 * s2 - 2.0 * s3) * p1 + (s3 - s2) * m1,
    (6.0 * s2 - 6.0 * s) * p0 + (3.0 * s2 - 4.0 * s + 1.0) * m0 + (6.0 * s - 6.0 * s2) * p1 + (3.0 * s2 - 2.0 * s) * m1);
}

// Radius shown at radius rho (both fractions of the lens radius, from its center), and its
// derivative: magnified on the flat top, then a monotone cubic across the bevel that slows to a stop
// at the rim. Under 1.5x it blends into one that ends on the content just outside the rim, so at
// magnification 1 the lens is flat glass and shows exactly what lies under it.
fn lensMap(rho: f32, mag: f32) -> vec2f {
  let e = 1.0 - BEVEL;
  if (rho <= e) { return vec2f(rho / mag, 1.0 / mag); }
  let s = min((rho - e) / BEVEL, 1.0);
  let p0 = e / mag;
  let m0 = BEVEL / mag;
  let curl = hermite(s, p0, m0, p0 + CURL * m0, 0.0);
  let meet = hermite(s, p0, m0, 1.0, (1.0 - p0) * (1.0 + 1.8 * clamp(mag - 1.0, 0.0, 1.0))); // under 3x the secant: stays monotone
  let h = mix(meet, curl, clamp(2.0 * (mag - 1.0), 0.0, 1.0));
  return vec2f(h.x, h.y / BEVEL);
}

// Everything the lens shows at unzoomed point um: the zoomed layer, the cursor (sample cs), the highlight dim.
fn underLens(um: vec2f, aa: f32, vs: f32, cs: vec4f) -> vec3f {
  var col = zoomed(um, aa).rgb;
  if (F.cur.w > 0.5) {
    let k = cursorAt(um, cs, vs) * F.cur.y;
    col = k.rgb + col * (1.0 - k.a);
  }
  return col * (1.0 - dimAt(um, aa));
}

struct Lens { a: vec4f, b: vec4f } // two slots of F.loupes

// Lens i at shutter time f in 0..1, piecewise linear between its samples; at t when f < 0 or it is still.
fn lensOf(i: u32, f: f32) -> Lens {
  let n = u32(F.loupes[2u * i + 1u].y);
  if (f < 0.0 || n <= 1u) { return Lens(F.loupes[2u * i], F.loupes[2u * i + 1u]); }
  let x = clamp(f, 0.0, 1.0) * f32(n - 1u);
  let k = min(u32(x), n - 2u);
  let w = x - f32(k);
  let j = 2u * (i * LENS_SAMPLES + k);
  return Lens(mix(F.loupeS[j], F.loupeS[j + 2u], w), mix(F.loupeS[j + 1u], F.loupeS[j + 3u], w));
}

// Lens L at unzoomed point u (vt the view, aa unzoomed px per output px, cs the cursor sample, fringe
// whether to split the colors): premultiplied color, coverage.
fn lensAt(L: Lens, u: vec2f, vt: vec3f, aa: f32, cs: vec4f, fringe: bool) -> vec4f {
  let c = L.a.xy;
  let R = L.a.z;
  let mag = L.a.w;
  let op = L.b.x;
  let st = L.b.zw;
  let q = u - c;
  // The stretched drop: an ellipse 1 + k long along the motion and 1 / sqrt(1 + k) across it.
  let k = length(st);
  let ax = select(vec2f(1.0, 0.0), st / max(k, 1e-6), k > 1e-6);
  let along = dot(q, ax);
  let sq = ax * (along / (1.0 + k)) + (q - ax * along) * sqrt(1.0 + k);
  let d = length(sq);
  let cv = cover(d - R, 2.0 * aa); // a rounded edge is a little soft, not a cut
  if (cv <= 0.0) { return vec4f(0.0); }

  let rho = min(d / R, 1.0);
  let gq = ax * (dot(sq, ax) / (1.0 + k)) + (sq - ax * dot(sq, ax)) * sqrt(1.0 + k); // gradient of d: the rim's normal
  let dir = gq / max(length(gq), 1e-6);
  let m = lensMap(rho, mag);
  let shown = m.x / max(rho, 1e-4); // 1 / mag on the flat top: the magnification stays round when stretched
  let foot = aa * max(m.y, shown); // unzoomed px per output px
  let vs = vt.z / foot * aa;
  var col = underLens(c + q * shown, foot, vs, cs);
  let s = clamp((rho - (1.0 - BEVEL)) / BEVEL, 0.0, 1.0); // 0 on the flat top, 1 at the rim
  if (s > 0.0 && fringe) {
    // Dispersion: red bends least, so it shows what lies a little further out, and blue the reverse.
    // Splitting the radius rather than the content keeps the fringes as wide where the rim stretches.
    let sp = DISPERSION * s * clamp(mag - 1.0, 0.0, 1.0);
    let r = lensMap(min(rho * (1.0 + sp), 1.0), mag).x / max(rho, 1e-4);
    let b = lensMap(rho * (1.0 - sp), mag).x / max(rho, 1e-4);
    col = vec3f(underLens(c + q * r, foot, vs, cs).r, col.g, underLens(c + q * b, foot, vs, cs).b);
  }

  // Surface normal of the bevel: flat on top, turning to near vertical at the rim.
  let tilt = 1.5 * pow(s, 2.4);
  let n = vec3f(dir * sin(tilt), cos(tilt));
  let fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  let env = mix(vec3f(1.0), vec3f(0.55, 0.58, 0.64), smoothstep(-0.7, 0.9, dir.y)); // bright sky above, the room below
  // The rim rounds away: the outer bevel shades darker on the side turned from the light and barely
  // on the side facing it, the last few px darken all around, and a hairline of light catches the
  // very edge. Broad specular crescents read as plastic, not glass.
  let toward = dot(dir, normalize(KEY.xy)); // 1 facing the light, -1 turned away
  let round = smoothstep(1.0 - 0.7 * BEVEL, 1.0, rho);
  let px = (R - d) / aa; // output px in from the rim
  var g = col * (1.0 - round * mix(0.15, 0.02, 0.5 + 0.5 * toward)) * (1.0 - 0.1 * (1.0 - smoothstep(1.0, 6.0, px)));
  g = mix(g, env, fres * 0.15);
  g += vec3f(0.1 + 0.12 * max(toward, 0.0)) * (1.0 - smoothstep(0.0, 1.5, px));

  // Appearing, the magnification grows from 1, where the lens shows exactly what lies under it, so
  // the content stays opaque and swells in place while only the glass and the dim fade in. Fading
  // the content too would show it twice, magnified over unmagnified.
  col = mix(col, g, op);
  return vec4f(col * cv, cv);
}

// Every lens over output pixel p at shutter time f (< 0: at t), and the dim around them.
fn lensesAt(p: vec2f, f: f32, fringe: bool) -> vec4f {
  let vt = select(viewAt(f), F.viewT.xyz, f < 0.0);
  let u = unview(p, vt);
  let aa = 1.0 / vt.z;
  let cs = curAt(select(f, 0.5, f < 0.0));
  var out = vec4f(0.0);
  var dim = 0.0;
  for (var i = 0u; i < LENSES; i++) {
    if (F.loupes[2u * i].z <= 0.0) { continue; }
    let L = lensOf(i, f);
    let l = lensAt(L, u, vt, aa, cs, fringe);
    out = l + out * (1.0 - l.a);
    let d = max(length(u - L.a.xy + normalize(KEY.xy) * AROUND_SHIFT * L.a.z) - L.a.z, 0.0) / (AROUND_REACH * L.a.z);
    dim = max(dim, AROUND * L.b.x / (1.0 + d * d));
  }
  return vec4f(out.rgb, out.a + dim * (1.0 - out.a));
}

// Output px the content under p travels across the shutter through a lens: the lens gliding, its
// magnification changing, the view moving under it (read off the flat top, which shows the most),
// and the cursor it magnifies moving inside it.
fn lensTravel(p: vec2f) -> f32 {
  var moving = F.a.w > 1.5 || F.cur.z > 1.5;
  for (var i = 0u; i < LENSES; i++) { moving = moving || (F.loupes[2u * i].z > 0.0 && F.loupes[2u * i + 1u].y > 1.5); }
  if (!moving) { return 0.0; }
  var was: array<vec4f, 4>; // per lens: what its flat top shows at p, its center
  var wasCur: array<vec2f, 4>; // per lens: where it shows the cursor
  var travel = 0.0;
  for (var k = 0; k <= 8; k++) {
    let f = f32(k) / 8.0;
    let vt = viewAt(f);
    let u = unview(p, vt);
    let cs = curAt(f);
    let reach = max(F.curImg.x, F.curImg.y) * cs.z; // the cursor's extent, unzoomed px
    var step = 0.0;
    for (var i = 0u; i < LENSES; i++) {
      if (F.loupes[2u * i].z <= 0.0) { continue; }
      let L = lensOf(i, f);
      let now = vec4f(L.a.xy + (u - L.a.xy) / L.a.w, L.a.xy);
      let cur = L.a.xy + (cs.xy - L.a.xy) * L.a.w;
      if (k > 0 && length(u - L.a.xy) < 1.5 * L.a.z) {
        step = max(step, max(length(now.xy - was[i].xy) * L.a.w, length(now.zw - was[i].zw)) * vt.z);
        if (F.cur.w > 0.5 && length(u - cur) < reach * L.a.w + length(cur - wasCur[i])) { step = max(step, length(cur - wasCur[i]) * vt.z); }
      }
      was[i] = now;
      wasCur[i] = cur;
    }
    travel += step;
  }
  return travel;
}

// Like the zoomed layer's motion blur, but the lens bends what it shows, so no reprojection of one
// frame reaches it: average whole lens renders across the shutter, as many as the content travels.
// Smeared further than a few px, the color fringes are gone in the blur: those taps skip them.
@fragment fn fs_loupe(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let count = clamp(i32(ceil(lensTravel(p) / 1.5)), 1, 32);
  if (count == 1) { return lensesAt(p, -1.0, true); }
  let j = ign(p);
  var acc = vec4f(0.0);
  for (var i = 0; i < count; i++) { acc += lensesAt(p, (f32(i) + j) / f32(count), count <= 4); }
  return acc / f32(count);
}

// ---- Camera ----

fn camBox() -> vec4f {
  let m = 64.0 * F.a.z;
  return vec4f(F.cam.xy - m, F.cam.xy + F.cam.zw + m);
}

@vertex fn vs_camera(@builtin(vertex_index) i: u32) -> VO { return box(i, camBox()); }

fn camSample(uv: vec2f, m: f32) -> vec3f {
  if (m <= 1.3) { return textureSampleBaseClampToEdge(camTex, samp, uv).rgb; }
  let k = min(ceil(m / 1.5), 4.0);
  let step = m / k / F.cam4.xy;
  var c = vec3f(0.0);
  for (var j = 0.0; j < k; j += 1.0) {
    for (var i = 0.0; i < k; i += 1.0) {
      c += textureSampleBaseClampToEdge(camTex, samp, uv + (vec2f(i, j) - 0.5 * (k - 1.0)) * step).rgb;
    }
  }
  return c / (k * k);
}

fn camUV(p: vec2f) -> vec2f {
  var lp = (p - F.cam.xy) / F.cam.zw;
  if (F.cam1.w > 0.5) { lp.x = 1.0 - lp.x; }
  return F.cam2.xy + lp * F.cam2.zw;
}

// Camera alpha at output point p: the shape, times the person matte when the background is removed.
fn camAlpha(p: vec2f) -> f32 {
  let half = F.cam.zw * 0.5;
  var a = cover(sdBox(p - F.cam.xy - half, half, vec4f(F.cam1.x)), 1.0);
  if (F.cam3.x > 0.5 && a > 0.0) { a *= textureSampleBaseClampToEdge(matteTex, samp, camUV(p)).r; }
  return a;
}

fn grade(c: vec3f) -> vec3f {
  let n = F.cam3.z;
  let x = clamp((c - F.lutMin.xyz) / (F.lutMax.xyz - F.lutMin.xyz), vec3f(0.0), vec3f(1.0));
  return textureSampleLevel(lutTex, samp, x * ((n - 1.0) / n) + 0.5 / n, 0.0).rgb;
}

@fragment fn fs_camera(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let unit = F.a.z;
  var out = vec4f(0.0);
  let a = camAlpha(p);
  if (a > 0.0) {
    let uv = camUV(p);
    var rgb = camSample(uv, F.cam4.x * F.cam2.z / F.cam.z);
    if (F.cam3.y > 0.5) { rgb = grade(rgb); }
    out = vec4f(rgb * a, a);
  }
  var sh = 0.0;
  if (F.cam1.y > 0.0) {
    let half = F.cam.zw * 0.5;
    let q = p - F.cam.xy - half;
    if (F.cam3.x < 0.5) {
      sh = boxShadow(q - vec2f(0.0, 10.0 * unit), half, 22.0 * unit, F.cam1.x) * 0.5;
      sh = 1.0 - (1.0 - sh) * (1.0 - boxShadow(q - vec2f(0.0, unit), half, 2.5 * unit, F.cam1.x) * 0.25);
    } else {
      // Background removed: a soft shadow of the person's silhouette.
      for (var i = 0; i < 12; i++) {
        let ang = f32(i) * 2.39996323;
        let rr = sqrt((f32(i) + 0.5) / 12.0) * 10.0 * unit;
        sh += camAlpha(p - vec2f(0.0, 8.0 * unit) + vec2f(cos(ang), sin(ang)) * rr);
      }
      sh = sh / 12.0 * 0.4;
    }
    sh *= F.cam1.y;
  }
  return (out + vec4f(0.0, 0.0, 0.0, sh) * (1.0 - out.a)) * F.cam1.z;
}

// ---- Final: overlay canvas on top, then dither to the 8-bit canvas ----

@group(0) @binding(10) var frameTex: texture_2d<f32>;
@group(0) @binding(11) var overlayTex: texture_2d<f32>;

@fragment fn fs_final(v: VO) -> @location(0) vec4f {
  let ip = vec2i(v.pos.xy);
  let c = textureLoad(frameTex, ip, 0);
  var rgb = c.rgb;
  var mark = c.a;
  if (F.fin.x > 0.5) {
    let o = textureLoad(overlayTex, ip, 0);
    rgb = o.rgb + rgb * (1.0 - o.a);
    mark *= 1.0 - o.a;
  }
  // +-0.5 LSB uniform noise before the hardware rounds to 8 bits: smooth ramps stop banding, and
  // values that are already exact (flat UI, solid colors) round back to themselves.
  rgb += (ign(v.pos.xy + vec2f(17.0, 59.0)) - 0.5) / 255.0 * mark;
  return vec4f(rgb, 1.0);
}

// ---- Utility passes: background generation, blur, mipmaps, mask pyramid ----

struct Pass {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  pts: array<vec4f, 12>,
  cols: array<vec4f, 12>,
}

@group(0) @binding(20) var srcTex: texture_2d<f32>;
@group(0) @binding(21) var<uniform> P: Pass;
@group(0) @binding(22) var imgTex: texture_2d<f32>;

fn encodeSrgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

fn oklabToSrgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  let lin = vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
  return encodeSrgb(clamp(lin, vec3f(0.0), vec3f(1.0)));
}

// P.a = kind (0 color, 1 linear gradient, 2 wallpaper, 3 image), count, angle (rad) | wallpaper style
// P.b = unused, width, height, image lod.  P.c = image uv scale, offset.  cols = OKLab.
// Wallpapers: P.pts holds the style's params; wallpaper() (generated by the renderer) dispatches to
// wp_<style>(uv, wh) in src/engine/gpu/wallpapers/<style>.wgsl, which returns encoded sRGB.
@fragment fn fs_bg(v: VO) -> @location(0) vec4f {
  let kind = P.a.x;
  let n = i32(P.a.y);
  let wh = P.b.yz;
  if (kind < 0.5) { return vec4f(oklabToSrgb(P.cols[0].xyz), 1.0); }
  if (kind < 1.5) {
    // CSS linear-gradient geometry: 0 rad points up, the line spans the box's projection.
    let dir = vec2f(sin(P.a.z), -cos(P.a.z));
    let len = abs(wh.x * dir.x) + abs(wh.y * dir.y);
    let t = clamp(dot((v.uv - 0.5) * wh, dir) / len + 0.5, 0.0, 1.0);
    let x = t * f32(n - 1);
    let i = min(i32(x), n - 2);
    return vec4f(oklabToSrgb(mix(P.cols[i].xyz, P.cols[i + 1].xyz, x - f32(i))), 1.0);
  }
  if (kind < 2.5) {
    // 4 rotated-grid samples per pixel keep layer edges and fine lines clean. The background is
    // rendered once per size, so a wallpaper may spend freely here.
    let style = i32(P.a.z);
    var c = wallpaper(v.uv + vec2f(0.125, 0.375) / wh, wh, style);
    c += wallpaper(v.uv + vec2f(-0.375, 0.125) / wh, wh, style);
    c += wallpaper(v.uv + vec2f(0.375, -0.125) / wh, wh, style);
    c += wallpaper(v.uv + vec2f(-0.125, -0.375) / wh, wh, style);
    return vec4f(c * 0.25, 1.0);
  }
  return vec4f(textureSampleLevel(imgTex, samp, v.uv * P.c.xy + P.c.zw, P.b.w).rgb, 1.0);
}

// Separable Gaussian. P.a = direction (uv per texel), sigma (texels), source lod.
@fragment fn fs_blur(v: VO) -> @location(0) vec4f {
  let sigma = P.a.z;
  let r = i32(ceil(sigma * 3.0));
  var acc = vec4f(0.0);
  var sum = 0.0;
  for (var i = -r; i <= r; i++) {
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    acc += textureSampleLevel(srcTex, samp, v.uv + P.a.xy * f32(i), P.a.w) * w;
    sum += w;
  }
  return acc / sum;
}

@fragment fn fs_mip(v: VO) -> @location(0) vec4f { return textureSampleLevel(srcTex, samp, v.uv, 0.0); }

// Screen frame -> quarter resolution (a 4x4 box from 4 bilinear taps), base of the mask pyramid.
@fragment fn fs_small(v: VO) -> @location(0) vec4f {
  let t = 1.0 / F.scr3.xy;
  var c = textureSampleBaseClampToEdge(screenTex, samp, v.uv + vec2f(-t.x, -t.y)).rgb;
  c += textureSampleBaseClampToEdge(screenTex, samp, v.uv + vec2f(t.x, -t.y)).rgb;
  c += textureSampleBaseClampToEdge(screenTex, samp, v.uv + vec2f(-t.x, t.y)).rgb;
  c += textureSampleBaseClampToEdge(screenTex, samp, v.uv + vec2f(t.x, t.y)).rgb;
  return vec4f(c * 0.25, 1.0);
}
