// Aurora: soft gradients with structure. A palette ramp (gaussian-weighted stops in OKLab, so
// blends stay clean) is read along a coordinate that mixes a linear sweep with a conic sweep around
// a focal point (the cosine of the angle to an axis, smooth everywhere, no seam), over gently
// folded space. On top: up to two aurora curtains (sharp lower hem, rays, uneven reach), glow lobes that can stretch into banded light
// leaks, a prism beam fanning into a spectrum, and a broad sheen, all added as light in linear space.
// Coordinates are in units of the frame's geometric mean side (shapes keep at any aspect ratio).
// P.pts[0] = conic amount (0 linear .. 1 conic), sweep angle (rad), focal x, y (frame-relative)
// P.pts[1] = warp, warp frequency, seed, ramp softness
// P.pts[2] = ramp stop count, conic twist, sheen, sheen angle
// P.pts[3], P.pts[7] = curtain y (frame-relative), curve, thickness, intensity
// P.pts[4] = curtain tail (upward reach / thickness), rays, ray frequency, tilt (both curtains)
// P.pts[5], P.pts[6] = glow lobe x, y (frame-relative), radius, intensity
// P.pts[8] = prism origin x, y (frame-relative), beam angle (rad), fan spread
// P.pts[9] = prism beam width, intensity (0 off), reach, hue shift
// P.pts[10] = lobe stretch angle (rad), stretch, band frequency, band amount
// cols[0..n) = ramp stops, cols[n] = curtain core, cols[n + 1] = curtain tail (the second curtain
// swaps them), cols[n + 2], cols[n + 3] = glow lobes.

fn aurora_lin(lab: vec3f) -> vec3f {
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

fn aurora_ramp(t: f32, n: i32, soft: f32) -> vec3f {
  var acc = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0; i < n; i++) {
    let dt = t - f32(i) / f32(max(n - 1, 1));
    let w = exp(-dt * dt / (soft * soft)) + 1e-6;
    acc += P.cols[i].xyz * w;
    sum += w;
  }
  return acc / sum;
}

fn wp_aurora(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let A = P.pts[0];
  let W = P.pts[1];
  let R = P.pts[2];
  let n = i32(R.x);

  var p = (uv - 0.5) * unit;
  p += W.x * vec2f(sin(p.y * W.y + W.z), sin(p.x * W.y * 0.83 + W.z * 1.7));
  p += W.x * 0.4 * vec2f(sin(p.y * W.y * 2.1 + W.z * 2.9), sin(p.x * W.y * 1.7 - W.z));

  // Ramp coordinate: linear sweep, conic sweep, or a blend.
  let dir = vec2f(cos(A.y), sin(A.y));
  // The end stops own the far corners rather than meeting there.
  let lin = clamp(dot(p, dir) / (0.75 * (abs(unit.x * dir.x) + abs(unit.y * dir.y))) + 0.5, 0.0, 1.0);
  let f = p - (A.zw - 0.5) * unit;
  let th0 = atan2(dot(f, vec2f(-dir.y, dir.x)), dot(f, dir));
  let con = 0.5 - 0.5 * cos(th0 + R.y * sin(th0));
  // Near the focal point the conic sweep pinches; soften it toward the linear ramp there.
  let pinch = smoothstep(0.0, 0.35, length(f));
  let t = mix(lin, con, A.x * pinch);
  var c = aurora_lin(aurora_ramp(t, n, max(W.w, 0.05)));

  // Aurora curtains: a sharp lower hem and rays rising to uneven heights.
  let T = P.pts[4];
  for (var ci = 0; ci < 2; ci++) {
    let B = P.pts[select(7, 3, ci == 0)];
    if (B.w <= 0.0) { continue; }
    let ph = W.z + f32(ci) * 2.7;
    let x = p.x;
    let yb = (B.x - 0.5) * unit.y + B.y * sin(x * 2.3 + ph) + B.y * 0.4 * sin(x * 5.1 - ph * 1.3) + T.w * x;
    let dy = p.y - yb;
    // Thin bright rays across the curtain, and a slower swell in how high it reaches.
    let ray = 0.5 + 0.5 * sin(x * T.z + 1.7 * sin(x * T.z * 0.37 + ph));
    let ray2 = 0.5 + 0.5 * sin(x * T.z * 2.3 + ph * 1.3 + 2.0 * sin(x * T.z * 0.21 - ph));
    let rays = mix(1.0, 0.35 + 0.65 * ray * ray * ray * (0.5 + 0.5 * ray2) + 0.2 * ray2, T.y);
    let swell = 0.5 + 0.5 * sin(x * T.z * 0.13 + ph * 0.7 + 1.3 * sin(x * T.z * 0.05 + ph));
    let up = B.z * T.x * mix(1.0, 0.45 + 0.9 * swell, T.y);
    // The second, farther curtain has a hazier hem, so it never leaves a dark seam below it.
    let hem = B.z * select(1.0, 4.0, ci == 1);
    let th = select(hem, up, dy < 0.0);
    let band = exp(-dy * dy / (th * th)) * rays;
    let core = aurora_lin(P.cols[n + ci].xyz);
    let tail = aurora_lin(P.cols[n + 1 - ci].xyz);
    let k = smoothstep(-up, hem, dy);
    c += B.w * band * mix(tail, core, k);
  }

  // Glow lobes; stretched and banded they read as light leaks entering from an edge.
  let S = P.pts[10];
  let sdir = vec2f(cos(S.x), sin(S.x));
  for (var i = 0; i < 2; i++) {
    let g = P.pts[5 + i];
    if (g.z <= 0.0) { continue; }
    let d0 = p - (g.xy - 0.5) * unit;
    let d = vec2f(dot(d0, sdir) / max(S.y, 1.0), dot(d0, vec2f(-sdir.y, sdir.x)));
    let bands = 1.0 - S.w + S.w * (0.5 + 0.5 * cos(d.y * S.z + 1.3 * sin(d.x * S.z * 0.4)));
    c += g.w * exp(-dot(d, d) / (g.z * g.z)) * bands * aurora_lin(P.cols[n + 2 + i].xyz);
  }

  // Prism: a white beam enters at the origin and leaves fanned into a spectrum.
  let Q = P.pts[8];
  let Z = P.pts[9];
  if (Z.y > 0.0) {
    let o = p - (Q.xy - 0.5) * unit;
    let bdir = vec2f(cos(Q.z), sin(Q.z));
    let a = dot(o, bdir);
    let b = dot(o, vec2f(-bdir.y, bdir.x));
    let wd = Z.x + max(a, 0.0) * Q.w;
    let sp = b / (2.0 * wd) + 0.5;
    let fan = smoothstep(0.0, 0.18, sp) * smoothstep(1.0, 0.82, sp) * smoothstep(-0.01, 0.03, a) * exp(-max(a, 0.0) / Z.z) * sqrt(Z.x / wd);
    let h = Z.w + 0.45 + clamp(sp, 0.0, 1.0) * 4.6;
    c += Z.y * fan * aurora_lin(vec3f(0.78, 0.16 * cos(h), 0.16 * sin(h)));
    // Incoming white beam, bent a little against the fan.
    let idir = vec2f(cos(Q.z - 0.4), sin(Q.z - 0.4));
    let ia = dot(o, idir);
    let ib = dot(o, vec2f(-idir.y, idir.x));
    c += Z.y * 0.9 * exp(-ib * ib / (Z.x * Z.x * 0.25)) * smoothstep(0.02, -0.01, ia) * exp(ia / (Z.z * 1.5)) * vec3f(1.0);
  }

  // Sheen: a broad soft highlight, bowed and folded with the plane so it never reads as a stripe.
  let sd = vec2f(cos(R.w), sin(R.w));
  let sh = dot(p, sd) + 0.25 * dot(p, vec2f(-sd.y, sd.x)) * dot(p, vec2f(-sd.y, sd.x));
  c += R.z * exp(-sh * sh / 0.05) * vec3f(1.0);

  // Soft shoulder so added light never clips flat.
  c = select(c, 1.0 - 0.25 * exp(-(c - 0.75) / 0.25), c > vec3f(0.75));
  return encodeSrgb(c);
}
