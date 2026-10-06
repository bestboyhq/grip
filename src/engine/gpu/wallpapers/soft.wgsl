// Soft: calm, premium color fields, the default collection. One shape language per mode:
// 0 mesh, 1 orbs, 2 conic, 3 horizon, 4 spotlight, 5 clouds, 6 reeded glass.
// Coordinates are centered and in mean-side units (wh / sqrt(w * h)): positions given
// frame-relative (0..1) keep their place in the frame, sizes keep their shape at every aspect.
// Colors mix in OKLab (no muddy midtones); light adds and multiplies in linear sRGB.
// P.pts[0].x = mode; every other param is per mode, documented on its function.

fn soft_lin(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  return max(vec3f(
    4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_,
    -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_,
    -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_,
  ), vec3f(0.0));
}

fn soft_col(i: i32) -> vec3f {
  return P.cols[clamp(i, 0, 11)].xyz;
}

fn soft_at(xy: vec2f, unit: vec2f) -> vec2f {
  return (xy - 0.5) * unit;
}

fn soft_hash(p: vec2i) -> vec2f {
  var h = vec2u(p) * vec2u(1597334673u, 3812015801u);
  h = vec2u(h.x ^ h.y) * vec2u(1597334673u, 3812015801u) + vec2u(h.y >> 16u, h.x >> 16u);
  return vec2f(h >> vec2u(8u)) / 8388608.0 - 1.0;
}

// Gradient noise, about -1..1, quintic so its derivative is smooth too (lighting stays clean).
fn soft_noise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(soft_hash(i), f);
  let b = dot(soft_hash(i + vec2i(1, 0)), f - vec2f(1.0, 0.0));
  let c = dot(soft_hash(i + vec2i(0, 1)), f - vec2f(0.0, 1.0));
  let d = dot(soft_hash(i + vec2i(1, 1)), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}

fn soft_fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * soft_noise(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}

// Two-step flow warp: broad, slow bends that read as folds of a color field, never as noise.
fn soft_flow(p: vec2f, amp: f32, seed: f32, scale: f32) -> vec2f {
  if (amp == 0.0) { return p; }
  let s = p * scale + seed;
  let w1 = vec2f(soft_fbm(s, 3), soft_fbm(s + vec2f(5.2, 1.3), 3));
  let w2 = vec2f(soft_fbm(s + 1.6 * w1 + vec2f(1.7, 9.2), 3), soft_fbm(s + 1.6 * w1 + vec2f(8.3, 2.8), 3));
  return p + amp * w2;
}

// Softmax blend of color points P.pts[first + i] = x, y (frame-relative), radius (mean units),
// weight, with color i. Higher sharpness turns the blur into soft-edged color regions.
fn soft_blend(q: vec2f, unit: vec2f, first: i32, n: i32, sharp: f32) -> vec3f {
  var mx = -1e30;
  var acc = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0; i < n; i++) {
    let pt = P.pts[first + i];
    let d = q - soft_at(pt.xy, unit);
    let e = log(max(pt.w, 1e-3)) - sharp * dot(d, d) / (pt.z * pt.z);
    if (e > mx) {
      let s = exp(mx - e);
      acc *= s;
      sum *= s;
      mx = e;
    }
    let w = exp(e - mx);
    acc += soft_col(i) * w;
    sum += w;
  }
  return acc / sum;
}

// Smooth ramp through palette colors first..first+n-1 at x in 0..n-1: gaussian weights, so the
// ramp has no kinks at the stops (kinks read as Mach bands).
fn soft_ramp(x: f32, first: i32, n: i32) -> vec3f {
  var acc = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0; i < n; i++) {
    let d = x - f32(i);
    let w = exp(-d * d * 1.6);
    acc += soft_col(first + i) * w;
    sum += w;
  }
  return acc / sum;
}

fn soft_screen(a: vec3f, b: vec3f) -> vec3f {
  return 1.0 - (1.0 - a) * (1.0 - clamp(b, vec3f(0.0), vec3f(1.0)));
}

// Mode 0, mesh: a gradient-mapped flow field. A smooth scalar field (linear along an angle,
// radial around a focus, or a mix) is bent by broad sinusoids and mapped through the palette as a
// ramp, so colors sweep in long bands. Where bands crowd together the field is lit as a soft fold.
// pts[0] = mode, bend, seed, bend scale; pts[1] = focus x, y (frame-relative), radial share, angle (rad, y down);
// pts[2] = relief, light angle (rad, y down), bloom at the focus, bloom radius (mean units);
// pts[3] = ramp scale (field units per full ramp), ramp offset, unused, unused. cols = ramp stops, light to deep.
fn soft_bend(p: vec2f, amp: f32, seed: f32, scale: f32) -> vec2f {
  var q = p;
  q += amp * vec2f(sin(q.y * 3.1 * scale + seed), sin(q.x * 2.6 * scale + seed * 1.7));
  q += amp * 0.45 * vec2f(sin(q.y * 5.3 * scale + seed * 2.3), sin(q.x * 4.7 * scale + seed * 0.7));
  return q;
}

fn soft_mesh_t(p: vec2f, unit: vec2f) -> f32 {
  let g = P.pts[0];
  let f = P.pts[1];
  let r = P.pts[3];
  let d = soft_bend(p, g.y, g.z, g.w) - soft_at(f.xy, unit);
  let lin = dot(d, vec2f(cos(f.w), sin(f.w)));
  // Unclamped: the ramp saturates smoothly past its ends, so there is no plateau edge.
  return mix(lin, length(d), f.z) / r.x + r.y;
}

fn soft_mesh(p: vec2f, unit: vec2f) -> vec3f {
  let n = max(i32(P.a.y), 2);
  let l = P.pts[2];
  // The field blurred over a small disc (golden-angle taps), its slope fitted from the same taps
  // by least squares. Where a bend folds the plane it pinches into a cusp; the blur rounds that
  // point off instead of leaving a dot or ghost copies.
  var t = 0.0;
  var g = vec2f(0.0);
  var gg = vec2f(0.0);
  var so = vec2f(0.0);
  for (var i = 0; i < 12; i++) {
    let fi = f32(i);
    let o = 0.045 * sqrt((fi + 0.5) / 12.0) * vec2f(cos(fi * 2.3999632), sin(fi * 2.3999632));
    let ti = soft_mesh_t(p + o, unit);
    t += ti;
    g += ti * o;
    gg += o * o;
    so += o;
  }
  t /= 12.0;
  let slope = (g - t * so) / gg;
  // Relief: the band edge facing the light catches it and washes toward white; the far one falls
  // into shade, taking its hue from deeper along the ramp (ramps run light to deep), so a shaded
  // peach turns rose instead of tan. tanh keeps the cusp where a fold begins from spiking.
  let shade = 0.3 * tanh(l.x * dot(slope, vec2f(cos(l.y), sin(l.y))) * 0.05 / 0.3);
  var lab = soft_ramp(t * f32(n - 1), 0, n);
  if (shade < 0.0) {
    let deep = soft_ramp((t + 0.3) * f32(n - 1), 0, n);
    lab = vec3f(lab.x, mix(lab.yz, deep.yz * 1.15, min(-shade * 3.0, 0.8)));
  }
  lab = vec3f(clamp(lab.x * (1.0 + shade), 0.0, 1.0), lab.yz * (1.0 - 0.25 * max(shade, 0.0)));
  let d = p - soft_at(P.pts[1].xy, unit);
  let bloom = l.z * exp(-dot(d, d) / max(l.w * l.w, 1e-4));
  return soft_screen(soft_lin(lab), soft_lin(vec3f(min(lab.x + 0.3, 1.0), lab.yz * 0.6)) * bloom);
}

// Mode 1, orbs: big soft spheres, back to front, lit like a translucent material: wrapped diffuse
// light, a subsurface glow that fills the shaded side and the rim with richer color instead of
// black, a broad low sheen, and a soft shadow on what lies behind. Blur sets the depth of field.
// pts[0] = mode, ground angle (rad, 0 points up), light angle (rad, y down, where light comes from), shadow;
// pts[1] = sheen, glass (see-through core 0..1), rim, ambient;
// pts[2] = subsurface glow, light wrap (0..1), sheen sharpness (exponent), ground glow under the orbs;
// pts[3 + k] = orb x, y (frame-relative), radius (mean units), blur (fraction of radius); radius 0 ends (max 9).
// cols[0] -> cols[1] = ground; cols[2 + k] = orb k.
fn soft_orbs(p: vec2f, unit: vec2f) -> vec3f {
  let g = P.pts[0];
  let s = P.pts[1];
  let m = P.pts[2];
  let gd = vec2f(sin(g.y), -cos(g.y));
  let t = clamp(dot(p, gd) / (abs(unit.x * gd.x) + abs(unit.y * gd.y)) + 0.5, 0.0, 1.0);
  var col = soft_lin(mix(soft_col(0), soft_col(1), t));
  let toward = vec2f(cos(g.z), sin(g.z));
  let L = normalize(vec3f(toward, 0.9));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  for (var k = 0; k < 9; k++) {
    let o = P.pts[3 + k];
    if (o.z <= 0.0) { break; }
    let c = soft_at(o.xy, unit);
    let blur = max(o.w, 0.01);
    let lab = soft_col(2 + k);
    // Ground glow: light scattered through the orb tints the ground around it.
    let gr = length(p - c) / o.z;
    col = soft_screen(col, soft_lin(lab) * m.w * exp(-gr * gr * 0.6));
    // Shadow, pushed away from the light and spread wider than the orb.
    let sd = length(p - c + toward * o.z * 0.22) / o.z;
    col *= 1.0 - g.w * (1.0 - smoothstep(0.55, 1.35 + blur, sd));
    let d = (p - c) / o.z;
    let rho = length(d);
    let a = 1.0 - smoothstep(1.0 - blur, 1.0 + blur, rho);
    if (a <= 0.0) { continue; }
    // The sphere spans the whole blurred edge, so shading never kinks inside the soft rim.
    let dn = d / (1.0 + blur);
    let nxy = dn / max(length(dn), 1.0);
    let n = vec3f(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
    let base = soft_lin(lab);
    let diff = max((dot(n, L) + m.y) / (1.0 + m.y), 0.0);
    let spec = pow(max(dot(n, H), 0.0), max(m.z, 1.0));
    let fres = pow(1.0 - n.z, 3.0);
    var lit = base * (s.w + (1.0 - s.w) * diff * 1.25) + s.x * spec * mix(base, vec3f(1.0), 0.5);
    // A defocused orb has no crisp rim: the fresnel ring fades out with blur.
    lit = mix(lit, soft_lin(lab + vec3f(0.18, 0.0, 0.0)), s.z * fres * (1.0 - smoothstep(0.05, 0.3, blur)));
    // Subsurface: away from the light and toward the rim, the body glows in a lighter, more
    // saturated version of its own color.
    let glow = soft_lin(vec3f(min(lab.x + 0.12, 1.0), lab.yz * 1.25));
    lit += glow * m.x * (1.0 - diff) * (0.35 + 0.65 * pow(1.0 - n.z, 1.5));
    let alpha = a * (1.0 - s.y * n.z * 0.7);
    col = mix(col, lit, alpha);
  }
  return col;
}

// Mode 2, conic: a duotone sweep around a pivot that may sit outside the frame, mirrored about its
// axis so there is no seam, with optional paper-fan pleats and a spiral twist.
// pts[0] = mode, pivot x, y (frame-relative), axis angle (rad, y down);
// pts[1] = span (rad from the axis to the last stop), pleats per turn, pleat depth, twist (rad per mean unit);
// pts[2] = falloff with distance, pivot glow, glow radius (mean units), unused. cols = stops.
fn soft_conic(p: vec2f, unit: vec2f) -> vec3f {
  let a = P.pts[0];
  let b = P.pts[1];
  let c = P.pts[2];
  let n = max(i32(P.a.y), 2);
  let d = p - soft_at(a.yz, unit);
  let r = length(d);
  let raw = atan2(d.y, d.x) - a.w + b.w * r;
  let th = atan2(sin(raw), cos(raw));
  let t = clamp(abs(th) / b.x, 0.0, 1.0);
  var lab = soft_ramp(t * f32(n - 1), 0, n);
  // Pleats: a triangle wave across the angle reads as flat facets with creases; it fades out
  // near the pivot, where the facets converge below a pixel.
  let f = abs(fract(raw * b.y / 6.2831853) - 0.5) * 2.0;
  let pleat = b.z * (f - 0.5) * smoothstep(0.02, 0.3, r);
  lab.x = clamp(lab.x * (1.0 + pleat) * mix(1.0, exp(-r * 0.8), c.x), 0.0, 1.0);
  let glow = c.y * exp(-r * r / max(c.z * c.z, 1e-4));
  // The glow keeps the local hue at full chroma: a gray or off-hue glow muddies deep stops.
  return soft_screen(soft_lin(lab), soft_lin(vec3f(min(lab.x + 0.3, 1.0), lab.yz)) * glow);
}

// Mode 3, horizon: a planet limb or a flat horizon with an atmospheric glow hugging it and an
// optional sun sitting on it.
// pts[0] = mode, horizon y (frame-relative, top of the arc), radius (mean units, large is flat), glow height;
// pts[1] = glow strength, sun x (frame-relative), sun radius (mean units, 0 none), rim light;
// pts[2] = glow spread along the horizon (mean units), ground haze, edge softness (mean units), arc center x (frame-relative);
// pts[3] = sun reflection on the ground, unused, unused, unused.
// cols: 0 sky top, 1 sky at the horizon, 2 glow core, 3 glow outer, 4 ground at the limb, 5 ground deep.
fn soft_horizon(p: vec2f, unit: vec2f, px: f32) -> vec3f {
  let h = P.pts[0];
  let k = P.pts[1];
  let m = P.pts[2];
  let hy = (h.y - 0.5) * unit.y;
  let cx = soft_at(vec2f(m.w, 0.5), unit).x;
  let ctr = vec2f(cx, hy + h.z);
  let dist = length(p - ctr) - h.z;
  let sunx = (k.y - 0.5) * unit.x;
  let along = exp(-pow((p.x - sunx) / max(m.x, 0.05), 2.0));
  // Sky: top color to horizon color, the horizon side widening near the glow.
  let top = -0.5 * unit.y;
  let st = clamp((p.y - top) / max(hy - top, 1e-3), 0.0, 1.0);
  var sky = soft_lin(mix(soft_col(0), soft_col(1), pow(st, 1.6)));
  let up = max(dist, 0.0);
  let glowCol = soft_lin(mix(soft_col(2), soft_col(3), 1.0 - exp(-up / max(h.w * 1.5, 1e-3))));
  let glow = k.x * (0.35 + 0.65 * along) * (exp(-up / max(h.w, 1e-3)) * 0.7 + exp(-up / max(h.w * 4.0, 1e-3)) * 0.3);
  sky = soft_screen(sky, glowCol * glow);
  // Sun on the horizon, partly behind the limb.
  if (k.z > 0.0) {
    let sy = ctr.y - sqrt(max(h.z * h.z - (sunx - cx) * (sunx - cx), 0.0));
    let sdist = length(p - vec2f(sunx, sy));
    let soft = max(px * 1.5, m.z);
    let disc = 1.0 - smoothstep(k.z - soft, k.z + soft, sdist);
    // Two-scale flare: a tight core glow and a wide one, so even a tiny sun reads as light.
    let halo = 0.6 * exp(-sdist / (k.z * 2.5)) + 0.35 * exp(-sdist / max(k.z * 6.0, 0.08));
    sky = soft_screen(sky, soft_lin(soft_col(2)) * (halo + disc * 0.55));
  }
  // Ground: limb color to deep, a rim of light just inside the edge, haze near the horizon.
  let down = max(-dist, 0.0);
  var ground = soft_lin(mix(soft_col(4), soft_col(5), smoothstep(0.0, 0.5, down)));
  ground = soft_screen(ground, soft_lin(soft_col(2)) * k.w * along * exp(-down / max(h.w * 0.25, 1e-3)));
  ground = mix(ground, glowCol, m.y * exp(-down / max(h.w * 0.6, 1e-3)));
  // Reflection: a soft column of sunlight on a glossy ground, narrowing toward the viewer.
  let rx = (p.x - sunx) / (max(k.z, 0.02) * (1.2 + down * 3.0));
  ground = soft_screen(ground, soft_lin(soft_col(2)) * P.pts[3].x * exp(-rx * rx) * exp(-down * 2.5));
  let edge = max(px, m.z);
  return mix(ground, sky, smoothstep(-edge, edge, dist));
}

// Mode 4, spotlight: a lit studio sweep. The backdrop is a cyclorama, a wall that curves through a
// cove into the floor, lit by a key light from above: a wash on the wall, a pool on the floor, a
// soft highlight along the cove where the curve turns toward the light, and warm bounce from the
// pool onto the lower wall. Light is one illumination value mapped through the palette in OKLab
// (deep, lit, light), so shade stays cool and saturated and the key warms, instead of graying out
// the way an added light color would.
// pts[0] = mode, source x, y (frame-relative, y < 0 above the frame), spread (half-angle, rad);
// pts[1] = beam strength, floor y (frame-relative, the cove's center), pool strength, vignette;
// pts[2] = tilt (rad from straight down, positive leans right), haze, shafts (0: one smooth beam), seed;
// pts[3] = cove width (mean units), cove highlight, floor bounce, wall wash.
// cols: 0 wall deep, 1 lit, 2 light, 3 floor deep.
fn soft_spot(p: vec2f, unit: vec2f) -> vec3f {
  let a = P.pts[0];
  let b = P.pts[1];
  let c = P.pts[2];
  let k = P.pts[3];
  let src = soft_at(a.yz, unit);
  let dir = vec2f(sin(c.x), cos(c.x));
  let v = p - src;
  let dist = length(v);
  let ang = acos(clamp(dot(v / max(dist, 1e-5), dir), -1.0, 1.0));
  let cone = 1.0 - smoothstep(a.w * 0.45, a.w * 1.35, ang);
  var beam = b.x * cone * (0.6 + 0.4 * exp(-ang * ang / (a.w * a.w * 0.08))) * exp(-dist * 0.7);
  // Shafts: light broken by a canopy into irregular rays.
  if (c.z > 0.0) {
    let side = dot(v, vec2f(dir.y, -dir.x)) / max(dist, 1e-5);
    let ray = soft_noise(vec2f(side * c.z, c.w)) * 0.5 + 0.5;
    beam *= 0.15 + 1.6 * smoothstep(0.35, 0.9, ray);
  }
  // Cyclorama: 0 on the wall, 1 on the floor, a smooth cove between.
  let fy = soft_at(vec2f(0.5, b.y), unit).y;
  let cw = max(k.x, 0.02);
  let floorT = smoothstep(fy - cw, fy + cw * 0.6, p.y);
  // Pool: where the cone axis meets the floor, foreshortened.
  let reach = (fy - src.y) / max(dir.y, 0.1);
  let pc = src + dir * reach;
  let w = max(tan(a.w) * reach, 0.05);
  let e = (p - pc) / vec2f(w * 1.3, w * 0.36);
  let pool = b.z * exp(-dot(e, e)) * floorT;
  let across = exp(-pow((p.x - pc.x) / (w * 1.8), 2.0));
  let wide = exp(-pow((p.x - pc.x) / (w * 3.5), 2.0));
  // Wall wash: brighter toward the light and the cove, falling off up the wall. The floor faces
  // up into the key, so it holds more light than the wall across its whole width.
  let wash = k.w * across * exp(-max(fy - p.y, 0.0) * 1.6) * (1.0 - floorT) + k.w * wide * floorT;
  // Cove highlight: the curve turns toward the light in a band just above the floor.
  let coveY = (p.y - (fy - cw * 0.25)) / (cw * 0.5);
  let cove = k.y * wide * exp(-coveY * coveY);
  let bounce = k.z * across * exp(-max(fy - p.y, 0.0) / (cw * 1.5)) * (1.0 - floorT * 0.7);
  // The floor falls off gently toward the viewer; haze fills the room around the source.
  let near = 1.0 - 0.2 * smoothstep(fy + cw, 0.5 * unit.y, p.y) * floorT;
  let lum = (wash + cove + bounce + pool + beam + c.y * exp(-dist * 1.5)) * near;
  let deep = mix(soft_col(0), soft_col(3), floorT);
  var lab = mix(deep, soft_col(1), smoothstep(0.0, 0.9, lum));
  lab = mix(lab, soft_col(2), smoothstep(0.7, 1.8, lum));
  // Vignette weighted to the top and sides: the lit floor stays open toward the viewer, which is
  // what reads as a sweep rather than a band of light.
  let vq = p / unit;
  lab.x *= 1.0 - b.w * smoothstep(0.25, 0.8, length(vq * vec2f(1.0, 1.2) * vec2f(1.0, select(0.55, 1.0, vq.y < 0.0))));
  return soft_lin(lab);
}

// Mode 5, clouds: a pastel field of soft clouds lit from one side, clearing toward the center so
// the recording sits on open sky.
// pts[0] = mode, seed, coverage (0 clear..1 overcast), scale (features per mean unit);
// pts[1] = light angle (rad, y down, where light comes from), edge softness, center clearing, sun glow;
// pts[2] = sun x, y (frame-relative), stretch (horizontal elongation), warp;
// pts[3] = vertical bias (positive banks clouds low), horizon y (frame-relative; > 0 turns the field
//   into a sea of clouds seen from above, receding to that horizon), unused, unused.
// cols: 0 sky top, 1 sky bottom, 2 cloud lit, 3 cloud shade, 4 sun tint.
fn soft_cloud_d(q: vec2f, seed: f32, warp: f32) -> f32 {
  let w = vec2f(soft_fbm(q * 0.7 + seed + 4.1, 3), soft_fbm(q * 0.7 + seed + 7.7, 3));
  return soft_fbm(q + warp * w + seed, 5);
}

fn soft_clouds(p: vec2f, unit: vec2f) -> vec3f {
  let a = P.pts[0];
  let b = P.pts[1];
  let c = P.pts[2];
  var q = p * vec2f(1.0 / max(c.z, 0.2), 1.0) * a.w;
  // Sea of clouds: the field lies on a plane below the eye, so it shrinks toward the horizon and
  // fades into haze there before its detail could alias.
  let hz = P.pts[3].y;
  var far = 0.0;
  if (hz > 0.0) {
    let dy = p.y - soft_at(vec2f(0.5, hz), unit).y;
    q = vec2f(p.x / max(c.z, 0.2), 1.0) * a.w * 0.2 / max(dy, 0.01);
    far = 1.0 - smoothstep(0.0, 0.25, dy);
  }
  // Density in units of its spread (fbm here has a standard deviation near 0.25).
  let dn = soft_cloud_d(q, a.y, c.w) * 4.0;
  let toward = vec2f(cos(b.x), sin(b.x));
  let dl = soft_cloud_d(q + toward * 0.08, a.y, c.w) * 4.0;
  let clear = b.z * exp(-dot(p / unit, p / unit) * 4.0);
  let m = dn + (a.z - 0.5) * 3.0 - clear * 2.5 + P.pts[3].x * (p.y / unit.y) * 4.0;
  let cover = smoothstep(-b.y, b.y, m) * (1.0 - far);
  let sky = soft_lin(mix(soft_col(0), soft_col(1), smoothstep(0.0, 1.0, p.y / unit.y + 0.5)));
  // Lit where density falls toward the light; thick cores sit a little in their own shadow.
  let lit = clamp(0.62 + (dn - dl) * 1.1 - smoothstep(0.0, 2.5, m) * 0.3, 0.0, 1.0);
  let cloud = soft_lin(mix(soft_col(3), soft_col(2), lit));
  var col = mix(sky, cloud, cover);
  let sd = p - soft_at(c.xy, unit);
  let sun = b.w * exp(-dot(sd, sd) * 6.0);
  return soft_screen(col, soft_lin(soft_col(4)) * sun * (1.0 - 0.5 * cover));
}

// Mode 6, reeded glass: a soft color field seen through fluted glass. Each rib shows a scaled
// slice of what lies behind (refraction), with a soft highlight and a faint seam between ribs.
// pts[0] = mode, rib width (mean units), angle (rad, 0 vertical), refraction (scale of the slice; < 0 flips);
// pts[1] = highlight, seam, warp, seed; pts[2] = sharpness, flow scale, unused, unused;
// pts[3 + i] = background point x, y, radius, weight with color i (max 9).
fn soft_glass(p: vec2f, unit: vec2f, px: f32) -> vec3f {
  let a = P.pts[0];
  let b = P.pts[1];
  let n = min(i32(P.a.y), 9);
  let cs = vec2f(cos(a.z), sin(a.z));
  let u = dot(p, cs);
  let v = dot(p, vec2f(-cs.y, cs.x));
  let w = max(a.y, 0.005);
  let f = fract(u / w) - 0.5;
  let us = (floor(u / w) + 0.5 + f * a.w) * w;
  let q = cs * us + vec2f(-cs.y, cs.x) * v;
  let lab = soft_blend(soft_flow(q, b.z, b.w, P.pts[2].y), unit, 3, n, P.pts[2].x);
  // Cylinder across the rib: light from the left side, a soft highlight on its shoulder.
  let nx = f * 2.0;
  let hl = b.x * exp(-pow((f + 0.22) / 0.13, 2.0));
  let seamW = max(0.06, 1.2 * px / w);
  let seam = b.y * exp(-pow((0.5 - abs(f)) / seamW, 2.0));
  var col = soft_lin(vec3f(lab.x * (1.0 - 0.05 * nx), lab.yz));
  // The highlight is the local color lifted, not white: white on deep colors reads as gray.
  col = soft_screen(col, soft_lin(vec3f(min(lab.x + 0.3, 1.0), lab.yz)) * hl);
  return col * (1.0 - seam);
}

fn wp_soft(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let px = 1.0 / sqrt(wh.x * wh.y);
  let p = (uv - 0.5) * unit;
  let mode = i32(P.pts[0].x + 0.5);
  var c: vec3f;
  switch mode {
    case 1: { c = soft_orbs(p, unit); }
    case 2: { c = soft_conic(p, unit); }
    case 3: { c = soft_horizon(p, unit, px); }
    case 4: { c = soft_spot(p, unit); }
    case 5: { c = soft_clouds(p, unit); }
    case 6: { c = soft_glass(p, unit, px); }
    default: { c = soft_mesh(p, unit); }
  }
  return encodeSrgb(clamp(c, vec3f(0.0), vec3f(1.0)));
}
