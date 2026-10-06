// Grip compositor. One module, one entry point per pass; renderer.ts drives them.
// Colors are sRGB-encoded. Blended passes output premultiplied alpha. Coordinates are output px,
// origin top-left; "u" is unzoomed px (scene space), mapped to output by the zoom view.
// The frame target's alpha is not coverage: it is the dither mark (1 = smooth synthetic content
// such as gradients and shadows that needs dithering, 0 = video that must stay untouched).

struct Frame {
  a: vec4f,        // output w, h, unit (px per style unit), view samples
  viewT: vec4f,    // view at t: center x, y, scale; viewport corner radius
  scr: vec4f,      // recording rect (unzoomed px); the frame is this grown by dev.w
  scr2: vec4f,     // screen radius, has screen, mask count, shadow strength
  scr3: vec4f,     // screen source w, h (px), pixelate block (source px), blur mip level
  dev: vec4f,      // device parts, first part drawn over the screen, shadow casters, inset (px)
  sh: array<vec4f, 4>,      // shadow casters: rect, (radius)
  views: array<vec4f, 16>,  // shutter samples of the view: center x, y, scale
  parts: array<vec4f, 48>,  // device parts: rect, radii (tl tr br bl), top rgba, bottom rgba
  masks: array<vec4f, 32>,  // rect (screen source px), (kind 0 blur 1 pixelate 2 highlight, opacity, radius)
  cur: vec4f,      // cursor samples, opacity, samples per pixel, has cursor
  curImg: vec4f,   // image w, h, hotspot x, y (image px)
  curTex: vec4f,   // texture px per image px
  curBox: vec4f,   // swept bounds x0, y0, x1, y1 (output px)
  curS: array<vec4f, 16>,   // shutter samples of the cursor: x, y (unzoomed), unzoomed px per image px, angle
  loupe: vec4f,    // center x, y (unzoomed), radius (unzoomed px), magnification
  loupe2: vec4f,   // opacity, has loupe
  cam: vec4f,      // rect (output px)
  cam1: vec4f,     // radius, shadow, opacity, mirror
  cam2: vec4f,     // crop (normalized)
  cam3: vec4f,     // remove background, has lut, lut size
  cam4: vec4f,     // camera source w, h
  lutMin: vec4f,
  lutMax: vec4f,
  fin: vec4f,      // has overlay
  vp: vec4f,       // viewport (output px): the zoom view shows through it, everything outside is unzoomed
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

// Everything under the zoom view except the cursor, at unzoomed point u. rgb + dither mark.
fn zoomed(u: vec2f, aa: f32) -> vec4f {
  var c = background(u);
  if (F.scr2.y < 0.5) { return vec4f(c, 1.0); }
  if (F.scr2.w > 0.0) { c *= 1.0 - shadowAlpha(u); }
  let n = i32(F.dev.x);
  let over = i32(F.dev.y);
  for (var i = 0; i < over; i++) { c = part(c, u, i, aa); }
  var mark = 1.0;
  let r = F.scr;
  let half = r.zw * 0.5;
  let cv = cover(sdBox(u - r.xy - half, half + F.dev.w, vec4f(F.scr2.x)), aa);
  if (cv > 0.0) {
    let uv = (u - r.xy) / r.zw; // outside 0..1 in the inset: the sampler clamps to the edge color
    let m = F.scr3.x / r.z * aa;
    let s = masked(screenSample(uv, m), uv, m);
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

fn cursorAt(u: vec2f, s: vec4f, vs: f32) -> vec4f {
  let d = u - s.xy;
  let ca = cos(s.w);
  let sa = sin(s.w);
  let q = vec2f(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / s.z + F.curImg.zw;
  let uv = q / F.curImg.xy;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  let lod = log2(max(F.curTex.x / (s.z * vs), 1e-4));
  return textureSampleLevel(cursorTex, samp, uv, max(lod - 0.5, 0.0)); // slight sharpening bias: the art is 8x supersampled
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

// ---- Glass loupe: the zoomed layer magnified in place, masks and highlight included ----

fn loupeBox() -> vec4f {
  let c = toOut(F.loupe.xy, F.viewT.xyz);
  let r = (F.loupe.z + 60.0 * F.a.z) * F.viewT.z;
  return vec4f(c - r, c + r);
}

@vertex fn vs_loupe(@builtin(vertex_index) i: u32) -> VO { return box(i, loupeBox()); }

@fragment fn fs_loupe(v: VO) -> @location(0) vec4f {
  let vt = F.viewT.xyz;
  let u = unview(v.pos.xy, vt);
  let aa = 1.0 / vt.z;
  let unit = F.a.z;
  let c = F.loupe.xy;
  let R = F.loupe.z;
  let mag = F.loupe.w;
  let op = F.loupe2.x;
  let d = length(u - c);
  let shadow = boxShadow(u - c - vec2f(0.0, 8.0 * unit), vec2f(R), 16.0 * unit, R) * 0.45 * op;
  let cv = cover(d - R, aa);
  if (cv <= 0.0) { return vec4f(0.0, 0.0, 0.0, shadow); }
  let rho = min(d / R, 1.0);
  let um = c + (u - c) / mag * (1.0 + 0.16 * pow(rho, 4.0)); // a touch of barrel near the rim
  var col = zoomed(um, aa / mag).rgb;
  if (F.cur.w > 0.5) {
    let k = cursorAt(um, curAt(0.5), vt.z * mag) * F.cur.y;
    col = k.rgb + col * (1.0 - k.a);
  }
  col *= 1.0 - dimAt(um, aa / mag);
  col *= 1.0 - 0.16 * smoothstep(0.72, 1.0, rho); // glass edge falloff
  let dir = (u - c) / max(d, 1e-4);
  let sheen = smoothstep(0.25, 1.0, dot(dir, vec2f(-0.7071, -0.7071))) * smoothstep(0.6, 0.97, rho) * 0.22;
  col = mix(col, vec3f(1.0), sheen);
  let ring = cover(abs(d - R + 1.25 * unit) - 1.25 * unit, aa);
  col = mix(col, vec3f(1.0), ring * 0.9);
  let a = cv * op;
  return vec4f(col * a, a) + vec4f(0.0, 0.0, 0.0, shadow) * (1.0 - a);
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
