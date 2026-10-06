// Relief: a lit height field seen from above or, tilted, at a grazing angle toward a horizon.
// Modes: 0 wind-cut ridges (sharp crests, broad troughs; aerial dune fields, or sand ripples up close),
// 1 water rings (interfering ripples from a few centers, glossy), 2 terraces (contour steps on soft hills).
// Shading follows the dunes color model: OKLab ramp through OKLCh, shadows deeper and turned toward the
// shadow hue, long soft shadows marched toward a low sun.
// P.pts[0] = mode, ridge angle (rad), frequency, seed
// P.pts[1] = light azimuth (rad, screen direction the light comes from), elevation (rad), shadow, lean
//            (mode 0) or step count (mode 2)
// P.pts[2] = horizon y (0: top-down; negative: tilted ground below that frame y), detail, warp, gloss
// P.pts[3] = swell, haze, shadow hue (OKLab rad), ramp color count
// P.pts[4..7] = water ring centers: x, y, frequency factor, phase (frequency 0: unused)
// P.cols[0], P.cols[1] = sky top, horizon (tilted mode); P.cols[2..] = ramp from low ground to crests.

// Color helpers duplicated from dunes.wgsl: each style file compiles on its own.
fn relief_hash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// Blend two OKLab colors through OKLCh, the short way round the hue circle: gradients between distant
// hues pass through vivid in-between hues instead of grey (blue to yellow goes by teal and green).
fn relief_mix(a: vec3f, b: vec3f, t: f32) -> vec3f {
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
fn relief_turn(ab: vec2f, hue: f32, amt: f32) -> vec2f {
  let a = amt * sin(hue - atan2(ab.y, ab.x));
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * ab.x - s * ab.y, s * ab.x + c * ab.y);
}
// Dark colors cannot hold much chroma: cap it by lightness so deep shadows stay in gamut instead of
// clipping to a stray blue or violet.
fn relief_gamut(lab: vec3f) -> vec3f {
  let c = length(lab.yz);
  return vec3f(lab.x, lab.yz * min(1.0, (0.02 + 0.45 * lab.x) / max(c, 1e-5)));
}


fn relief_ridge(ph: f32, lean: f32) -> f32 {
  let p = ph + lean * 0.16 * sin(6.2831853 * ph);
  let r = 1.0 - abs(sin(3.1415927 * p));
  return r * r;
}

fn relief_height(g: vec2f) -> f32 {
  let mode = i32(P.pts[0].x);
  let f = P.pts[0].z;
  let seed = P.pts[0].w;
  let lean = P.pts[1].w;
  let detail = P.pts[2].y;
  let warp = P.pts[2].z;
  let swell = P.pts[3].x;
  let r = vec4f(relief_hash(seed), relief_hash(seed + 1.7), relief_hash(seed + 3.1), relief_hash(seed + 4.3)) * 6.2831853;
  // A broad undulation under everything keeps large areas from reading as a flat pattern.
  let big = swell * (sin(g.x * f * 0.23 + r.z + 0.9 * sin(g.y * f * 0.19 + r.w)) + 0.6 * sin(g.y * f * 0.29 + r.x));
  if (mode == 1) {
    var h = 0.0;
    for (var i = 0; i < 4; i++) {
      let c = P.pts[4 + i];
      if (c.z <= 0.0) { continue; }
      let d = length(g - c.xy);
      // Rings fade with distance and soften near their center, like a drop that has spread.
      // A second harmonic sharpens each crest, as on real capillary ripples.
      let ph = d * f * c.z - c.w;
      h += (sin(ph) + 0.3 * sin(2.0 * ph + 0.8)) * smoothstep(0.0, 0.08, d) / (1.0 + 4.0 * d);
    }
    return 0.5 + 0.35 * h + big;
  }
  // Meandering axis: crests wander and pinch instead of running ruler-straight.
  let w = warp * (sin(g.y * f * 0.31 + r.x) + 0.55 * sin(g.y * f * 0.53 + g.x * f * 0.17 + r.y) + 0.3 * sin(g.y * f * 1.1 + g.x * f * 0.4 + r.z));
  if (mode == 2) {
    let hills = 0.5 + 0.22 * (sin(g.x * f + r.x + 0.8 * sin(g.y * f * 0.8 + r.y)) + sin(g.y * f * 1.27 + r.z + 0.7 * sin(g.x * f * 0.9 + w)));
    let k = max(lean, 1.0);
    let x = (hills + big) * k;
    return (floor(x) + smoothstep(0.72, 1.0, fract(x))) / k;
  }
  // Uneven spacing: crests bunch and spread across the field like real dune trains.
  var h = relief_ridge(g.x * f + w + 0.35 * sin(g.x * f * 0.37 + r.w), lean);
  // Fine wind ripples across the slopes, smooth so they read as texture rather than a second grid.
  let g2 = vec2f(0.8 * g.x + 0.6 * g.y, -0.6 * g.x + 0.8 * g.y);
  h += detail * sin(g2.x * f * 5.3 + 1.7 * sin(g2.y * f * 0.9 + r.w));
  return h + big;
}

fn relief_ramp(t: f32) -> vec3f {
  let m = max(i32(P.pts[3].w), 1);
  let x = clamp(t, 0.0, 0.9999) * f32(m - 1);
  let i = min(i32(x), max(m - 2, 0));
  if (m == 1) { return P.cols[2].xyz; }
  return relief_mix(P.cols[2 + i].xyz, P.cols[3 + i].xyz, smoothstep(0.0, 1.0, x - f32(i)));
}

fn wp_relief(uv: vec2f, wh: vec2f) -> vec3f {
  let s = inverseSqrt(wh.x * wh.y);
  let q = (uv - 0.5) * wh * s;
  let mode = i32(P.pts[0].x);
  let f = P.pts[0].z;
  let az = P.pts[1].x;
  let el = P.pts[1].y;
  let shadowK = P.pts[1].z;
  let hy = P.pts[2].x;
  let gloss = P.pts[2].w;
  let haze = P.pts[3].y;
  let turn = P.pts[3].z;
  let tint = 0.06 * vec2f(cos(turn), sin(turn));

  // Ground coordinates; tilted mode projects the frame below the horizon onto a receding plane.
  var g = q;
  var foot = s;
  var z = 0.0;
  var V = vec3f(0.0, 0.0, 1.0);
  if (hy < 0.0) {
    let sky = relief_mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(-0.8, hy, q.y));
    let dy = q.y - hy;
    if (dy <= 0.0) { return oklabToSrgb(sky); }
    z = 0.12 / dy;
    g = vec2f(q.x * z * 2.0, z);
    // Ground units per pixel along the steeper (depth) axis.
    foot = s * max(2.0 * z, z / dy);
    V = normalize(vec3f(0.0, -1.0, 0.55));
  }
  let ca = cos(P.pts[0].y);
  let sa = sin(P.pts[0].y);
  g = vec2f(ca * g.x + sa * g.y, -sa * g.x + ca * g.y);

  // Relief depth in ground units, proportional to the wavelength so slopes stay the same at any scale.
  // Detail finer than a few pixels fades out instead of aliasing toward the horizon.
  let fade = smoothstep(0.2, 0.06, foot * f);
  // Water ripples are shallow in height but read only through their slopes: give them more relief.
  let amp = select(0.22, 0.8, mode == 1) / f * select(1.0, fade, hy < 0.0);
  let e = 0.02 / f;
  let h0 = relief_height(g);
  let hx = relief_height(g + vec2f(e, 0.0));
  let hyy = relief_height(g + vec2f(0.0, e));
  let n = normalize(vec3f(-(hx - h0) * amp / e, -(hyy - h0) * amp / e, 1.0));
  // The light direction is given on screen; rotate it into the ground frame like the coordinates.
  let ls = vec2f(cos(az), sin(az));
  let lg = vec2f(ca * ls.x + sa * ls.y, -sa * ls.x + ca * ls.y);
  let L = normalize(vec3f(lg * cos(el), sin(el)));

  // Long soft shadows: march toward the light and keep the closest miss.
  var lit = 1.0;
  if (shadowK > 0.0) {
    let tanE = tan(el);
    // Evenly spaced steps over about one crest spacing, each a smooth occlusion estimate, combined
    // by a power mean: close to the strongest occluder, yet a sharp crest caught by one step alone
    // cannot draw a line.
    // Steps start at a per-pixel offset (interleaved gradient noise), so step spacing shows as fine
    // grain that the 4 samples per pixel average away, never as lines parallel to the crests.
    let px = uv * wh;
    let jit = fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
    var acc = 0.0;
    for (var k = 1; k <= 24; k++) {
      let t = (f32(k) - jit) * 0.045 / f;
      let hq = relief_height(g + lg * t) * amp;
      let o = 1.0 - smoothstep(-0.2, 0.05, (h0 * amp + t * tanE - hq) / (0.25 * t * tanE + 0.01 / f));
      acc += o * o * o * o;
    }
    lit = 1.0 - sqrt(sqrt(acc / 24.0));
    lit = mix(1.0, lit, shadowK);
  }

  var hn = clamp((h0 - 0.05) / 1.1, 0.0, 1.0);
  // Water takes its color from depth across the frame, not from wave height: the rings then read
  // through light and gloss on one body of water instead of as painted bands.
  if (mode == 1) { hn = clamp(0.5 + 0.7 * dot(q, vec2f(0.6, -0.8)) + 0.15 * (h0 - 0.5), 0.0, 1.0); }
  var col = relief_ramp(hn);
  if (mode == 1) {
    // Glossy water: the surface mirrors a bright sky on slopes turned toward the light and the deep
    // color elsewhere, and the sun leaves a crisp glint along every ring that catches it.
    let R = reflect(vec3f(0.0, 0.0, -1.0), n);
    let env = smoothstep(-0.12, 0.25, dot(R.xy, lg));
    let sky = vec3f(min(col.x + 0.16, 1.0), col.yz * 0.7);
    let deep = vec3f(col.x * 0.86, col.yz * 1.15);
    col = mix(deep, sky, env * 0.75);
    let glint = gloss * pow(max(dot(R, L), 0.0), 600.0);
    col = mix(col, vec3f(min(col.x + 0.3, 1.0), col.yz * 0.3), clamp(glint, 0.0, 1.0));
    return oklabToSrgb(relief_gamut(col));
  }
  let diff = max(dot(n, L), 0.0) * lit;
  let light = 0.3 + 0.7 * diff;
  let dark = max(0.7 - light, 0.0);
  col = vec3f(col.x * mix(0.58, 1.12, light), relief_turn(col.yz, turn, 1.2 * dark) + tint * dark);
  // Satin or wet sheen toward the light, in the surface's own hue lifted to white.
  let Hh = normalize(L + V);
  let sp = gloss * pow(max(dot(n, Hh), 0.0), select(24.0, 90.0, mode == 1)) * lit;
  col = mix(col, vec3f(min(col.x + 0.25, 1.0), col.yz * 0.9), clamp(sp, 0.0, 1.0));
  if (hy < 0.0) {
    let fog = 1.0 - exp(-z * haze);
    col = mix(col, P.cols[1].xyz, fog);
  }
  return oklabToSrgb(relief_gamut(col));
}
