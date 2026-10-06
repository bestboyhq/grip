// Streaks: a group of slanted bars caught in motion blur. Each bar is a parallelogram; the blur is
// exact, not sampled: the pixel's line along the blur direction is clipped against every bar
// (slab test) and the blur kernel's CDF integrates over that span. The kernel mixes a symmetric
// smooth bell with a one-sided exponential trail (sharp leading edge, fading tail), and each
// color channel reads it shifted along the blur, which leaves red and blue fringes like a lens.
// Coordinates are in units of the longer side (cover); portrait frames transpose the design.
// P.pts[0] = bar angle (rad, long axis), blur angle (rad), blur length, trail (0 smear .. 1 trail)
// P.pts[1] = period (bar pitch), duty (bar width / pitch), bar length, length jitter
// P.pts[2] = group offset along the bars, group half-width across them, seed, chroma (fringe shift)
// P.pts[3] = intensity (>1 burns to white), bloom, defocus (across the blur), vignette
// P.pts[4] = ground gradient angle (rad), end slant, group center x, y (frame-relative)
// P.pts[5] = stagger (bar k shifts k * pitch * stagger along its axis), brightness spread,
//   shade (falloff toward the bar's far end), sheen (bright stripe along one long edge)
// P.pts[6] = color sweep (each bar blends into the next palette color along its length), polar
//   (1 maps the plane to angle and log radius around the group center: bars become spokes, a
//   blur along them a zoom burst, a blur across them curved arcs), seam angle (rad), polar scale
// cols[0], cols[1] = ground gradient, cols[2..] = bar colors, picked per bar.

fn streaks_lin(lab: vec3f) -> vec3f {
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

fn streaks_hash(n: f32) -> f32 {
  return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

// CDF of the blur kernel at t (per channel), for blur length L: a smooth compact bell (the
// derivative of smootherstep, cheaper than a gaussian's erf) mixed with a one-sided exponential.
fn streaks_cdf(t: vec3f, L: f32, trail: f32) -> vec3f {
  let x = clamp(t / max(L * 1.6, 1e-4) + 0.5, vec3f(0.0), vec3f(1.0));
  let g = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
  let e = 1.0 - exp(-max(t, vec3f(0.0)) / max(L * 0.5, 1e-4));
  return mix(g, e, trail);
}

struct StreaksHit {
  cov: vec3f,
  col: vec3f,
  halo: vec3f,
}

const streaks_halo = 0.05;

// Motion-blurred coverage of all bars at bar-frame point (u, v) with blur direction d (bar frame),
// accumulated with their colors. Defocus: three taps offset by n across the blur, sharing the
// per-bar setup.
fn streaks_bars(u0: f32, v0: f32, d: vec2f, sk: f32, n: vec2f) -> StreaksHit {
  let A = P.pts[0];
  let B = P.pts[1];
  let G = P.pts[2];
  let F = P.pts[5];
  let L = A.z;
  let per = B.x;
  let ncol = max(i32(P.a.y) - 2, 1);
  let chroma = vec3f(-G.w, 0.6 * G.w, G.w) * L;
  // Kernel reach along t, and the bars the line crosses within it.
  let t0 = -1.1 * L;
  let t1 = 3.0 * L;
  let reach = 1.6 * streaks_halo + abs(n.x);
  let ua = min(u0 + d.x * t0, u0 + d.x * t1) - reach;
  let ub = max(u0 + d.x * t0, u0 + d.x * t1) + reach;
  let kmax = floor(G.y / per);
  let k0 = max(floor(ua / per), -kmax);
  let k1 = min(floor(ub / per), kmax);
  var hit = StreaksHit(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  let dv = d.y - d.x * sk;
  // In polar mode bar identities repeat once around the circle, so the seam cannot show.
  let W = P.pts[6];
  let ring = max(round(6.2831853 * W.w / per), 1.0);
  for (var kr = k0; kr <= k1 && kr < k0 + 40.0; kr += 1.0) {
    let k = select(kr, kr - ring * floor(kr / ring), W.y > 0.5);
    let h0 = streaks_hash(k + G.z * 17.0);
    let h1 = streaks_hash(k * 1.7 + G.z * 31.0 + 5.0);
    let h2 = streaks_hash(k * 2.3 + G.z * 7.0 + 9.0);
    let w = per * B.y * (0.55 + 0.9 * h1);
    let lo = kr * per + (per - min(w, per)) * h2;
    let hi = lo + min(w, per * 0.98);
    let len = B.z * (1.0 - B.w * h0);
    let vc = G.x + kr * per * F.x + (h2 - 0.5) * B.w * B.z * 0.8;
    // Bars fade out toward the group's edges.
    let uc = (kr + 0.5) * per / max(G.y, 1e-4);
    let env = exp(-uc * uc * uc * uc) * (1.0 - F.y * streaks_hash(k * 3.1 + G.z));
    let pick = min(i32(floor(streaks_hash(k * 5.3 + G.z * 3.0) * f32(ncol))), ncol - 1);
    let c0 = P.cols[2 + pick].xyz;
    let c1 = P.cols[2 + (pick + 1) % ncol].xyz;
    let lin0 = streaks_lin(c0);
    let lin1 = streaks_lin(c1);
    // Each bar moves at its own speed.
    let Lk = L * (0.6 + 0.8 * streaks_hash(k * 4.7 + G.z * 11.0));
    // Bloom: a gaussian of the distance to the bar. Sheared frame: the bar ends follow the slant,
    // so the bar is an axis-aligned box there.
    let vs0 = v0 - u0 * sk;
    let q = max(abs(vec2f(u0 - (lo + hi) * 0.5, vs0 - vc)) - vec2f((hi - lo) * 0.5, len * 0.5), vec2f(0.0));
    hit.halo += mix(lin0, lin1, 0.5 * P.pts[6].x) * env * exp(-dot(q, q) / (streaks_halo * streaks_halo));
    for (var j = -1; j <= 1; j++) {
      let tw = select(0.25, 0.5, j == 0) * env;
      let uj = u0 + n.x * f32(j);
      let vs = v0 + n.y * f32(j) - uj * sk;
      var tl = -1e9;
      var th = 1e9;
      if (abs(d.x) > 1e-6) {
        let a = (lo - uj) / d.x;
        let b = (hi - uj) / d.x;
        tl = max(tl, min(a, b));
        th = min(th, max(a, b));
      } else if (uj < lo || uj > hi) { continue; }
      if (abs(dv) > 1e-6) {
        let a = (vc - len * 0.5 - vs) / dv;
        let b = (vc + len * 0.5 - vs) / dv;
        tl = max(tl, min(a, b));
        th = min(th, max(a, b));
      } else if (abs(vs - vc) > len * 0.5) { continue; }
      if (th <= tl || tl > t1 * 1.4 || th < t0 * 1.4) { continue; }
      let cv = max(streaks_cdf(vec3f(th) - chroma, Lk, A.w) - streaks_cdf(vec3f(tl) - chroma, Lk, A.w), vec3f(0.0)) * tw;
      // Surface light, read where the blur kernel peaks inside the bar: a falloff along the bar,
      // a sheen near one long edge, and an optional color sweep.
      let ts = clamp(0.0, tl, th);
      let sv = clamp((vs + dv * ts - vc) / len, -0.5, 0.5) + 0.5;
      let su = clamp((uj + d.x * ts - lo) / (hi - lo), 0.0, 1.0);
      let lum = 1.0 - F.z * (1.0 - sv) * (1.0 - sv) + F.w * exp(-(su - 0.8) * (su - 0.8) * 60.0);
      hit.cov += cv;
      hit.col += cv * lum * mix(lin0, lin1, sv * P.pts[6].x);
    }
  }
  return hit;
}

fn wp_streaks(uv0: vec2f, wh0: vec2f) -> vec3f {
  // Portrait frames see the landscape design mirrored across the diagonal, so the group always
  // runs along the frame's long axis.
  let tall = wh0.y > wh0.x;
  let uv = select(uv0, uv0.yx, tall);
  let wh = select(wh0, wh0.yx, tall);
  let asp = wh / max(wh.x, wh.y);
  let A = P.pts[0];
  let D = P.pts[3];
  let E = P.pts[4];
  var p = (uv - E.zw) * asp;
  let W = P.pts[6];
  if (W.y > 0.5) {
    let cs = cos(W.z);
    let sn = sin(W.z);
    p = vec2f(log(max(length(p), 1e-4)), atan2(-sn * p.x + cs * p.y, cs * p.x + sn * p.y)) * W.w;
  }

  // Ground: a soft two-color gradient with a vignette.
  let gd = vec2f(cos(E.x), sin(E.x));
  let gt = smoothstep(-0.6, 0.6, dot((uv - 0.5) * asp, gd));
  var ground = streaks_lin(mix(P.cols[0].xyz, P.cols[1].xyz, gt));
  let vr = (uv - 0.5) * asp * 2.0;
  ground *= 1.0 - D.w * smoothstep(0.3, 1.6, dot(vr, vr));

  // Bar frame: u across the bars, v along them.
  let ca = cos(A.x);
  let sa = sin(A.x);
  let u = -sa * p.x + ca * p.y;
  let v = ca * p.x + sa * p.y;
  let bd = vec2f(cos(A.y), sin(A.y));
  let d = vec2f(-sa * bd.x + ca * bd.y, ca * bd.x + sa * bd.y);
  let h = streaks_bars(u, v, d, E.y, vec2f(-d.y, d.x) * D.z * 0.7);
  let occ = clamp(h.cov, vec3f(0.0), vec3f(1.0));
  var c = ground * (1.0 - occ) + (h.col + h.halo * D.y) * D.x;
  // Soft shoulder that spills overexposure into the other channels, so hot bars go white.
  let over = max(c - 0.8, vec3f(0.0));
  c += (over.x + over.y + over.z) * 0.25;
  c = select(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), c > vec3f(0.8));
  return encodeSrgb(c);
}
