// Tube: glowing light along bent paths. Each path is an arc through two end points (a bulge of 0
// is a straight segment). As neon tubes: a white-hot core, a colored glass body and a wide glow. As light trails: several parallel lanes per path, fading along their length
// like a long exposure. Coordinates are in units of the frame's geometric mean side.
// P.pts[0] = tube width, glow, lanes (1 = a single tube), lane spacing
// P.pts[1] = trail fade (0 even .. 1 fades in along the path), unused, ground vignette, exposure
// P.pts[2 + 2i] = path i start x, y, end x, y (0.5 + offset from the center, mean-side units)
// P.pts[3 + 2i] = bulge (sagitta / half chord, signed), color index, intensity, width scale;
//   up to 5 paths, intensity 0 ends the list
// cols[0] = ground center, cols[1] = ground edge, cols[2..] = light colors.

fn tube_lin(lab: vec3f) -> vec3f {
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

// Distance from p to lane k of the path a -> b with bulge, and the position along it (0..1).
fn tube_path(p: vec2f, a: vec2f, b: vec2f, bulge: f32, off: f32) -> vec2f {
  let m = (a + b) * 0.5;
  let h = max(length(b - a) * 0.5, 1e-5);
  let t = (b - a) / (2.0 * h);
  let n = vec2f(-t.y, t.x);
  if (abs(bulge) < 1e-3) {
    // Straight: lanes are parallel offsets.
    let q = p - a - n * off;
    let s = clamp(dot(q, t) / (2.0 * h), 0.0, 1.0);
    return vec2f(length(q - t * s * 2.0 * h), s);
  }
  // Arc: the circle through a and b whose midpoint sits bulge * h off the chord. Lanes are
  // concentric arcs over the same angle.
  let sag = bulge * h;
  let c = m + n * (sag * sag - h * h) / (2.0 * sag);
  let r = length(a - c);
  let mid = normalize(m + n * sag - c);
  let da = normalize(a - c);
  let angA = atan2(mid.x * da.y - mid.y * da.x, dot(mid, da));
  let v = p - c;
  let ang = atan2(mid.x * v.y - mid.y * v.x, dot(mid, v));
  let ar = r + off;
  if (abs(ang) <= abs(angA)) { return vec2f(abs(length(v) - ar), 0.5 - 0.5 * ang / angA); }
  // Past an end: distance to that lane's end point.
  let nearA = sign(ang) == sign(angA);
  let ep = c + normalize(select(b, a, nearA) - c) * ar;
  return vec2f(length(p - ep), select(1.0, 0.0, nearA));
}

fn wp_tube(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let G = P.pts[0];
  let T = P.pts[1];
  let ncol = max(i32(P.a.y) - 2, 1);
  let p = (uv - 0.5) * unit + 0.5;
  let vr = (uv - 0.5) * unit;
  let ground = tube_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 1.0, T.z * length(vr))));

  let lanes = max(i32(G.z), 1);
  var e = vec3f(0.0);
  for (var i = 0; i < 5; i++) {
    let A = P.pts[2 + 2 * i];
    let B = P.pts[3 + 2 * i];
    if (B.z <= 0.0) { break; }
    for (var k = 0; k < lanes; k++) {
      let off = (f32(k) - 0.5 * f32(lanes - 1)) * G.w;
      let h = tube_path(p, A.xy, A.zw, B.x, off);
      let col = tube_lin(P.cols[2 + (i32(B.y) + k) % ncol].xyz);
      let w = G.x * B.w;
      let d = h.x;
      // Trails fade in along the path, like lights that switched on mid-exposure.
      let along = mix(1.0, h.y * h.y, T.x);
      let core = exp(-d * d / (w * w * 0.12));
      let body = exp(-d * d / (w * w));
      let glow = exp(-d / (w * 6.0)) * 0.35 + exp(-d * d / (w * w * 400.0)) * 0.25;
      // Max, not sum: where paths join, both reach the joint and a sum would leave a bright knot.
      e = max(e, B.z * along * (vec3f(core) * 1.4 + col * (body * 1.5 + G.y * glow)));
    }
  }
  let lit = 1.0 - exp(-e * T.w);
  return encodeSrgb(1.0 - (1.0 - ground) * (1.0 - lit));
}
