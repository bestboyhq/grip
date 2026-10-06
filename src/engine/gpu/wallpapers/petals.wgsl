// Petals: soft inflated petal, leaf and blob shapes over a gradient ground, translucent where they
// overlap, each casting a soft drop shadow on what lies beneath. A record is one shape, or a ring of
// them around a point (a flower). The composition is authored on a 16:10 box with its
// anchors stretched to the frame, so corner framing survives every aspect ratio.
// P.pts[0] = record count, ground angle (rad), light x, light y (screen, y down)
// P.pts[1] = shadow, sheen, opacity, shadow hue (OKLab rad)
// P.pts[2] = shadow offset, shadow softness, ground glow x, ground glow y
// P.pts[3..] = 6 floats per record (at most 6): base x, y, angle (rad), length, width,
//              colors a * 16 + b + 256 * ring count (0 or 1: a single shape)
// P.cols[0], P.cols[1] = ground from, to; P.cols[2] = ground glow; records name their colors.

// Color helpers duplicated from dunes.wgsl: each style file compiles on its own.
fn petals_hash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// Blend two OKLab colors through OKLCh, the short way round the hue circle: gradients between distant
// hues pass through vivid in-between hues instead of grey (blue to yellow goes by teal and green).
fn petals_mix(a: vec3f, b: vec3f, t: f32) -> vec3f {
  let ca = length(a.yz);
  let cb = length(b.yz);
  let ha = atan2(a.z, a.y);
  var hb = atan2(b.z, b.y);
  let dh = hb - ha;
  let dw = dh - 6.2831853 * round(dh / 6.2831853);
  // A near-grey end has no meaningful hue: keep the other end's.
  let h = select(select(ha + dw * t, hb, ca < 0.02), ha, cb < 0.02);
  let c = mix(ca, cb, t);
  return vec3f(mix(a.x, b.x, t), c * cos(h), c * sin(h));
}

// Turns a hue toward the shadow hue by up to amt rad: shadows lean toward red in warm scenes
// and toward blue in green ones instead of sinking to olive and brown. The sine weight is continuous
// on the whole hue circle, so a gradient through the opposite hue never shows a seam.
fn petals_turn(ab: vec2f, hue: f32, amt: f32) -> vec2f {
  let a = amt * sin(hue - atan2(ab.y, ab.x));
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * ab.x - s * ab.y, s * ab.x + c * ab.y);
}
// Dark colors cannot hold much chroma: cap it by lightness so deep shadows stay in gamut instead of
// clipping to a stray blue or violet.
fn petals_gamut(lab: vec3f) -> vec3f {
  let c = length(lab.yz);
  return vec3f(lab.x, lab.yz * min(1.0, (0.02 + 0.45 * lab.x) / max(c, 1e-5)));
}


fn petals_p(k: i32) -> f32 {
  return P.pts[k / 4][k % 4];
}

// Half width at t (0 base .. 1 tip). Petals (w > 0): round ends, fuller past the middle. Leaves
// (w < 0): a pointed tip and the belly nearer the base.
fn petals_w(t: f32, w: f32) -> f32 {
  let c = clamp(t, 0.0, 1.0);
  let sn = max(sin(3.1415927 * c), 0.0);
  if (w < 0.0) { return -w * pow(sn, 0.85) * (1.1 - 0.35 * c); }
  return w * sqrt(sn) * (0.6 + 0.5 * c);
}

// Signed inside distance (positive inside), the across coordinate -1..1 and t along the axis.
fn petals_shape(p: vec2f, base: vec2f, ang: f32, len: f32, w: f32) -> vec3f {
  let d = p - base;
  let ax = vec2f(cos(ang), sin(ang));
  let u = dot(d, ax);
  let v = ax.x * d.y - ax.y * d.x;
  let t = u / len;
  let hw = petals_w(t, w);
  let dw = (petals_w(t + 0.01, w) - petals_w(t - 0.01, w)) / (0.02 * len);
  // The width slope is unbounded at the round ends; capping it keeps the distance estimate sane there.
  var inside = (hw - abs(v)) * inverseSqrt(1.0 + min(dw * dw, 9.0));
  // Outside, the slope-corrected estimate collapses near the round ends and would smear shadows
  // along the axis: take the nearest of the straight-across gap and the two end points instead.
  if (inside < 0.0 || t < 0.0 || t > 1.0) {
    let across = select(abs(v) - hw, 1e9, t < 0.0 || t > 1.0);
    inside = -min(across, min(length(d), length(p - (base + ax * len))));
  }
  return vec3f(inside, v / max(hw, 1e-4), t);
}

fn wp_petals(uv: vec2f, wh: vec2f) -> vec3f {
  let s = inverseSqrt(wh.x * wh.y);
  let q = (uv - 0.5) * wh * s;
  let px = s;
  // Anchors are authored on a 16:10 box (half extents 0.63, 0.395) and stretched to the frame, so a
  // form framing a corner keeps framing it at 9:16 or 1:1; the forms themselves keep their shape.
  let fit = 0.5 * wh * s / vec2f(0.63, 0.395);
  let n = i32(P.pts[0].x);
  let ga = P.pts[0].y;
  let L = normalize(vec3f(P.pts[0].z, P.pts[0].w, 0.9));
  let Hh = normalize(L + vec3f(0.0, 0.0, 1.0));
  let shadowK = P.pts[1].x;
  let sheenK = P.pts[1].y;
  let opacity = P.pts[1].z;
  let turn = P.pts[1].w;
  let tint = 0.06 * vec2f(cos(turn), sin(turn));
  let off = -L.xy * P.pts[2].x;
  let soft = P.pts[2].y;

  let gt = clamp(dot(q, vec2f(sin(ga), -cos(ga))) * 1.1 + 0.5, 0.0, 1.0);
  var acc = petals_mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 1.0, gt));
  let gd = q - P.pts[2].zw * fit;
  acc = mix(acc, P.cols[2].xyz, 0.7 * exp(-dot(gd, gd) / 0.08));

  for (var r = 0; r < n; r++) {
    let b = 12 + r * 6;
    let base0 = vec2f(petals_p(b), petals_p(b + 1)) * fit;
    let ang0 = petals_p(b + 2);
    let len = petals_p(b + 3);
    let w = petals_p(b + 4);
    let pack = petals_p(b + 5);
    let ring = max(i32(floor(pack / 256.0)), 1);
    let cp = pack - 256.0 * floor(pack / 256.0);
    let ia = i32(floor(cp / 16.0));
    let ib = i32(cp) - ia * 16;
    for (var j = 0; j < ring; j++) {
      let ang = ang0 + 6.2831853 * f32(j) / f32(ring);
      // Ring petals start a little off the center so they do not all pinch into one point.
      let base = base0 + select(vec2f(0.0), vec2f(cos(ang), sin(ang)) * 0.06 * len, ring > 1);
      // Drop shadow first, so it falls on everything already drawn.
      let sd = petals_shape(q - off, base, ang, len, w).x;
      let sh = shadowK * smoothstep(-soft, soft * 0.5, sd);
      acc = vec3f(acc.x * (1.0 - 0.4 * sh), petals_turn(acc.yz * (1.0 + 0.3 * sh), turn, sh) + tint * sh);

      let f = petals_shape(q, base, ang, len, w);
      let cover = smoothstep(-px, px, f.x);
      if (cover <= 0.0) { continue; }
      // Cupped petal: the blade dishes toward its midline, curls up toward the tip and rolls over
      // softly at the rim. Every term is smooth, so no crease or facet shows.
      let ax = vec2f(cos(ang), sin(ang));
      let across = vec2f(-ax.y, ax.x);
      let x = clamp(f.y, -1.0, 1.0);
      let t = clamp(f.z, 0.0, 1.0);
      let hw = max(petals_w(t, w), 1e-4);
      let rim = 1.0 - smoothstep(0.0, 0.45 * abs(w), f.x);
      let tipward = smoothstep(0.7, 1.0, t) - (1.0 - smoothstep(0.0, 0.15, t));
      let outward = normalize(across * x + ax * tipward + vec2f(1e-4, 0.0));
      let nrm = normalize(vec3f(across * (-0.45 * x) + ax * (0.35 * (t - 0.4)) + outward * 0.9 * rim * rim, 1.0));
      var col = petals_mix(P.cols[ia].xyz, P.cols[ib].xyz, smoothstep(0.05, 1.0, t));
      let diff = dot(nrm, L) * 0.5 + 0.5;
      let dark = max(0.75 - diff, 0.0);
      col = vec3f(col.x * mix(0.76, 1.08, diff), petals_turn(col.yz, turn, 1.2 * dark) + tint * dark);
      // Fine veins fanning from the base, faded where they would come closer than a few pixels.
      let veinFade = smoothstep(6.0 * px, 12.0 * px, 2.0 * hw / 14.0) * smoothstep(0.3, 0.6, t) * (1.0 - rim);
      col.x -= 0.006 * veinFade * (0.5 + 0.5 * cos(x * 3.1415927 * 14.0));
      // Light passing through the thin rim: brighter and richer toward the edge.
      col = vec3f(col.x + 0.07 * rim, col.yz * (1.0 + 0.25 * rim));
      let sp = sheenK * pow(max(dot(nrm, Hh), 0.0), 6.0);
      col = mix(col, vec3f(min(col.x + 0.18, 1.0), col.yz * 0.85), clamp(0.7 * sp, 0.0, 1.0));
      // Translucent body, a little more see-through at the thin rim.
      let a = opacity * (1.0 - 0.2 * rim);
      acc = mix(acc, col, clamp(a, 0.0, 1.0) * cover);
    }
  }
  return oklabToSrgb(petals_gamut(acc));
}
