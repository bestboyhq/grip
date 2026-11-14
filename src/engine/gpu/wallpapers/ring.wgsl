// Ring: a fine line on one side that widens into a soft glow on the other, on the sky, with a darker inside.
// P.pts[4] = middle x, y, radius x, y.
// P.pts[5] = angle, where on the ring the glow is widest (rad), the line's width, the glow's width.
// P.pts[6] = how dark the inside is, how bright the glow stays, how fast the line widens.
// P.cols[4], P.cols[5] = line, glow.

fn wp_ring(uv: vec2f, wh: vec2f) -> vec3f {
  let p = sheet(uv, wh);
  var c = sky(p);
  let o = P.pts[4];
  let k = P.pts[5];
  let m = P.pts[6];
  let q = turned(p - o.xy, k.x);
  let r = min(o.z, o.w);
  let d = (length(q / o.zw) - 1.0) * r; // how far outside the line
  let t = pow(max(0.0, 0.5 + 0.5 * cos(atan2(q.y, q.x) - k.y)), m.z);
  let w = max(mix(k.z, k.w, t), 1.5 / wh.y);
  let v = exp(-pow(abs(d) / select(mix(w, w * 0.3, t), w, d > 0.0), mix(4.0, 1.3, t))) * mix(1.0, m.y, t);
  c.x *= 1.0 - m.x * ramp(0.0, -0.6 * r, d);
  c = vivid(c, vivid(P.cols[5].xyz, P.cols[4].xyz, smoothstep(0.3, 0.9, v)), v);
  return oklabToSrgb(c);
}
