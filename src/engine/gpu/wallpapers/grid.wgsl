// Grid: laser lines. Mode 0 is a perspective floor running to a glowing horizon (with an optional
// slatted sun), mode 1 adds the mirrored ceiling (a corridor), mode 2 is a flat rotated grid that
// glows toward the edges. Line widths are computed analytically in screen space from the
// perspective, so lines stay one crisp width at any distance, and they fade out before they get
// closer than 4 px apart (no moire). Coordinates are in units of the geometric mean side.
// P.pts[0] = horizon y (frame-relative), camera height, spacing, line width (px at 1080p)
// P.pts[1] = glow, haze distance, scroll (shifts the cross lines), vanishing point x (frame-relative)
// P.pts[2] = mode, flat grid angle (rad), sun radius, sun y (frame-relative)
// P.pts[3] = sun slits, horizon glow, edge mask (mode 2: 0 even .. 1 dark center), line exposure
// cols: 0 sky top, 1 sky at the horizon, 2 floor, 3 lines, 4 horizon glow, 5 sun top, 6 sun bottom.

fn grid_lin(lab: vec3f) -> vec3f {
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

// Glow of the nearest line of a family: world coordinate x, world spacing s, and the screen size of
// one world unit (j). Returns the line light, already faded where lines crowd together.
fn grid_line(x: f32, s: f32, j: f32, w: f32, px: f32, glow: f32) -> f32 {
  let d = abs(fract(x / s + 0.5) - 0.5) * s * j;
  let crowd = smoothstep(4.0 * px, 10.0 * px, s * j);
  return crowd * (exp(-d * d / (w * w)) + glow * (exp(-d / (w * 5.0)) * 0.5 + exp(-d / (w * 24.0)) * 0.12));
}

fn wp_grid(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let A = P.pts[0];
  let B = P.pts[1];
  let C = P.pts[2];
  let D = P.pts[3];
  let px = 1.0 / sqrt(wh.x * wh.y);
  // Line width scales with the frame like everything else (given in px at 1080p).
  let w = A.w / 1440.0;
  let q = (uv - 0.5) * unit;
  let line = grid_lin(P.cols[3].xyz);
  let mode = i32(C.x);

  if (mode == 2) {
    let ca = cos(C.y);
    let sa = sin(C.y);
    let r = vec2f(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
    let l = grid_line(r.x, A.z, 1.0, w, px, B.x) + grid_line(r.y, A.z, 1.0, w, px, B.x);
    let edge = mix(1.0, smoothstep(0.15, 0.75, length(q * vec2f(0.8, 1.2))), D.z);
    let ground = grid_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 0.8, length(q))));
    let e = line * l * edge * D.w;
    return encodeSrgb(1.0 - (1.0 - ground) * exp(-e));
  }

  let hy = (A.x - 0.5) * unit.y;
  let dy = q.y - hy;
  // Sky with a glow band on the horizon.
  var c = grid_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(-0.6, 0.0, dy)));
  // Sun: a gradient disc sinking behind the floor, cut by slits that widen toward its base.
  if (C.z > 0.0) {
    let sc = vec2f((B.w - 0.5) * unit.x, (C.w - 0.5) * unit.y);
    let sd = q - sc;
    let r = length(sd);
    let k = clamp(sd.y / C.z * 0.5 + 0.5, 0.0, 1.0);
    let gap = max(k - 0.5, 0.0) * 0.9;
    let slit = select(1.0, smoothstep(0.0, 1.5 * px, min(fract(k * D.x) - gap, select(1.0 - fract(k * D.x), 1.0, gap <= 0.0)) * 2.0 * C.z / max(D.x, 1.0)), D.x > 0.0);
    let disc = (1.0 - smoothstep(C.z - 1.5 * px, C.z, r)) * slit;
    let sun = grid_lin(mix(P.cols[5].xyz, P.cols[6].xyz, k));
    // The glow takes the sun's lower color: its warm top over violet sky would turn muddy.
    c = mix(c, sun * 1.2, disc) + grid_lin(P.cols[6].xyz) * 0.3 * exp(-max(r - C.z, 0.0) / (C.z * 0.6));
  }
  c += grid_lin(P.cols[4].xyz) * D.y * exp(-abs(dy) / 0.05);

  // Floor (and ceiling in mode 1).
  let ady = select(dy, abs(dy), mode == 1);
  if (ady > 0.0) {
    let z = A.y / max(ady, 1e-5);
    let xq = q.x - (B.w - 0.5) * unit.x;
    let X = xq * z;
    // Screen size of one world unit: across, 1 / |grad X| (the receding lines lean toward the
    // horizon at the sides, so the y term matters there), and in depth, ady^2 / H.
    let jx = 1.0 / (z * sqrt(1.0 + (xq / ady) * (xq / ady)));
    let l = grid_line(X, A.z, jx, w, px, B.x) + grid_line(z + B.z, A.z, ady * ady / A.y, w, px, B.x);
    let haze = exp(-z / B.y);
    let floor = grid_lin(P.cols[2].xyz);
    // Edge of the floor softens into the horizon glow over a couple of pixels.
    let f = smoothstep(0.0, 3.0 * px, ady);
    c = mix(c, floor + line * l * haze * D.w + grid_lin(P.cols[4].xyz) * D.y * exp(-ady / 0.05), f);
  }
  // Soft shoulder so the sun and glow never clip flat.
  return encodeSrgb(select(c, 1.0 - 0.2 * exp(-(c - 0.8) / 0.2), c > vec3f(0.8)));
}
