// Ring: thin glowing elliptical light rings. Distance to each ellipse (first-order, exact on the
// curve) drives a hot core line, a near glow and a wide halo; brightness runs around the ring like
// a light orbiting it, and a faint haze fills the inside behind the bright arc. On light grounds a
// soft offset shadow seats the ring on the surface. Coordinates are in units of the frame's
// geometric mean side, so a ring keeps its shape at every aspect ratio.
// P.pts[0] = halo, inner haze, shadow, exposure
// P.pts[1 + i] = ring i center x, y (0.5 + offset in mean-side units), radius x, radius y (max 3;
//   radius 0 ends the list)
// P.pts[4 + i] = ring i rotation (rad), line width, intensity, bright side angle (rad)
// P.pts[7] = ground vignette strength, vignette center x, y (frame-relative), arc falloff power
// P.pts[8] = repeats (each ring echoes inward as a receding tunnel), radius step, drift x, y
// P.pts[9].x = intensity step per echo
// cols[0] = ground center, cols[1] = ground edge, cols[2..] = ring colors, cycled.

fn ring_lin(lab: vec3f) -> vec3f {
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

// Signed distance to an axis-aligned ellipse with radii r.
fn ring_sd(q: vec2f, r: vec2f) -> f32 {
  let k0 = length(q / r);
  let k1 = length(q / (r * r));
  // At the very center the gradient vanishes; the distance there is the smaller radius.
  let d = select(-min(r.x, r.y), k0 * (k0 - 1.0) / k1, k1 > 1e-5);
  return d;
}

fn wp_ring(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let G = P.pts[0];
  let V = P.pts[7];
  let ncol = max(i32(P.a.y) - 2, 1);

  let vr = (uv - V.yz) * unit;
  var ground = ring_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 1.0, V.x * length(vr))));

  var e = vec3f(0.0);
  var shade = 1.0;
  for (var i = 0; i < 3; i++) {
    let o0 = P.pts[1 + i];
    if (o0.z <= 0.0) { break; }
    let s0 = P.pts[4 + i];
    let R = P.pts[8];
    for (var k = 0; k < max(i32(R.x), 1); k++) {
      let sc = pow(max(R.y, 0.01), f32(k));
      let o = vec4f(o0.xy + R.zw * f32(k), o0.zw * sc);
      let s = vec4f(s0.x, s0.y * mix(1.0, sc, 0.6), s0.z * pow(max(P.pts[9].x, 0.01), f32(k)), s0.w);
      let p = (uv - 0.5) * unit - (o.xy - 0.5);
      let cr = cos(s.x);
      let sr = sin(s.x);
      let q = vec2f(cr * p.x + sr * p.y, -sr * p.x + cr * p.y);
      let d = ring_sd(q, o.zw);
      // Brightness around the ring: full on the lit side, fading round to the far side. The direction
      // is shrunk toward the center so it stays smooth there.
      let k0 = length(q / o.zw);
      let ldir = vec2f(cos(s.w), sin(s.w));
      let arc = pow(clamp(0.5 + 0.5 * dot(q / o.zw, ldir) / max(k0, 0.6), 0.0, 1.0), max(V.w, 0.01));
      let col = ring_lin(P.cols[2 + (i + k) % ncol].xyz);
      // The lit side is brighter and a little wider, like a light orbiting the ring.
      let w = s.y * (0.6 + 0.8 * arc);
      let core = exp(-d * d / (w * w)) * mix(0.06, 1.0, arc);
      let near = exp(-abs(d) / (w * 5.0)) * mix(0.03, 1.0, arc);
      let halo = exp(-d * d / ((0.0006 + 0.005 * arc) * select(1.0, 0.25, d < 0.0))) * mix(0.05, 1.0, arc);
      // Inner haze: light scattered across the inside, densest away from the bright arc.
      let side = clamp(dot(q / o.zw, -ldir), -1.0, 1.0) * 0.5 + 0.5;
      let haze = smoothstep(1.02, 0.5, k0) * side * side;
      e += s.z * (mix(col, vec3f(1.0), 0.7) * core * 2.0 + col * (near * 0.4 + G.x * halo + G.y * haze));
      // Shadow: a soft copy of the ring, offset down and right, darkening the ground.
      let qs = (p - vec2f(0.006, 0.012) * max(o.z, o.w) * 4.0);
      let hs = ring_sd(vec2f(cr * qs.x + sr * qs.y, -sr * qs.x + cr * qs.y), o.zw);
      shade *= 1.0 - G.z * exp(-hs * hs / (w * w * 40.0)) * (0.3 + 0.7 * arc);
    }
  }
  let lit = 1.0 - exp(-e * G.w);
  return encodeSrgb(1.0 - (1.0 - ground * shade) * (1.0 - lit));
}
