// Lustre: lit material studies beside the silk drapes. One studio light and one environment shade
// every mode, so chrome, pearl, soap film, glass, brushed metal, water, and folded foil all agree.
// Modes (P.pts[0].x):
//   0 objects   spheres, rings, bubbles, pearls, and drops resting on a backdrop, seen from above
//   1 brushed   radially or linearly brushed metal with an anisotropic highlight sweep
//   2 water     concentric ripples on dark water under a light, in perspective
//   3 stars     a particle scatter in a soft band of light
//   4 caustics  rainbow caustics from glass, dispersed across a pale table
//   5 shell     a spiral whorl in nacre
//   6 film      a macro of a soap film's swirling interference colors
//   7 pleats    accordion-folded paper, fanned from a point or in parallel bent pleats
// P.pts[0] = mode, seed, light azimuth (rad, 0 = from the top), light elevation (rad)
// P.pts[1] = thin-film amount, film thickness (um), film variation, exposure
// P.pts[2] = environment sky level (0 black .. 1 white), key light, key size, rim light
// P.pts[3], P.pts[4] = mode knobs (see each mode). P.pts[5..11] = mode items (objects, drops, arcs).
// Colors: 0 = ground (lit side), 1 = ground (far side), 2 = material tint, 3.. = accents.
// Positions are frame-relative (0..1), sizes relative to the shorter side, so every aspect ratio
// keeps the same arrangement.

fn lustre_lin(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  return max(vec3f(
    4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_,
    -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_,
    -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_,
  ), vec3f(0.0));
}

fn lustre_col(i: i32) -> vec3f {
  return lustre_lin(P.cols[min(i, i32(P.a.y) - 1)].xyz);
}

fn lustre_hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn lustre_noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lustre_hash(i), lustre_hash(i + vec2f(1.0, 0.0)), u.x),
    mix(lustre_hash(i + vec2f(0.0, 1.0)), lustre_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

// Thin-film interference: reflectance of a film of thickness d (um, index 1.33) at the cosine ct,
// sampled at red, green, and blue wavelengths. Soap bubbles, nacre, and holographic foil.
fn lustre_film(d: f32, ct: f32) -> vec3f {
  let opd = 2.0 * 1.33 * d * sqrt(max(1.0 - (1.0 - ct * ct) / 1.77, 0.0));
  return 0.5 - 0.5 * cos(6.2832 * opd / vec3f(0.65, 0.53, 0.46));
}

// Film tint: physical interference softened toward white by the film amount.
fn lustre_tint(d: f32, ct: f32) -> vec3f {
  let f = lustre_film(d, ct);
  return mix(vec3f(1.0), f / max(max(f.r, max(f.g, f.b)), 0.2), P.pts[1].x);
}

fn lustre_light() -> vec3f {
  let a = P.pts[0];
  return normalize(vec3f(cos(a.w) * vec2f(sin(a.z), -cos(a.z)), sin(a.w)));
}

// Studio environment, z toward the viewer, up toward the top of the frame, as if the camera stood
// level with the objects: reflections read like a product shot, ground below a horizon line, sky
// above, a rectangular key softbox in the light's direction, and a thin rim strip opposite it.
fn lustre_env(R: vec3f, ground: vec3f) -> vec3f {
  let e = P.pts[2];
  let K = lustre_light();
  let up = dot(R, vec3f(0.0, -0.96, 0.28));
  // Sky: dark overhead, brightening toward the walls; the ground reflects below the horizon.
  let wall = pow(1.0 - clamp(up, 0.0, 1.0), 3.0);
  let sky = mix(ground * 0.5, vec3f(1.0), e.x) * mix(0.25 + 0.75 * wall, 0.85 + 0.15 * wall, e.x);
  // A bright studio lifts its floor too; a dark one keeps only a sheen near the horizon.
  let floor = mix(ground * (0.3 + 0.7 * exp(up * 4.0)) + sky * 0.15 * exp(up * 6.0), ground, e.x);
  var c = mix(floor, sky, smoothstep(-0.015, 0.04, up));
  // The far wall: a soft band of light along the horizon.
  c += (0.05 + 0.3 * e.x) * e.y * exp(-up * up / 0.004);
  // Key: a tall two-pane studio window with crisp edges, plus a faint halo, in the light's
  // direction. Projected through the reflection, it bends with every curved surface.
  let T1 = normalize(vec3f(-K.y, K.x, 0.0) + vec3f(1e-4, 0.0, 0.0));
  let T2 = cross(K, T1);
  let k = dot(R, K);
  if (k > 0.0) {
    let ab = vec2f(dot(R, T1), dot(R, T2)) / k / vec2f(e.z, e.z * 1.5);
    let q = pow(abs(ab), vec2f(8.0));
    let box = 1.0 - smoothstep(0.82, 1.0, q.x + q.y);
    let bars = smoothstep(0.025, 0.05, abs(ab.x));
    c += e.y * (box * mix(0.2, 1.0, bars) * (0.85 + 0.15 * ab.y) + 0.08 * exp(-dot(ab, ab) * 0.5));
  }
  // Rim: a light behind the objects, opposite the key: a thin crescent along their far edge.
  let K2 = normalize(vec3f(-K.xy * 0.7, -0.7));
  c += e.w * smoothstep(0.93, 0.985, dot(R, K2));
  return c;
}

fn lustre_tone(c0: vec3f) -> vec3f {
  let c = c0 * P.pts[1].w;
  let knee = 0.8;
  let s = select(c, knee + (1.0 - knee) * (1.0 - exp(-(c - knee) / (1.0 - knee))), c > vec3f(knee));
  return encodeSrgb(clamp(s, vec3f(0.0), vec3f(1.0)));
}

// ---- 0: objects ----
// P.pts[3] = object count (1..7), backdrop fold amount, backdrop fold frequency, shadow strength
// P.pts[4] = contact occlusion, ring thickness (of its radius), bubble film variation, drop lensing
// P.pts[5 + i] = object x, y (frame), radius (shorter side), kind: 0 chrome sphere, 1 pearl,
//   2 soap bubble, 3 glass drop, 4 chrome ring, 5 pearl ring

struct LustreObj {
  c: vec2f,
  r: f32,
  kind: i32,
}

fn lustre_obj(i: i32, wh: vec2f) -> LustreObj {
  let o = P.pts[5 + i];
  let m = max(wh.x, wh.y);
  return LustreObj((o.xy - 0.5) * wh / m, o.z * min(wh.x, wh.y) / m, i32(o.w + 0.5));
}

// Surface height above the backdrop and normal of object o at p; z < 0 off the object.
fn lustre_surface(o: LustreObj, p: vec2f) -> vec4f {
  let v = p - o.c;
  if (o.kind >= 4) {
    let a = o.r * P.pts[4].y;
    let q = length(v) - o.r;
    if (abs(q) >= a) { return vec4f(0.0, 0.0, 1.0, -1.0); }
    let z = sqrt(a * a - q * q);
    return vec4f(normalize(vec3f(normalize(v + vec2f(1e-6, 0.0)) * q, z)), a + z);
  }
  let d2 = dot(v, v);
  if (d2 >= o.r * o.r) { return vec4f(0.0, 0.0, 1.0, -1.0); }
  let z = sqrt(o.r * o.r - d2);
  return vec4f(vec3f(v, z) / o.r, o.r + z);
}

// The backdrop: a light gradient, optional soft satin folds, and every object's shadow and contact
// occlusion. Transparent objects cast lighter shadows with a focused caustic inside.
fn lustre_ground(p: vec2f, wh: vec2f) -> vec3f {
  let L = lustre_light();
  let m3 = P.pts[3];
  let Ld = normalize(L.xy + vec2f(0.0, 1e-4));
  let t = clamp(0.5 + 1.1 * dot(p, Ld), 0.0, 1.0);
  var c = mix(lustre_col(1), lustre_col(0), t * t * (3.0 - 2.0 * t));
  if (m3.y > 0.0) {
    let seed = P.pts[0].y;
    let f = m3.z;
    let dir = normalize(vec2f(cos(seed), sin(seed)));
    let u = dot(p, dir) * f + 1.3 * sin(dot(p, vec2f(-dir.y, dir.x)) * f * 0.45 + seed * 2.0);
    let slope = cos(u + 0.4 * sin(u)) * (1.0 + 0.4 * cos(u));
    c *= 1.0 + m3.y * slope * dot(dir, Ld) - m3.y * 0.3 * (1.0 - sin(u + 0.4 * sin(u))) * 0.5;
  }
  var light = 1.0;
  var caustic = 0.0;
  for (var i = 0; i < i32(m3.x); i++) {
    let o = lustre_obj(i, wh);
    let clear = o.kind == 2 || o.kind == 3;
    var sh = 0.0;
    var ao = 0.0;
    if (o.kind >= 4) {
      let a = o.r * P.pts[4].y;
      let ps = p - L.xy / max(L.z, 0.2) * a;
      let q = abs(length(ps - o.c) - o.r);
      sh = 1.0 - smoothstep(a * 0.6, a * 1.6, q);
      let qa = abs(length(p - o.c) - o.r);
      ao = a * a / (qa * qa + a * a);
    } else {
      let v = vec3f(o.c - p, o.r);
      let tt = dot(v, L);
      let dist = sqrt(max(dot(v, v) - tt * tt, 0.0));
      if (tt > 0.0) {
        sh = 1.0 - smoothstep(-1.0, 1.0, (dist - o.r) / (0.18 * tt + o.r * 0.08));
        // Glass drops focus light into a caustic; a soap film is too thin to bend it.
        if (o.kind == 3) { caustic += exp(-dist * dist / (o.r * o.r * 0.06)) * 1.6; }
      }
      let d2 = dot(p - o.c, p - o.c);
      ao = pow(o.r * o.r / (d2 + o.r * o.r), 1.5);
    }
    light *= 1.0 - m3.w * sh * select(1.0, select(0.35, 0.12, o.kind == 2), clear);
    light *= 1.0 - P.pts[4].x * ao;
  }
  return c * light + c * caustic * light;
}

fn lustre_objects(p: vec2f, wh: vec2f) -> vec3f {
  var best = vec4f(0.0, 0.0, 1.0, -1.0);
  var bi = -1;
  for (var i = 0; i < i32(P.pts[3].x); i++) {
    let s = lustre_surface(lustre_obj(i, wh), p);
    if (s.w > best.w) { best = s; bi = i; }
  }
  let ground = lustre_ground(p, wh);
  if (bi < 0) { return ground; }
  let o = lustre_obj(bi, wh);
  let N = best.xyz;
  let V = vec3f(0.0, 0.0, 1.0);
  let L = lustre_light();
  let R = reflect(-V, N);
  let avg = 0.5 * (lustre_col(0) + lustre_col(1));
  let env = lustre_env(R, avg);
  let nv = max(N.z, 0.0);
  let fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  let tint = lustre_col(2);
  let fm = P.pts[1];
  let seed = P.pts[0].y + f32(bi) * 3.7;
  if (o.kind == 0 || o.kind == 4) {
    return env * tint;
  }
  if (o.kind == 1 || o.kind == 5) {
    // Pearl: a soft diffuse body under thin layers of nacre whose color turns with the view.
    let d = fm.y + fm.z * (0.5 * N.x + 0.3 * N.y + 0.2 * sin(N.x * 5.0 + seed));
    let nacre = lustre_tint(d, nv);
    let diff = max((dot(N, L) + 0.35) / 1.35, 0.0);
    let body = tint * nacre * (0.38 + 0.7 * diff);
    return body + env * (0.08 + 0.6 * fres) * nacre;
  }
  if (o.kind == 2) {
    // Soap bubble: nearly clear. The front surface and the inside of the back wall both reflect the
    // studio, the back one mirrored and fainter; their Fresnel rise makes the bright rim. The film
    // drains, so it is thinnest at the top, and flows in smooth bands that swirl around the sphere.
    let w = N.xy + 0.25 * vec2f(sin(N.y * 3.0 + seed), sin(N.x * 2.6 - seed));
    let flow = 0.16 * sin(w.x * 2.4 + w.y * 1.3 + seed) + 0.08 * sin(w.y * 3.4 - w.x * 1.9 + seed * 1.7);
    let d = fm.y + P.pts[4].z * (0.5 + 0.5 * N.y + flow);
    let film = mix(vec3f(0.5), lustre_film(d, nv), fm.x) * 2.0;
    let fb = 0.05 + 0.95 * pow(1.0 - nv, 4.0);
    // The back wall is seen through the front, and at grazing angles its path runs long and faint.
    let back = lustre_env(vec3f(-R.xy, R.z), avg) * 0.35 * smoothstep(0.25, 0.8, nv);
    let r = fb * film;
    // What the film reflects it takes from the light passing through: the background behind shows
    // the complementary hue. Refraction darkens a hairline at the very edge.
    let edge = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.06, nv));
    return (ground * max(vec3f(1.0) - r, vec3f(0.0)) * (1.0 - fb * 0.15) + (env + back) * r) * edge;
  }
  // Glass drop: a small inverted lens of the backdrop with a dark edge and bright reflections.
  let behind = lustre_ground(o.c - (p - o.c) * P.pts[4].w, wh);
  let edge = smoothstep(0.0, 0.55, nv);
  return behind * mix(0.35, 1.05, edge) + env * fres;
}

// ---- 1: brushed metal ----
// P.pts[3] = center x, y (frame), radial (1) or linear (0), grain amount
// P.pts[4] = highlight width, highlight strength, base level, radial lobe pairs | linear angle (rad)
fn lustre_grain(u: f32, v: f32, px: f32) -> f32 {
  let x = u / px;
  // Long fine grooves: across them noise at pixel pitch, along them it changes only slowly.
  let a = lustre_noise(vec2f(x, v * 0.6));
  let b = lustre_noise(vec2f(x * 0.31 + 11.0, v * 0.25));
  let s = smoothstep(0.9, 1.0, lustre_noise(vec2f(x * 0.07 + 3.0, v * 0.1)));
  return (a - 0.5) * 0.9 + (b - 0.5) * 0.35 + s * 0.25;
}

fn lustre_brushed(p0: vec2f, wh: vec2f) -> vec3f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let px = 2.2 / max(wh.x, wh.y);
  let tint = lustre_col(2);
  let L = lustre_light();
  let base = mix(lustre_col(1), lustre_col(0), clamp(0.5 - 0.8 * dot(p0, normalize(L.xy + vec2f(0.0, 1e-4))), 0.0, 1.0));
  var hl = 0.0;
  var g = 0.0;
  if (m3.z > 0.5) {
    let c = (m3.xy - 0.5) * wh / max(wh.x, wh.y);
    let v = p0 - c;
    let r = length(v);
    let th = atan2(v.y, v.x);
    g = lustre_grain(r, th * 6.0 + 3.0, px);
    let la = atan2(-L.y, -L.x);
    let lobes = max(m4.w, 1.0);
    // Circular grooves catch the light along a radial streak through the center, on both sides.
    let dth = abs(fract((th - la) * lobes / 6.2832 + 0.5) - 0.5) * 6.2832 / lobes;
    let dth2 = abs(fract((th - la) * lobes / 6.2832) - 0.5) * 6.2832 / lobes;
    let w = m4.x;
    hl = exp(-dth * dth / (w * w)) + 0.55 * exp(-dth2 * dth2 / (w * w * 1.6));
    hl += 0.25 * exp(-min(dth, dth2) * min(dth, dth2) / (w * w * 12.0));
    hl *= smoothstep(0.0, 0.08, r);
  } else {
    let a = m4.w;
    let q = vec2f(cos(a) * p0.x + sin(a) * p0.y, -sin(a) * p0.x + cos(a) * p0.y);
    g = lustre_grain(q.y, q.x * 4.0, px);
    // Straight grooves stretch the highlight across them into a soft bar, brightest at its core.
    let x = q.x - m3.x + 0.5;
    let w = m4.x;
    hl = exp(-x * x / (w * w)) + 0.35 * exp(-x * x / (w * w * 9.0));
    hl *= 0.8 + 0.2 * sin(q.y * 3.0 + P.pts[0].y);
  }
  let grain = m3.w * g;
  let c = base * m4.z * (1.0 + grain * 0.35) + tint * m4.y * hl * (1.0 + grain * 0.9);
  return max(c, vec3f(0.0));
}

// ---- 2: water ----
// P.pts[2].x (sky level) lightens the water body for milky, high-key liquids; P.pts[2].z stretches
// the light into a wide strip (1 = a disc); P.pts[2].w raises it above the horizon (default 3 radii).
// P.pts[3] = horizon (frame y), camera height, ripple wavenumber, ripple amplitude
// P.pts[4] = ripple decay, swell amplitude, light x (screen units), light radius (it sits 3 radii up)
// P.pts[5 + i] (i < 3) = drop x, depth z (plane), strength, phase
fn lustre_sky(sx: f32, sy: f32, wh: vec2f) -> vec3f {
  let m4 = P.pts[4];
  let glow = exp(-max(sy, 0.0) * 6.0);
  var c = mix(lustre_col(0), lustre_col(1), glow);
  // Light x is set for 16:9 and pulled in on narrower frames, so it stays in view at 9:16.
  let lx = m4.z * min(wh.x / wh.y / 1.7778, 1.0);
  let d = vec2f((sx - lx) / max(P.pts[2].z, 1.0), sy - max(P.pts[2].w, m4.w * 3.0)) / m4.w;
  // The light: a soft-edged disc, slightly darker at its limb, in a two-scale glow.
  let r = length(d);
  let px = 1.5 / (m4.w * wh.y);
  let disc = (1.0 - smoothstep(1.0 - px, 1.0 + px, r)) * (1.0 - 0.12 * r * r);
  let glow2 = 0.3 * exp(-max(r - 1.0, 0.0) * 3.0) * step(1.0, r) + 0.1 * exp(-r * r * 0.03);
  c += lustre_col(2) * P.pts[2].y * (disc + glow2);
  return c;
}

fn lustre_water(uv: vec2f, wh: vec2f) -> vec3f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let sx = (uv.x - 0.5) * wh.x / wh.y;
  let sy = uv.y - m3.x;
  if (sy <= 0.0) { return lustre_sky(sx, -sy, wh); }
  let H = m3.y;
  let Z = H / sy;
  let X = sx * Z;
  let fp = Z * Z / (H * wh.y);
  let k = m3.z;
  let att = 1.0 - smoothstep(0.25, 0.9, k * fp);
  var g = vec2f(0.0);
  for (var i = 0; i < 3; i++) {
    let dr = P.pts[5 + i];
    if (dr.z == 0.0) { continue; }
    let v = vec2f(X, Z) - dr.xy;
    let rho = length(v) + 1e-4;
    let env = exp(-rho * m4.x) / sqrt(1.0 + rho * k * 0.2);
    let dh = dr.z * m3.w * env * (k * cos(k * rho - dr.w) - m4.x * sin(k * rho - dr.w));
    g += dh * v / rho;
  }
  // Small wind waves break the light's reflection into a glitter path.
  let sw = P.pts[0].y;
  // Waves too fine for a pixel are faded out, and their slope goes into a statistical glitter below.
  var lost = 0.0;
  for (var i = 0; i < 7; i++) {
    let fi = f32(i);
    let a = sw + fi * 2.4;
    let dir = normalize(vec2f(cos(a) * 0.7, sin(a) * 0.3 + 1.0));
    let kw = k * (0.6 + 0.55 * fi);
    let ph = dot(vec2f(X, Z), dir) * kw + fi * 1.7 + sin(X * kw * 0.13 + fi) * 1.5;
    let fade = 1.0 - smoothstep(0.25, 0.9, kw * fp);
    g += m4.y * k * cos(ph) * dir * fade;
    lost += (1.0 - fade * att) * (1.0 - fade * att);
  }
  g *= att;
  let N = normalize(vec3f(-g.x, 1.0, -g.y));
  let V = normalize(vec3f(-X, H, -Z));
  let R = reflect(-V, N);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // Wave backs that face down still see the low sky, never a black hole.
  let refl = lustre_sky(R.x / max(R.z, 1e-3), max(R.y, 0.0) / max(R.z, 1e-3), wh);
  // Glitter: where waves are finer than a pixel, the light's reflection spreads into a column of
  // short sparkling streaks, as wide as the lost slopes tilt it.
  // Wind runs mostly toward the viewer, so the column is far narrower than it is long.
  let sl = 1.2 * m4.y * k * sqrt(lost * 0.5);
  let lx = m4.z * min(wh.x / wh.y / 1.7778, 1.0);
  let ly = max(P.pts[2].w, m4.w * 3.0);
  let rd = vec2f((R.x / max(R.z, 1e-3) - lx) / max(P.pts[2].z, 1.0), R.y / max(R.z, 1e-3) - ly);
  let s2 = m4.w * m4.w + sl * sl * vec2f(0.12, 1.0);
  let col = m4.w * m4.w / sqrt(s2.x * s2.y) * exp(-dot(rd * rd, 1.0 / s2));
  let sq = vec2f(uv.x * wh.y / 9.0, uv.y * wh.y / 2.5) + vec2f(sw * 9.0, 0.0);
  let sparkle = smoothstep(0.55, 0.9, lustre_noise(sq) * 0.65 + lustre_noise(sq * vec2f(2.3, 1.7) + 7.0) * 0.35);
  let glitter = lustre_col(2) * P.pts[2].y * col * (0.35 + 2.5 * sparkle) * smoothstep(0.0, 0.004, sl);
  return lustre_col(0) * (0.25 + 0.6 * P.pts[2].x) + refl * fres * 1.8 + glitter * fres * 1.8;
}

// ---- 3: stars ----
// A night sky: a smooth nebula band with a few soft glows in it, scattered crisp stars of many
// sizes, denser in the band, and soft cross glints on the brightest.
// P.pts[3] = band angle (rad), band offset, band width, density
// P.pts[4] = nebula strength, star brightness, glint amount, band curve
fn lustre_stars(p: vec2f, wh: vec2f) -> vec3f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let seed = P.pts[0].y;
  let n = vec2f(-sin(m3.x), cos(m3.x));
  let t = vec2f(n.y, -n.x);
  let u = dot(p, t);
  let v = dot(p, n) - m3.y - m4.w * u * u;
  let w = m3.z * (1.0 + 0.3 * sin(u * 4.0 + seed));
  var neb = exp(-v * v / (w * w)) * (0.55 + 0.45 * sin(u * 5.0 + seed * 2.0 + v * 8.0));
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    let cu = (lustre_hash(vec2f(fi, seed)) - 0.5) * 1.2;
    let cv = (lustre_hash(vec2f(fi, seed + 4.0)) - 0.5) * m3.z;
    let d = vec2f(u - cu, v - cv) / vec2f(m3.z * 2.5, m3.z * 0.9);
    neb += 0.5 * exp(-dot(d, d));
  }
  neb += 0.12 * exp(-v * v / (m3.z * m3.z * 12.0));
  var c = mix(lustre_col(0), lustre_col(1), clamp(m4.x * neb, 0.0, 1.0));
  let px = 1.0 / max(wh.x, wh.y);
  let star = lustre_col(2);
  for (var l = 0; l < 2; l++) {
    let cell = select(0.03, 0.011, l == 1);
    let id0 = floor(p / cell);
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let id = id0 + vec2f(f32(i), f32(j));
        let pos = (id + 0.15 + 0.7 * vec2f(lustre_hash(id + 1.7 + seed), lustre_hash(id + 5.3 + seed))) * cell;
        let pu = dot(pos, t);
        let pv = dot(pos, n) - m3.y - m4.w * pu * pu;
        let dens = m3.w * (0.2 + exp(-pv * pv / (m3.z * m3.z * 2.0))) * select(1.0, 0.6, l == 1);
        if (lustre_hash(id + seed * 13.0 + f32(l) * 71.0) > dens) { continue; }
        let b = pow(lustre_hash(id + 9.1 + seed), 4.0) * select(1.0, 0.25, l == 1);
        // Sizes are fractions of the frame, so thumbnails show the same sky; a star smaller than a
        // pixel spreads to one pixel with its energy kept.
        let r0 = 0.0005 * (0.55 + 1.6 * b);
        let rad = max(r0, px * 0.5);
        let energy = r0 * r0 / (rad * rad);
        let dv = p - pos;
        let d2 = dot(dv, dv);
        c += star * m4.y * (0.12 + 2.2 * b) * energy * exp(-d2 / (rad * rad));
        if (b > 0.5) {
          // Glints on the brightest few: thin diffraction spikes and a soft halo.
          let len = 0.02 * (b - 0.4);
          let w = max(0.0004, px * 0.5);
          let a = abs(dv);
          let spikes = exp(-a.x / len) * exp(-a.y * a.y / (w * w)) + exp(-a.y / len) * exp(-a.x * a.x / (w * w));
          c += star * m4.z * b * (0.35 * spikes * 0.0004 / w + 0.15 * exp(-sqrt(d2) / (0.003 * b)));
        }
      }
    }
  }
  return c;
}

// ---- 4: caustics ----
// Light through glass on a pale table: the glass's soft shadow with a bright caustic line inside it,
// and prism spectra, soft rainbow bands, thrown across the table.
// P.pts[3] = band count (1..3), edge softness, shadow amount, caustic line strength
// P.pts[4] = glass shadow x, y (frame), half size (shorter side), rotation (rad)
// P.pts[5 + 2i] = band center x, y (frame), direction (rad), half length (shorter side)
// P.pts[6 + 2i] = band width (shorter side), intensity, bend, spectrum order (+-1) plus white core:
//   +-(1 + core), core = the fraction of the band's middle that stays white, spectra only at its edges
fn lustre_spectrum(t: f32) -> vec3f {
  // Violet to red, each hue peaking in turn, summing close to white.
  let x = clamp(t, 0.0, 1.0);
  return clamp(vec3f(
    smoothstep(0.45, 0.75, x) - 0.6 * smoothstep(0.85, 1.0, x) + 0.35 * (1.0 - smoothstep(0.0, 0.15, x)),
    smoothstep(0.15, 0.45, x) * (1.0 - smoothstep(0.6, 0.85, x)),
    1.0 - smoothstep(0.25, 0.5, x),
  ), vec3f(0.0), vec3f(1.0));
}

fn lustre_caustics(p: vec2f, wh: vec2f) -> vec3f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let m = max(wh.x, wh.y);
  let s = min(wh.x, wh.y) / m;
  let L = lustre_light();
  let Ld = normalize(L.xy + vec2f(0.0, 1e-4));
  let t0 = clamp(0.5 + 1.1 * dot(p, Ld), 0.0, 1.0);
  var c = mix(lustre_col(1), lustre_col(0), t0 * t0 * (3.0 - 2.0 * t0));
  // Glass shadow: a soft rounded block, faintly tinted, with a bright caustic line inside it where
  // the glass focuses the light.
  let gc = (m4.xy - 0.5) * wh / m;
  let rot = vec2f(cos(m4.w), sin(m4.w));
  let gq = vec2f(dot(p - gc, rot), dot(p - gc, vec2f(-rot.y, rot.x)));
  let hs = m4.z * s;
  let bq = abs(gq) - vec2f(hs * 1.5, hs * 0.55);
  let sd = length(max(bq, vec2f(0.0))) + min(max(bq.x, bq.y), 0.0) - hs * 0.3;
  let shade = 1.0 - smoothstep(-hs * 0.1, hs * 0.18, sd);
  c *= mix(vec3f(1.0), lustre_col(2), m3.z * shade);
  let lineD = gq.y - hs * 0.2 - 0.15 * gq.x * gq.x / hs;
  c += c * m3.w * exp(-lineD * lineD / (hs * hs * 0.006)) * (1.0 - smoothstep(hs * 0.6, hs * 1.5, abs(gq.x)));
  // Spectra: across each band the hue runs violet to red; it fades softly at the ends.
  var light = vec3f(0.0);
  for (var b = 0; b < i32(m3.x); b++) {
    let A = P.pts[5 + 2 * b];
    let B = P.pts[6 + 2 * b];
    let bc = (A.xy - 0.5) * wh / m;
    let dir = vec2f(cos(A.z), sin(A.z));
    let u = dot(p - bc, dir) / (A.w * s);
    let v = (dot(p - bc, vec2f(-dir.y, dir.x)) - B.z * u * u * A.w * s) / (B.x * s);
    let along = 1.0 - smoothstep(0.55, 1.0, abs(u));
    let across = smoothstep(-0.5 - m3.y, -0.5 + m3.y, v) * (1.0 - smoothstep(0.5 - m3.y, 0.5 + m3.y, v));
    let cw = min(abs(B.w) - 1.0, 0.9);
    let vv = sign(v) * max(abs(v) - cw * 0.5, 0.0) / (1.0 - cw);
    let t = 0.5 + vv * sign(B.w);
    let hue = mix(vec3f(0.55), lustre_spectrum(t) * mix(1.0, 1.8, step(0.001, cw)), smoothstep(0.0, 0.12, abs(vv)) * step(0.001, cw) + step(cw, 0.001));
    light += hue * across * along * B.y * mix(0.6, 1.0, 1.0 - abs(u));
  }
  return c * (1.0 + light);
}

// ---- 5: shell ----
// P.pts[3] = spiral eye x, y (frame), growth per turn (log), whorl depth
// P.pts[4] = rib count (integer), rib depth, growth lines, rotation (rad)
fn lustre_shellh(p: vec2f, c: vec2f) -> vec2f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let v = p - c;
  let r = length(v) + 1e-5;
  let th = atan2(v.y, v.x) + m4.w;
  let s = log(r) / m3.z - th / 6.2832;
  let fr = fract(s);
  let whorl = sqrt(max(fr * (1.0 - fr), 0.0)) * 2.0;
  let rib = sin(th * floor(m4.x) + log(r) * 3.0) * m4.y * fr * (1.0 - fr) * 4.0;
  let lines = sin(s * 6.2832 * m4.z) * 0.02;
  return vec2f(r * m3.w * (whorl + rib + lines), fr);
}

fn lustre_shell(p: vec2f, wh: vec2f) -> vec3f {
  let c = (P.pts[3].xy - 0.5) * wh / max(wh.x, wh.y);
  let e = 0.5 / max(wh.x, wh.y) + 1e-4;
  let h0 = lustre_shellh(p, c);
  let gx = lustre_shellh(p + vec2f(e, 0.0), c).x - lustre_shellh(p - vec2f(e, 0.0), c).x;
  let gy = lustre_shellh(p + vec2f(0.0, e), c).x - lustre_shellh(p - vec2f(0.0, e), c).x;
  let N = normalize(vec3f(-gx, -gy, 2.0 * e));
  let L = lustre_light();
  let R = reflect(vec3f(0.0, 0.0, -1.0), N);
  let nv = max(N.z, 0.0);
  let fm = P.pts[1];
  let d = fm.y + fm.z * (h0.y * 0.6 + 0.4 * sin(atan2(p.y - c.y, p.x - c.x) * 2.0 + P.pts[0].y));
  let nacre = lustre_tint(d, nv);
  let diff = max((dot(N, L) + 0.3) / 1.3, 0.0);
  // The suture between whorls sits in shadow.
  let suture = smoothstep(0.0, 0.12, h0.y) * smoothstep(1.0, 0.9, h0.y);
  let ao = mix(0.7, 1.0, suture);
  let avg = 0.5 * (lustre_col(0) + lustre_col(1));
  let env = lustre_env(R, avg);
  let fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  let body = lustre_col(2);
  return body * nacre * (0.25 + 0.8 * diff) * ao + env * nacre * (0.06 + 0.5 * fres) * ao;
}

// ---- 6: film ----
// A macro of a soap film: interference colors follow the film's thickness, which drains downward
// and is stirred into marbled swirls. Seen in front of a soft white light, so the colors stay airy.
// P.pts[3] = thickness at the top (um), drainage (um per unit down), swirl depth (um), swirl scale
// P.pts[4] = warp strength, rotation (rad), light falloff, unused
fn lustre_filmmacro(p0: vec2f, wh: vec2f) -> vec3f {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let seed = P.pts[0].y;
  let cr = vec2f(cos(m4.y), sin(m4.y));
  let p = vec2f(dot(p0, cr), dot(p0, vec2f(-cr.y, cr.x))) * m3.w;
  // Three rounds of domain warping turn smooth waves into eddies.
  let k = m4.x;
  var w = p + k * 0.5 * vec2f(sin(p.y * 1.7 + seed), sin(p.x * 1.4 - seed * 1.3));
  w += k * 0.3 * vec2f(sin(w.y * 3.1 - seed * 0.7), sin(w.x * 2.9 + seed * 2.1));
  w += k * 0.15 * vec2f(sin(w.y * 5.7 + seed * 1.9), sin(w.x * 6.3 - seed));
  let swirl = 0.6 * sin(w.x * 1.3 + w.y * 0.7 + seed) + 0.4 * sin(w.y * 2.2 - w.x * 0.9 - seed * 0.5);
  let d = max(m3.x + m3.y * (p0.y + 0.5) + m3.z * swirl, 0.0);
  let film = lustre_film(d, 1.0);
  // Very thin film turns dark gray-silver; keep it soft and pearly instead of black.
  let thin = smoothstep(0.05, 0.2, d);
  let col = mix(vec3f(0.92), mix(vec3f(0.55), film, thin), P.pts[1].x);
  let L = lustre_light();
  let lp = p0 + normalize(L.xy + vec2f(0.0, 1e-4)) * 0.3;
  let light = mix(1.0, 0.75 + 0.35 * exp(-dot(lp, lp) * 3.0), m4.z);
  return mix(lustre_col(0), col, 0.85) * light;
}

// ---- 7: pleats ----
// A sheet of paper folded like an accordion, lying on a backdrop: fanned out from a point, or a
// ribbon of parallel pleats that bends across the frame. It hovers a little and casts a soft shadow.
// P.pts[3] = fan center x, y (frame), pleats (per full turn when fanned, per unit length as a
//   ribbon), depth (pleat height over its width)
// P.pts[4] = fanned (1) or ribbon (0), ribbon direction (rad), bend, crease roundness (of a pleat)
// P.pts[5] = extent (fan radius, ribbon half width, longer side units), hover height, ribbon offset
// Colors: 0 = paper lit, 1 = paper in shade, 2 = crease highlight, 3 = backdrop.
struct LustrePleat {
  h: f32,
  // Distance from the valley crease, 0 at the valley, 1 at the ridge.
  x: f32,
  // Signed distance to the paper's edge (negative on the paper).
  sd: f32,
}

fn lustre_pleat(p: vec2f, wh: vec2f) -> LustrePleat {
  let m3 = P.pts[3];
  let m4 = P.pts[4];
  let m5 = P.pts[5];
  var u = 0.0;
  var pitch = 0.0;
  var sd = 0.0;
  if (m4.x > 0.5) {
    let v = p - (m3.xy - 0.5) * wh / max(wh.x, wh.y);
    let r = length(v);
    let n = floor(m3.z);
    u = atan2(v.y, v.x) * n / 6.2832 + m4.z * r;
    pitch = r * 6.2832 / n;
    sd = r - m5.x;
  } else {
    let dir = vec2f(cos(m4.y), sin(m4.y));
    let x = dot(p, dir);
    let y = dot(p, vec2f(-dir.y, dir.x)) - m5.z - m4.z * x * x;
    // Creases run square to the bent ribbon, not to its chord.
    let slope = 2.0 * m4.z * x;
    u = (x + slope * y) * inverseSqrt(1.0 + slope * slope) * m3.z;
    pitch = 1.0 / m3.z;
    sd = abs(y) - m5.x;
  }
  // A rounded triangle wave: flat faces meeting in crisp valley and ridge creases. Each face bows a
  // little, as real paper does, so light grades across it.
  let t = fract(u) - 0.5;
  let k = m4.w;
  let xv = sqrt(t * t + k * k) - k;
  let half = sqrt(0.25 + k * k) - k;
  let xr = half - xv;
  let tri = half - (sqrt(xr * xr + k * k) - k);
  let x = tri / half;
  let bow = 0.08 * x * (1.0 - x);
  return LustrePleat(m3.w * pitch * (tri + bow * half), x, sd);
}

fn lustre_pleats(p: vec2f, wh: vec2f) -> vec3f {
  let px = 1.0 / max(wh.x, wh.y);
  let L = lustre_light();
  let Ld = normalize(L.xy + vec2f(0.0, 1e-4));
  let tanEl = L.z / max(length(L.xy), 1e-3);
  let hover = P.pts[5].y;
  let sp = p + Ld * 0.3;
  let spot = 0.3 + 0.9 * exp(-dot(sp, sp) * 2.5);
  // Backdrop with the sheet's shadow: the paper seen from the light, softer the higher it floats.
  let pl = lustre_pleat(p, wh);
  let shp = lustre_pleat(p + Ld * hover / tanEl, wh);
  let shadow = 1.0 - 0.75 * (1.0 - smoothstep(-hover * 0.6, hover * 0.8, shp.sd));
  let back = lustre_col(3) * spot * shadow;
  if (pl.sd > px * 1.5) { return back; }
  let e = 0.6 * px;
  let gx = lustre_pleat(p + vec2f(e, 0.0), wh).h - lustre_pleat(p - vec2f(e, 0.0), wh).h;
  let gy = lustre_pleat(p + vec2f(0.0, e), wh).h - lustre_pleat(p - vec2f(0.0, e), wh).h;
  let N = normalize(vec3f(-gx, -gy, 2.0 * e));
  // Shadows the ridges cast across the pleats, marched toward the light.
  var sh = 1.0;
  for (var i = 1; i <= 16; i++) {
    let t = f32(i) * f32(i) * 0.0005;
    let q = lustre_pleat(p + Ld * t, wh);
    if (q.sd > 0.0) { break; }
    sh = min(sh, clamp((pl.h + t * tanEl - q.h) / (t * 0.1) + 1.0, 0.0, 1.0));
  }
  // Matte paper: diffuse from the key, a fill from above, the spot falloff, and a little occlusion
  // deep in each valley.
  let diff = max(dot(N, L), 0.0) * mix(0.12, 1.0, sh);
  let fill = 0.1 * (0.6 + 0.4 * N.z);
  let ao = mix(0.6, 1.0, smoothstep(0.0, 0.2, pl.x));
  // Faces in shade pick up light bounced off the lit face across the valley, strongest near it.
  let bounce = 0.18 * (1.0 - pl.x) * (1.0 - smoothstep(0.0, 0.3, diff));
  var c = mix(lustre_col(1), lustre_col(0), diff) * (diff + fill + bounce) * spot * ao;
  // Ridges catch a crisp line of light where their rounded crest turns toward it.
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  c += lustre_col(2) * 0.6 * pow(max(dot(N, H), 0.0), 200.0) * sh * spot * smoothstep(0.8, 0.97, pl.x);
  return mix(c, back, smoothstep(-px, px, pl.sd));
}

fn wp_lustre(uv: vec2f, wh: vec2f) -> vec3f {
  let p = (uv - 0.5) * wh / max(wh.x, wh.y);
  let mode = i32(P.pts[0].x + 0.5);
  var c = vec3f(0.0);
  switch mode {
    case 0: { c = lustre_objects(p, wh); }
    case 1: { c = lustre_brushed(p, wh); }
    case 2: { c = lustre_water(uv, wh); }
    case 3: { c = lustre_stars(p, wh); }
    case 4: { c = lustre_caustics(p, wh); }
    case 5: { c = lustre_shell(p, wh); }
    case 6: { c = lustre_filmmacro(p, wh); }
    default: { c = lustre_pleats(p, wh); }
  }
  return lustre_tone(c);
}
