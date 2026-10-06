// Bokeh: out-of-focus lights. Discs scattered on jittered grids in several depth layers (nearer
// layers larger, softer and dimmer), each with the bright rim of a real lens and a palette color.
// Density follows a soft band and can gather toward the frame edges, so the center stays calm.
// Coordinates are in units of the frame's geometric mean side.
// P.pts[0] = cell size, density (0..1), size min, size max (fractions of the cell)
// P.pts[1] = layers (1..4), softness, rim, seed
// P.pts[2] = band angle (rad), band offset, band width, band amount (0 everywhere .. 1 band only)
// P.pts[3] = edge frame (0 .. 1 empty center), exposure, ground angle (rad), haze
// cols[0], cols[1] = ground gradient, cols[2..] = light colors.

fn bokeh_lin(lab: vec3f) -> vec3f {
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

fn bokeh_hash(p: vec2f) -> vec4f {
  var q = fract(vec4f(p.xyxy) * vec4f(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

fn wp_bokeh(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let A = P.pts[0];
  let B = P.pts[1];
  let Bd = P.pts[2];
  let E = P.pts[3];
  let ncol = max(i32(P.a.y) - 2, 1);
  let q = (uv - 0.5) * unit;
  let gd = vec2f(cos(E.z), sin(E.z));
  var c = bokeh_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(-0.6, 0.6, dot(q, gd))));

  // Where lights gather: a soft band, and optionally away from the center.
  let bn = vec2f(-sin(Bd.x), cos(Bd.x));
  let bd = (dot(q, bn) - Bd.y) / max(Bd.z, 1e-3);
  let bandMask = mix(1.0, exp(-bd * bd), Bd.w);

  var e = vec3f(0.0);
  let layers = clamp(i32(B.x), 1, 4);
  for (var l = 0; l < layers; l++) {
    let fl = f32(l);
    let cs = A.x * (1.0 + fl * 0.8);
    let soft = B.y * (1.0 + fl * 1.5);
    let dim = 1.0 / (1.0 + fl * 0.9);
    let g = q / cs + vec2f(fl * 7.31, fl * 3.17);
    let cell = floor(g);
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let id = cell + vec2f(f32(i), f32(j));
        let h = bokeh_hash(id + B.w * 17.0 + fl * 101.0);
        let center = id + 0.2 + 0.6 * h.xy;
        let wpos = (center - vec2f(fl * 7.31, fl * 3.17)) * cs;
        let bd2 = (dot(wpos, bn) - Bd.y) / max(Bd.z, 1e-3);
        let mask = mix(1.0, exp(-bd2 * bd2), Bd.w) * mix(1.0, smoothstep(0.12, 0.5, length(wpos * vec2f(0.75, 1.0))), E.x);
        if (h.z > A.y * mask) { continue; }
        let r = mix(A.z, A.w, fract(h.w * 7.13)) * cs;
        let d = length(g - center) * cs;
        if (d > 3.0 * r) { continue; }
        let body = 1.0 - smoothstep(r - soft * r, r, d);
        let rim = exp(-pow((d - r * (1.0 - 0.6 * soft)) / (r * 0.07 + soft * r * 0.3), 2.0)) * B.z;
        let col = bokeh_lin(P.cols[2 + i32(floor(fract(h.w * 13.7) * f32(ncol))) % ncol].xyz);
        let lum = (0.35 + 0.65 * fract(h.z * 31.7 + h.x)) * dim;
        e += col * lum * (body * 0.55 + rim * body * 0.6 + 0.08 * exp(-max(d - r, 0.0) / (r * 0.5)) * smoothstep(3.0 * r, 2.0 * r, d));
      }
    }
  }
  // A faint haze of the same light where the band runs.
  e += bokeh_lin(P.cols[2].xyz) * E.w * bandMask * 0.15;
  let lit = 1.0 - exp(-e * E.y);
  return encodeSrgb(1.0 - (1.0 - c) * (1.0 - lit));
}
