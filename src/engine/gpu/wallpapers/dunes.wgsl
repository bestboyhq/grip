// Dunes: smooth layered surfaces stacked in depth (hills, waves, sand dunes) under a sky gradient.
// The scene lives in a frame scaled by sqrt(w * h) and rotated by `angle`, so every aspect ratio shows
// the same landscape, just wider or taller. Layers composite back to front with analytic edge
// coverage; each is shaded as a rounded 3D sheet whose normal turns from the crest silhouette toward
// the viewer, casts a soft occlusion shadow onto what lies behind, and fades into the sky with depth.
// P.pts[0] = angle (rad), shadow hue (OKLab, rad), layer count, haze
// P.pts[1] = light x (-1 left .. 1 right), sheen, shadow, depth of field
// P.pts[2] = glow x (frame units), glow color index + strength, skew (dune lean), fill depth gradient
// P.pts[3] = mode + mesa (mode 0 bands, 1 curl; fraction flattens crests into mesas), curl center x, y,
//            sun x
// P.pts[4].xy = sun y, sun color index + radius (index 0: no sun)
// P.pts[4].zw.. = 6 floats per layer (at most 5), back to front: y, amplitude, frequency, seed,
//            colors a * 16 + b, lateral gradient. P.cols[0], P.cols[1] = sky top, sky horizon (OKLab).
// Curl mode bends the bands into concentric arcs around a center (off frame, so the angle seam
// stays out of view): sweeping, curling folds instead of a horizon.

fn dunes_p(k: i32) -> f32 {
  return P.pts[k / 4][k % 4];
}

fn dunes_hash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// Crest profile: three incommensurate sines on a slowly warped axis, so nothing repeats on screen.
// Skew bends each crest toward a dune's steep lee side.
fn dunes_crest(x: f32, freq: f32, seed: f32, skew: f32, mesa: f32) -> f32 {
  let r = vec4f(dunes_hash(seed), dunes_hash(seed + 1.31), dunes_hash(seed + 2.77), dunes_hash(seed + 4.19));
  let xw = x * freq + 0.7 * sin(x * freq * 0.41 + r.x * 6.283);
  var t = xw + r.y * 6.283;
  var h = sin(t + skew * sin(t));
  t = xw * (1.63 + 0.5 * r.z) + r.w * 6.283;
  h += 0.38 * sin(t + skew * 0.6 * sin(t));
  t = xw * (2.71 + 0.6 * r.x) + r.z * 6.283;
  h += 0.14 * sin(t);
  h *= 0.66;
  // Mesas: a soft sign squashes the profile into flat tops and steep cliffs.
  if (mesa > 0.0) {
    let k = 1.0 + 14.0 * mesa;
    h = 0.6 * h * k * inverseSqrt(1.0 + h * h * k * k);
  }
  return h;
}

// Blend two OKLab colors through OKLCh, the short way round the hue circle: gradients between distant
// hues pass through vivid in-between hues instead of grey (blue to yellow goes by teal and green).
fn dunes_mix(a: vec3f, b: vec3f, t: f32) -> vec3f {
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
fn dunes_turn(ab: vec2f, hue: f32, amt: f32) -> vec2f {
  let a = amt * sin(hue - atan2(ab.y, ab.x));
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * ab.x - s * ab.y, s * ab.x + c * ab.y);
}
// Dark colors cannot hold much chroma: cap it by lightness so deep shadows stay in gamut instead of
// clipping to a stray blue or violet.
fn dunes_gamut(lab: vec3f) -> vec3f {
  let c = length(lab.yz);
  return vec3f(lab.x, lab.yz * min(1.0, (0.02 + 0.45 * lab.x) / max(c, 1e-5)));
}


fn dunes_sky(y: f32, x: f32, horizon: f32, sun: vec2f, px: f32) -> vec3f {
  let t = smoothstep(-0.75, horizon + 0.05, y);
  let lab = dunes_mix(P.cols[0].xyz, P.cols[1].xyz, t * t * (3.0 - 2.0 * t));
  let hor = P.cols[1].xyz;
  // Glow = palette index + strength; index 0 means a lightened horizon color.
  let gi = i32(P.pts[2].y);
  let glowCol = select(vec3f(min(hor.x + 0.12, 0.98), hor.yz * 0.8), P.cols[gi].xyz, gi > 0);
  let g = vec2f(x - P.pts[2].x, (y - horizon) * 1.6);
  var c = mix(lab, glowCol, fract(P.pts[2].y) * exp(-dot(g, g) / 0.09));
  // Sun: a wide bloom, a bright glow hugging the limb, a disc paler at its heart and richer at the
  // limb, and haze where it sinks toward the horizon. Layers drawn later set it behind the hills.
  let si = i32(P.pts[4].y);
  if (si > 0) {
    let r = fract(P.pts[4].y);
    let sc = P.cols[si].xyz;
    let ds = length(vec2f(x, y) - sun);
    let bloom = vec3f(min(sc.x + 0.04, 1.0), mix(sc.yz, hor.yz, 0.4) * 0.8);
    c = mix(c, bloom, 0.4 * exp(-ds * ds / (16.0 * r * r)));
    // The limb glow starts at the disc's own limb color, so disc and glow meet without a ring.
    let limb = vec3f(min(sc.x + 0.02, 1.0), sc.yz * 0.85);
    c = mix(c, limb, 0.7 * exp(-max(ds - r, 0.0) / (0.25 * r)));
    // Near the horizon the disc dims and warms, and a thin bright haze spreads sideways from it.
    let low = smoothstep(horizon - 0.6 * r, horizon + 0.02, y);
    let core = vec3f(min(sc.x + 0.09, 1.0), sc.yz * 0.45);
    var disc = mix(core, limb, smoothstep(0.1, 1.0, ds / r));
    disc = mix(disc, vec3f(sc.x - 0.04, mix(sc.yz, hor.yz, 0.5) * 1.15), 0.6 * low);
    let edge = 0.03 * r + px;
    c = mix(c, disc, smoothstep(r + edge, r - edge, ds) * (1.0 - 0.15 * low));
    let band = exp(-pow((y - horizon) / 0.03, 2.0)) * exp(-pow((x - sun.x) / (5.0 * r), 2.0));
    c = mix(c, bloom, 0.45 * band);
  }
  return c;
}

// Crest height and slope of layer i at x. Tall frames stretch the stack's offsets (and partly the
// amplitudes) so 9:16 shows the same layered landscape as 16:10 instead of one huge front layer.
fn dunes_layer(i: i32, x: f32, skew: f32, stretch: f32, mesa: f32) -> vec2f {
  let k = 18 + i * 6;
  let amp = dunes_p(k + 1) * sqrt(stretch);
  let freq = dunes_p(k + 2);
  let seed = dunes_p(k + 3);
  let e = 0.002;
  let c0 = dunes_crest(x - e, freq, seed, skew, mesa);
  let c1 = dunes_crest(x + e, freq, seed, skew, mesa);
  return vec2f(dunes_p(k) * stretch + amp * 0.5 * (c0 + c1), amp * (c1 - c0) / (2.0 * e));
}

// All shading happens in OKLab: lightness for light and shadow, chroma kept or raised, so shadows
// stay rich instead of grey and haze lifts far layers without shifting their hue to mud.
fn wp_dunes(uv: vec2f, wh: vec2f) -> vec3f {
  let s = inverseSqrt(wh.x * wh.y);
  let q = (uv - 0.5) * wh * s;
  let ca = cos(P.pts[0].x);
  let sa = sin(P.pts[0].x);
  let curl = P.pts[3].x >= 1.0;
  let mesa = fract(P.pts[3].x);
  // Half the frame height; compositions are authored for 16:10 (0.395).
  let yr = 0.5 * wh.y * s;
  var stretch = max(1.0, yr / 0.395);
  var p = vec2f(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
  var foot = 1.05 * yr;
  // Narrow frames pull the sun in so a disc near the side stays in view.
  var sunP = vec2f(P.pts[3].w * min(1.0, 0.5 * wh.x * s / 0.63), P.pts[4].x * stretch);
  if (curl) {
    // Polar frame: x runs along the arcs (scaled to the center's distance), y outward from it.
    let c = P.pts[3].yz;
    let r0 = length(c);
    let v = q - c;
    let toward = -c / r0;
    p = vec2f(atan2(toward.x * v.y - toward.y * v.x, dot(toward, v)) * r0, length(v) - r0);
    stretch = 1.0;
    foot = 0.9;
    sunP = vec2f(0.0, -r0);
  }
  let turn = P.pts[0].y;
  let n = i32(P.pts[0].z);
  let haze = P.pts[0].w;
  let lx = P.pts[1].x;
  let sheenK = P.pts[1].y;
  let shadowK = P.pts[1].z;
  let dof = P.pts[1].w;
  let skew = P.pts[2].z;
  let fillK = P.pts[2].w;
  let L = normalize(vec3f(0.8 * lx, -0.7, 0.6));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let tint = 0.06 * vec2f(cos(turn), sin(turn));
  let hor = P.cols[1].xyz;
  let lightCol = vec3f(min(hor.x + 0.12, 1.0), hor.yz * 1.1);

  let sky = dunes_sky(p.y, p.x, dunes_p(18) * stretch, sunP, s);
  var acc = sky;
  // Coverage by any layer so far: occlusion darkens ground, never the infinitely far sky.
  var solid = 0.0;
  // Depth of what is visible (1 sky .. 0 front layer), for the sun's veil over far hills.
  var vis = 1.0;
  var cur = dunes_layer(0, p.x, skew, stretch, mesa);
  for (var i = 0; i < n; i++) {
    let k = 18 + i * 6;
    let freq = dunes_p(k + 2);
    // The next crest bounds this layer's visible band; the front layer runs to the frame's foot.
    var next = vec2f(cur.x + max(foot - cur.x, 0.12), 0.0);
    if (i + 1 < n) { next = dunes_layer(i + 1, p.x, skew, stretch, mesa); }
    let h = cur.x;
    let dh = cur.y;
    // Signed distance to the crest, positive inside the layer.
    let d = (p.y - h) * inverseSqrt(1.0 + dh * dh);
    let far = select(0.0, 1.0 - f32(i) / f32(n - 1), n > 1);
    let w = s + dof * far * far;

    // Contact shadow on everything behind: a soft occlusion where the layers meet plus a broad
    // falloff, offset away from the light.
    if (i > 0) {
      let ds = min(d + 0.006 + 0.015 * lx * dh, 0.0);
      let contact = 0.3 * exp(ds / 0.03) + 0.7 * exp(ds / (0.05 + 0.05 * (1.0 - far)));
      let sh = solid * shadowK * (1.0 - 0.4 * far) * contact;
      // Pale layers have little chroma to deepen, so shadows also gain chroma in the shadow hue
      // (rose and crimson at sunset): darker and richer, never grey.
      acc = vec3f(acc.x * (1.0 - 0.5 * sh), dunes_turn(acc.yz * (1.0 + 0.35 * sh), turn, sh) + tint * sh);
    }

    let pack = dunes_p(k + 4);
    let ia = i32(floor(pack / 16.0));
    let ib = i32(pack) - ia * 16;
    var t = clamp(0.5 + dunes_p(k + 5) * p.x + fillK * (d - 0.12), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    var col = dunes_mix(P.cols[ia].xyz, P.cols[ib].xyz, t);

    // A swell's cross-section: the normal lies in the image plane at the crest silhouette (pointing
    // out of the crest profile), turns to face the viewer just below it, and rolls under toward the
    // next crest, where the layer tucks behind the one in front.
    let dd = max(d, 0.0);
    let u = clamp(dd / max(next.x - h, 0.04), 0.0, 1.0);
    let phi = 1.5708 * (1.0 - exp(-dd / (0.02 + 0.12 / freq))) + 0.8 * smoothstep(0.2, 1.0, u);
    let n2 = normalize(vec2f(dh, -1.0));
    let n3 = vec3f(n2 * cos(phi), sin(phi));
    let diff = dot(n3, L) * 0.5 + 0.5;
    let dark = max(0.78 - diff, 0.0);
    col = vec3f(col.x * mix(0.66, 1.1, diff), dunes_turn(col.yz, turn, 1.5 * dark) + tint * dark);
    // Satin: a wide soft specular sheen where the swell turns toward the light, plus a faint lift
    // right on the edge.
    let sheen = sheenK * (pow(max(dot(n3, H), 0.0), 10.0) + 0.25 * exp(-dd / 0.006) * clamp(dot(n2, L.xy) + 0.6, 0.0, 1.6));
    // Sheen color: the surface's own hue lifted toward white, tinted a little by the horizon light.
    let glint = vec3f(min(col.x + 0.22, 1.0), mix(col.yz, lightCol.yz, 0.35) * 0.75);
    col = mix(col, glint, clamp(0.6 * sheen, 0.0, 1.0));
    col.x += 0.05 * sheen;
    // Aerial depth: lift lightness toward the sky, borrow only part of its hue.
    let hz = haze * far;
    col = vec3f(mix(col.x, sky.x, hz), mix(col.yz, sky.yz, hz * 0.45));
    let cover = smoothstep(-w, w, d);
    acc = mix(acc, col, cover);
    solid = mix(solid, 1.0, cover);
    vis = mix(vis, far, cover);
    cur = next;
  }
  // Atmospheric veil: sunlight scattered over the far hills around the disc.
  if (i32(P.pts[4].y) > 0 && vis < 1.0) {
    let r = fract(P.pts[4].y);
    let sc = P.cols[i32(P.pts[4].y)].xyz;
    let ds = length(p - sunP);
    acc = mix(acc, vec3f(min(sc.x + 0.02, 1.0), mix(sc.yz, hor.yz, 0.5) * 0.8), 0.45 * vis * exp(-ds * ds / (20.0 * r * r)));
  }
  return oklabToSrgb(dunes_gamut(acc));
}
