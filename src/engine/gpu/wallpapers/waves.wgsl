// Waves: glossy satin forms painted back to front in linear light. Each layer is a band around a
// flowing curve; it twists about its axis (the band narrows and its normal turns), bulges across
// its width, and rolls over at its edges, so a Blinn-Phong highlight runs along the folds. Each
// layer shadows what lies behind it. The same layers drawn in other coordinate frames make the
// other motifs: concentric rings, domes and crowns, radiating petals, and a spiral curl.
// P.pts[0] = flow angle (deg), seed, layer count (<= 6), wave frequency (cycles per unit)
// P.pts[1] = light angle (deg, 0 = from the right, 90 = from below), gloss, curl, shadow
// P.pts[2] = color drift along the flow, depth blur (back layers), twist, haze (back layers)
// P.pts[3] = glow x, y (frame-relative), glow radius, background angle (deg)
// P.pts[4] = frame mode (0 linear, 1 rings, 2 rays, 3 spiral, 4 dome), center x, y (frame-relative,
//   overshoot past an edge in longer-side units; modes 1-4), shape (< 0 folds the curve into flat facets)
// P.pts[5] = strands per layer (0 = solid bands), opacity (< 1 = glass), taper length (0 = none),
//   scale (rings, dome: arc length per radian; rays: petal count; spiral: pitch)
// P.pts[6 + i] = layer i: offset across the flow (a radius in modes 1, 3, 4), amplitude, width,
//   ramp position. Width < 0 is a light streak that thick (with strands: a bundle of glowing
//   threads that wide); width >= 1 is a sheet filling everything below the curve. Lengths are
//   fractions of the longer side.
// Colors: 0, 1 = background start, end; 2 = glow; 3.. = the ramp the layers sample.

const WAVES_TAU = 6.2831853;

fn waves_hash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// OKLab -> linear sRGB (unclamped; callers clamp at the end).
fn waves_lin(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
}

// Palette ramp over colors 3.., eased between stops so no stop shows as a crease. OKLab out.
fn waves_ramp(t: f32) -> vec3f {
  let m = i32(P.a.y) - 3;
  if (m <= 1) { return P.cols[min(3, i32(P.a.y) - 1)].xyz; }
  let x = clamp(t, 0.0, 1.0) * f32(m - 1);
  let i = min(i32(x), m - 2);
  let f = smoothstep(0.0, 1.0, x - f32(i));
  return mix(P.cols[3 + i].xyz, P.cols[4 + i].xyz, f);
}

fn waves_rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x + s * v.y, -s * v.x + c * v.y);
}

// One harmonic and its derivative. shape < 0 straightens it toward a triangle wave with
// rounded creases: flat facets joined by soft folds, like folded paper. It keeps sin's extremes,
// so blends stay aligned.
fn waves_wave(u: f32, shape: f32) -> vec2f {
  // asin(k sin u) / asin(k): a triangle wave whose corners round off as k drops below 1.
  let k = 0.94;
  let su = sin(u);
  let n = 1.0 / asin(k);
  return mix(vec2f(su, cos(u)), vec2f(asin(k * su) * n, k * cos(u) * n / sqrt(1.0 - k * k * su * su)), -shape);
}

// Layer curve and its slope at x: three harmonics whose ratios and the third's weight k come
// from the layer's hash, so seeds give distinct shapes, not just phases.
struct WavesCurve { y: f32, dy: f32 }

fn waves_curve(x: f32, o: f32, a: f32, f: f32, ph: vec3f, k: f32) -> WavesCurve {
  let shape = min(P.pts[4].w, 0.0);
  let w1 = f * WAVES_TAU;
  let w2 = w1 * (1.7 + 0.9 * fract(k * 7.0));
  let w3 = w1 * (3.3 + 0.8 * fract(k * 13.0));
  let v1 = waves_wave(w1 * x + ph.x, shape);
  let v2 = waves_wave(w2 * x + ph.y, shape);
  let v3 = waves_wave(w3 * x + ph.z, shape);
  // Folds keep only the fundamental: folded overtones stack into stair steps, not paper.
  let o2 = 0.38 * (1.0 + shape);
  let o3 = k * (1.0 + shape);
  let n = a / (1.0 + o2 + o3);
  return WavesCurve(o + n * (v1.x + o2 * v2.x + o3 * v3.x), n * (w1 * v1.y + o2 * w2 * v2.y + o3 * w3 * v3.y));
}

// Soft highlight rolloff so specular peaks saturate instead of clipping flat.
fn waves_shoulder(c: vec3f) -> vec3f {
  let k = 0.78;
  return select(c, k + (1.0 - k) * (1.0 - exp(-(c - k) / (1.0 - k))), c > vec3f(k));
}

// The layer frame at p: q = (along, across) and the screen directions of both axes, so lighting
// stays right as rings and rays turn.
struct WavesFrame { q: vec2f, ex: vec2f, ey: vec2f }

fn waves_frame(p: vec2f, asp: vec2f, flow: f32) -> WavesFrame {
  let mode = i32(P.pts[4].x);
  if (mode == 0) {
    return WavesFrame(waves_rot(p, flow), vec2f(cos(flow), sin(flow)), vec2f(-sin(flow), cos(flow)));
  }
  // Polar around the center; angle 0 points along the flow, so the seam at +-180 deg can be
  // aimed off frame.
  // Inside the frame the center is frame-relative, so corners stay corners at any aspect;
  // beyond an edge the overshoot is in longer-side units, so off-frame centers keep their reach.
  let cf = clamp(P.pts[4].yz, vec2f(0.0), vec2f(1.0));
  let d = p - (cf - 0.5) * asp - (P.pts[4].yz - cf);
  let r = length(d) + 1e-6;
  let rad = d / r;
  let tng = vec2f(-rad.y, rad.x);
  let dr = waves_rot(d, flow);
  let th = atan2(dr.y, dr.x);
  let sc = P.pts[5].w;
  if (mode == 2) {
    // Rays: along = radius; across = angle, folded into sc identical sectors when sc >= 1.
    let n = max(sc, 1.0);
    let ths = select(th, (fract(th * n / WAVES_TAU + 0.5) - 0.5) * WAVES_TAU / n, sc >= 1.0);
    return WavesFrame(vec2f(r, ths * 0.5), rad, tng);
  }
  if (mode == 3) {
    return WavesFrame(vec2f(th * 0.5, r - sc * th / WAVES_TAU), tng, rad);
  }
  if (mode == 4) {
    return WavesFrame(vec2f(th * sc, -r), tng, -rad);
  }
  return WavesFrame(vec2f(th * sc, r), tng, rad);
}

// One band around a curve: its lit color, specular light, coverage, and the shadow it casts here.
struct WavesHit { col: vec3f, spec: vec3f, cov: f32, shadow: f32 }

fn waves_hit(q: vec2f, off: f32, amp: f32, f: f32, ph: vec3f, k: f32, hw0: f32, tw: f32, sheet: bool,
             edge: f32, z: f32, L: vec3f, H: vec3f, t: f32, haze: f32) -> WavesHit {
  var hit: WavesHit;
  // Past a quarter turn the band shows its back face. face eases from front (1) to back (-1)
  // across a narrow band around the fold, so the turn reads as a smooth bend, not a facet.
  let ct = cos(tw);
  let face = smoothstep(-0.14, 0.14, ct) * 2.0 - 1.0;
  let fold = 1.0 - smoothstep(0.0, 0.3, abs(ct));
  let hw = select(hw0 * sqrt(ct * ct + 0.006), 4.0, sheet);
  let o = off + select(0.0, hw, sheet);
  let sh = -L.xy * 0.035 * z;
  let shc = waves_curve(q.x - sh.x, o, amp, f, ph, k);
  let shd = (hw - abs(q.y - sh.y - shc.y)) / sqrt(1.0 + shc.dy * shc.dy);
  // The shadow's soft reach would outlive a tapered band's tip, so it fades with the width.
  hit.shadow = smoothstep(-0.05 * z, 0.03 * z, shd) * select(smoothstep(0.0, 0.03 * z, hw0), 1.0, sheet);

  let c = waves_curve(q.x, o, amp, f, ph, k);
  let dy = q.y - c.y;
  let dist = (hw - abs(dy)) / sqrt(1.0 + c.dy * c.dy);
  hit.cov = smoothstep(-edge, edge, dist);
  if (hit.cov <= 0.0) { return hit; }

  // Across position -1..1: a band's width, or a sheet's face curving down from its crest.
  let s = select(clamp(dy / max(hw, 1e-4), -1.0, 1.0), clamp(dist / (0.3 * z), 0.0, 1.0) * 2.0 - 1.0, sheet);
  // Rolled edge width; paper folds get a thin crisp edge instead of a rounded rim.
  let rim = select(select(0.02, 0.035, sheet), 0.006, P.pts[4].w < -0.5);
  let bev = 1.0 - clamp(dist / min(hw, rim * z), 0.0, 1.0);
  let across = face * sin(tw) + s * P.pts[1].z + sign(dy) * bev * bev * 1.6;
  // Folded facets tilt with their slope, so each facet takes its own flat shade.
  let lean = 0.35 + 0.9 * max(-P.pts[4].w, 0.0);
  let N = normalize(vec3f(-c.dy * lean, across, max(abs(ct), 0.3)));
  let dif = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  let nh = max(dot(N, H), 0.0);
  // The fold catches a soft sheen of its own: the bent surface faces the light somewhere on it.
  let spec = pow(nh, 90.0) + 0.18 * pow(nh, 9.0) + 0.45 * fold * dif;

  var lab = waves_ramp(t + P.pts[2].x * q.x + 0.06 * s + (0.5 - 0.5 * face) * 0.22);
  lab = mix(lab, mix(P.cols[0].xyz, P.cols[1].xyz, 0.5), haze);
  let base = waves_lin(lab);
  hit.col = base * (0.28 + 0.95 * dif * dif);
  hit.spec = mix(vec3f(1.0), base * 2.0, 0.25) * spec * P.pts[1].y;
  return hit;
}

// A glowing thread along a curve: a white-hot core inside a halo of the ramp color. A dim white
// halo over a dark ground reads as gray haze, so the halo keeps a hue: the ramp's, or the glow
// color's where the ramp is near white.
fn waves_thread(q: vec2f, c: WavesCurve, th: f32, edge: f32, t: f32) -> vec3f {
  let d = abs(q.y - c.y) / sqrt(1.0 + c.dy * c.dy);
  let core = exp(-(d * d) / (th * th + edge * edge));
  let halo = exp(-d / (th * 9.0 + edge));
  let rl = waves_ramp(t);
  let hab = mix(P.cols[2].yz, rl.yz, smoothstep(0.02, 0.08, length(rl.yz)));
  let hc = max(waves_lin(vec3f(0.72, hab * 1.25)), vec3f(0.0));
  return mix(waves_lin(rl), vec3f(1.0), 0.6) * core * 1.1 + hc * halo * 0.45;
}

fn wp_waves(uv: vec2f, wh: vec2f) -> vec3f {
  let asp = wh / max(wh.x, wh.y);
  let p = (uv - 0.5) * asp;
  let px = 1.0 / max(wh.x, wh.y);
  let g0 = P.pts[0];
  let g1 = P.pts[1];
  let g2 = P.pts[2];
  let g3 = P.pts[3];
  let g5 = P.pts[5];
  let mode = i32(P.pts[4].x);
  let flow = radians(g0.x);
  let seed = g0.y;
  let n = i32(clamp(g0.z, 1.0, 6.0));
  let fr = waves_frame(p, asp, flow);
  let q = fr.q;
  // Portrait: shrink every layer by z (offsets stay), so a tall frame shows slimmer bands and
  // more waves along the flow instead of a few fat ones.
  let z = sqrt(min(1.0, wh.x / wh.y));

  // Background: a two color gradient with a soft glow, in OKLab.
  let bd = waves_rot(vec2f(0.0, 1.0), -radians(g3.w));
  let span = abs(asp.x * bd.x) + abs(asp.y * bd.y);
  let bt = clamp(dot(p, bd) / span + 0.5, 0.0, 1.0);
  var bg = mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 1.0, bt));
  let gd = p - (g3.xy - 0.5) * asp;
  bg = mix(bg, P.cols[2].xyz, select(0.0, exp(-dot(gd, gd) / (g3.z * g3.z)), g3.z > 0.0));
  var acc = waves_lin(bg);

  // Screen light (y down, view along +z) expressed in the layer frame at this pixel.
  let la = radians(g1.x);
  let Ls = normalize(vec3f(cos(la), sin(la), 1.1));
  let L = vec3f(dot(Ls.xy, fr.ex), dot(Ls.xy, fr.ey), Ls.z);
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let op = select(g5.y, 1.0, g5.y <= 0.0);
  // Light emitted by threads, kept apart so later shadows cannot dim it to gray; only layers in
  // front occlude it.
  var glow = vec3f(0.0);

  for (var i = 0; i < n; i++) {
    let lp = P.pts[6 + i];
    let fi = f32(i);
    let depth = select(1.0 - fi / f32(n - 1), 0.0, n == 1); // 1 = backmost
    let h1 = waves_hash(seed + fi * 7.31);
    let h2 = waves_hash(seed + fi * 3.17 + 11.0);
    let h3 = waves_hash(seed + fi * 5.53 + 23.0);
    let h4 = waves_hash(seed + fi * 9.71 + 37.0);
    let h5 = waves_hash(seed + fi * 2.39 + 51.0);
    let f = g0.w * (0.75 + 0.5 * h1) / z;
    let ph3 = vec3f(h2, h3, h5) * WAVES_TAU;
    let k = 0.4 * h5 * h5;
    let amp = lp.y * z;
    let edge = px * 0.9 + g2.y * depth;
    let haze = g2.w * depth;
    let env = smoothstep(-0.2, 0.9, sin(q.x * WAVES_TAU * f * 0.6 + h4 * WAVES_TAU));

    // Taper: the band swells and closes over a length along the flow, widest a third of the
    // way in (teardrop petals). Linear frames start it at the frame's back edge.
    var tp = 1.0;
    if (g5.z > 0.0) {
      let tl = g5.z * (0.8 + 0.4 * h4);
      let tu = clamp((q.x - select(-0.55, 0.0, mode == 2)) / tl, 0.0, 1.0);
      // max: sin(pi) rounds just below 0, and pow of a negative is NaN.
      tp = pow(max(sin(3.1415927 * pow(tu, 0.7)), 0.0), 0.6);
    }

    if (g5.x >= 1.0) {
      // A bundle of thin strands spread across the layer's width: glossy tubes, or glowing
      // threads (fiber optics) when the width is negative.
      let cnt = i32(g5.x);
      for (var j = 0; j < cnt; j++) {
        let fj = f32(j);
        let hj = waves_hash(seed + fi * 17.3 + fj * 1.618);
        let hk = waves_hash(seed + fi * 4.7 + fj * 2.718 + 5.0);
        let o = lp.x + (hj - 0.5) * abs(lp.z);
        let phj = ph3 + vec3f(hk, hj, hk * hj) * 0.9;
        let tj = lp.w + (hk - 0.5) * 0.35;
        if (lp.z < 0.0) {
          let c = waves_curve(q.x, o, amp * (0.8 + 0.4 * hk), f, phj, k);
          let th = abs(lp.z) * (0.01 + 0.012 * hk) * z * tp;
          let tw = smoothstep(-0.6, 0.9, sin(q.x * WAVES_TAU * f * (0.5 + hk) + hj * WAVES_TAU));
          glow += waves_thread(q, c, th, edge, tj) * (0.35 + 0.65 * tw) * tp;
        } else {
          let hw = abs(lp.z) / f32(cnt) * (0.2 + 0.3 * hk) * z * tp;
          let hit = waves_hit(q, o, amp * (0.8 + 0.4 * hk), f, phj, k, hw, 0.0, false, edge, z, L, H, tj, haze);
          acc *= 1.0 - g1.w * hit.shadow * 0.6 * op;
          acc = mix(acc, hit.col, hit.cov * op) + hit.spec * hit.cov;
          glow *= 1.0 - hit.cov * op;
        }
      }
      continue;
    }

    if (lp.z < 0.0) {
      // Light streak: a thread that swells and fades along the flow.
      let c = waves_curve(q.x, lp.x, amp, f, ph3, k);
      glow += waves_thread(q, c, -lp.z * z * tp, edge, lp.w + g2.x * q.x) * env;
      continue;
    }

    // Band: twist angle along the flow narrows it and turns its normal across. A sheet
    // (width >= 1) fills everything below its curve and only sways, so its edge stays put.
    let sheet = lp.z >= 1.0;
    let tw = g2.z * sin(q.x * WAVES_TAU * f * 0.7 + h4 * WAVES_TAU) * select(1.25, 0.5, sheet);
    let hit = waves_hit(q, lp.x, amp, f, ph3, k, 0.5 * lp.z * z * tp, tw, sheet, edge, z, L, H, lp.w, haze);
    acc *= 1.0 - g1.w * hit.shadow * 0.85 * op;
    acc = mix(acc, hit.col, hit.cov * op) + hit.spec * hit.cov;
    glow *= 1.0 - hit.cov * op;
  }

  return encodeSrgb(waves_shoulder(max(acc + glow, vec3f(0.0))));
}
