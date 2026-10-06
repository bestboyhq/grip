// Silk: draped satin sheets stacked back to front. Each sheet fills the far side of a wavy edge
// curve, rolls over at that edge, and carries soft folds that follow it. Shading is physical in
// spirit: a real normal from the height field, wrapped diffuse, anisotropic Ward specular with the
// threads running across the folds (satin streaks along the crests), crease and gap occlusion, and
// a thin-film tint whose hue shifts with the view angle and the film thickness.
// Works in pattern space: p relative to the longer side, rotated by the angle; s along the sheets,
// t across them (sheets fill t > edge).
// P.pts[0] = angle (rad), seed, sheet count (1..5), view perspective
// P.pts[1] = light azimuth (rad, 0 = from -t), light elevation (rad), specular amount, roughness
// P.pts[2] = fold amplitude, fold frequency, fold skew (-1..1, drapes vs dunes), cross folds
// P.pts[3] = lip radius, gap occlusion, gap radius, depth fade (brightness of the backmost sheet)
// P.pts[4] = film amount, film scale, film phase, grazing sheen
// P.pts[5] = ambient, exposure, backdrop glow (soft light on the void), crease occlusion
// P.pts[6] = broad specular lobe amount, its roughness, fold fan (spacing change along s), specular tint
// P.pts[7 + i] = sheet i (up to 5): edge offset, slope, wave amplitude, wave frequency
// Colors: 0 = void behind all sheets, 1 = fabric, 2.. = thin-film hues (cycled).

fn silk_lin(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return max(vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ), vec3f(0.0));
}

// Taller frames than 16:9 (along t) spread the sheet edges over the extra height, so the stack
// fills portrait frames. Edges at +-0.9 mark sheets that fill the frame and stay put.
var<private> silk_spread: f32;

// Distance into sheet i, roughly perpendicular to its edge (positive on the sheet).
fn silk_depth(i: i32, q: vec2f) -> f32 {
  let e = P.pts[7 + i];
  let ph = P.pts[0].y * 1.7 + f32(i) * 2.39;
  let a = e.w * q.x + ph;
  let b = e.w * 2.13 * q.x - ph * 1.3 + 0.8;
  let edge = clamp(e.x * silk_spread, -0.9, 0.9) + e.y * q.x + e.z * (sin(a) + 0.35 * sin(b));
  let slope = e.y + e.z * e.w * (cos(a) + 0.745 * cos(b));
  return (q.y - edge) * inverseSqrt(1.0 + slope * slope);
}

// Height of sheet i: a rounded lip at the edge plus folds running along it.
fn silk_height(i: i32, q: vec2f) -> f32 {
  let d = silk_depth(i, q);
  let r = P.pts[3].x;
  let x = clamp(d / max(r, 1e-4), 0.0, 1.0);
  // Quarter-round lip, softened at the very edge so the normal stays finite.
  let lip = r * (sqrt(x * (2.0 - x) + 0.03) - 0.1732) / 0.8418;
  let f = P.pts[2];
  let seed = P.pts[0].y + f32(i) * 1.618;
  let k = f.z;
  // Folds fan out away from the edge and their phase wanders along it, so no two are alike.
  let dd = d / (1.0 + 0.35 * d) * max(1.0 + P.pts[6].z * q.x, 0.2);
  let u1 = dd * f.y + 1.4 * sin(q.x * f.y * 0.29 + seed) + 0.5 * sin(q.x * f.y * 0.71 - seed * 2.1);
  let u2 = dd * f.y * 1.83 + 1.1 * sin(q.x * f.y * 0.47 - seed * 1.3) + seed * 2.7;
  let u3 = q.x * f.y * 0.43 + 1.2 * sin(dd * f.y * 0.37 + seed * 0.7) + seed;
  let env = 0.65 + 0.35 * sin(q.x * f.y * 0.19 + dd * f.y * 0.11 + seed * 3.1);
  var h = sin(u1 + k * sin(u1)) * env;
  h += 0.38 * sin(u2 + k * sin(u2)) * (1.0 - 0.5 * env);
  h += f.w * sin(u3);
  return lip + f.x * h;
}

// Thin-film hue: cycle through colors 2.. in OKLab with a smooth blend.
fn silk_film(phase: f32) -> vec3f {
  let n = i32(P.a.y) - 2;
  if (n < 1) { return P.cols[min(1, i32(P.a.y) - 1)].xyz; }
  let x = fract(phase) * f32(n);
  let i = i32(floor(x)) % n;
  let j = (i + 1) % n;
  let w = smoothstep(0.0, 1.0, fract(x));
  return mix(P.cols[2 + i].xyz, P.cols[2 + j].xyz, w);
}

fn wp_silk(uv: vec2f, wh: vec2f) -> vec3f {
  let g0 = P.pts[0];
  let p = (uv - 0.5) * wh / max(wh.x, wh.y);
  let ca = cos(g0.x);
  let sa = sin(g0.x);
  let q = vec2f(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  let n = clamp(i32(g0.z), 1, 5);
  let half = 0.5 * wh / max(wh.x, wh.y);
  silk_spread = max((abs(sa) * half.x + abs(ca) * half.y) / (abs(sa) * 0.5 + abs(ca) * 0.28125), 1.0);

  var top = -1;
  for (var i = 0; i < n; i++) {
    if (silk_depth(i, q) > 0.0) { top = i; }
  }
  let l1 = P.pts[1];
  let L = normalize(vec3f(cos(l1.y) * vec2f(sin(l1.x), -cos(l1.x)), sin(l1.y)));
  let w2 = P.pts[6];
  let fm = P.pts[4];
  let film0 = silk_lin(silk_film(fm.z));
  let tint = mix(vec3f(1.0), film0 / max(max(film0.r, max(film0.g, film0.b)), 1e-3), w2.w);

  // Sheets in front darken the gap above their edge, more on the side away from the light.
  let o = P.pts[3];
  var gap = 1.0;
  for (var j = top + 1; j < n; j++) {
    let dj = silk_depth(j, q - L.xy * o.z * 0.6);
    gap *= 1.0 - o.y * exp(min(dj, 0.0) / max(o.z, 1e-4));
  }
  if (top < 0) {
    // Backdrop: a soft pool of the key light on the far wall, so empty space reads as lit, not unfinished.
    let r = q - normalize(L.xy + vec2f(0.0, 1e-4)) * 0.42;
    let glow = P.pts[5].z * (0.6 * exp(-dot(r, r) * 4.0) + 0.4 * exp(-dot(r, r) * 1.2));
    let c = (silk_lin(P.cols[0].xyz) + glow * tint) * gap;
    return encodeSrgb(clamp(c, vec3f(0.0), vec3f(1.0)));
  }

  // Normal from central differences on this sheet only, so neighbors never leak into it.
  let e = 0.6 / max(wh.x, wh.y) + 2e-4;
  let h0 = silk_height(top, q);
  let gx = silk_height(top, q + vec2f(e, 0.0)) - silk_height(top, q - vec2f(e, 0.0));
  let gy = silk_height(top, q + vec2f(0.0, e)) - silk_height(top, q - vec2f(0.0, e));
  let N = normalize(vec3f(-gx / (2.0 * e), -gy / (2.0 * e), 1.0));
  let V = normalize(vec3f(-q * g0.w, 1.0));
  let H = normalize(L + V);
  let nl = dot(N, L);
  let nv = max(dot(N, V), 1e-3);

  // Crease occlusion: how far the surface sits below its neighborhood average.
  let f = P.pts[2];
  let rr = 0.9 / max(f.y, 1.0);
  let hb = 0.25 * (silk_height(top, q + vec2f(rr, 0.0)) + silk_height(top, q - vec2f(rr, 0.0))
    + silk_height(top, q + vec2f(0.0, rr)) + silk_height(top, q - vec2f(0.0, rr)));
  let crease = clamp(exp(-P.pts[5].w * (hb - h0) * f.y), 0.0, 1.25);

  let fade = select(1.0, mix(o.w, 1.0, f32(top) / f32(max(n - 1, 1))), n > 1);

  // Thin film: thickness varies slowly over the cloth; the path through it grows at grazing view.
  let seed = g0.y;
  let thick = 0.5 * sin(q.x * 2.3 + seed) + 0.35 * sin(q.y * 3.1 - q.x * 1.2 + seed * 1.9) + h0 * f.y * 0.25;
  let filmLab = silk_film(fm.y * (thick + 1.4 * (1.0 - nv)) + fm.z);
  let film = silk_lin(filmLab);
  let fabric = silk_lin(P.cols[1].xyz);
  // Light bouncing inside the folds saturates the film color in the shade, so shadows stay clean.
  let deep = silk_lin(vec3f(filmLab.x * 0.97, filmLab.yz * 1.5));

  // Anisotropic Ward specular, threads across the folds: highlights stretch along the crests.
  let T = normalize(vec3f(0.0, 1.0, 0.0) - N * N.y);
  let B = cross(N, T);
  let ax = l1.w;
  let ay = l1.w * 3.5;
  let nh = max(dot(N, H), 1e-3);
  let ht = dot(H, T) / ax;
  let hbn = dot(H, B) / ay;
  let nlc = max(nl, 0.0);
  let norm = nlc / (12.566 * sqrt(max(nlc * nv, 1e-3)));
  // A tight core over a broad lobe: the soft glow of satin around its streaks.
  let bx = ax * w2.y;
  let by = ay * w2.y;
  let bt = dot(H, T) / bx;
  let bb = dot(H, B) / by;
  let ward = norm * (exp(-(ht * ht + hbn * hbn) / (nh * nh)) / (ax * ay) + w2.x * exp(-(bt * bt + bb * bb) / (nh * nh)) / (bx * by));
  let specCol = mix(vec3f(1.0), film / max(max(film.r, max(film.g, film.b)), 1e-3), w2.w);

  let amb = P.pts[5].x;
  let diffuse = amb + (1.0 - amb) * max((nl + 0.25) / 1.25, 0.0);
  let sheen = fm.w * pow(1.0 - nv, 3.0);
  let shade = clamp(diffuse * crease, 0.0, 1.0);
  let albedo = mix(mix(fabric, film, fm.x), deep, fm.x * 0.5 * (1.0 - shade));
  var c = albedo * diffuse * crease + specCol * (l1.z * ward) * min(crease, 1.0) + film * sheen;
  c *= gap * fade * P.pts[5].y;
  // Soft shoulder keeps highlights from clipping flat.
  let knee = 0.8;
  c = select(c, knee + (1.0 - knee) * (1.0 - exp(-(c - knee) / (1.0 - knee))), c > vec3f(knee));
  return encodeSrgb(clamp(c, vec3f(0.0), vec3f(1.0)));
}
