// Streaks: up to three layers of slanted bars on the sky, back to front, each from its fringe color to the
// color of its core.
// Two rows per layer from P.pts[4]: angle, period (0: no layer), the band's y, length | how soft a bar's sharp
// side is, how fast it fades to its other side, seed. P.pts[10] = each layer's gain.
// Two colors per layer from P.cols[4]: fringe, core.

// One layer: bars side by side along a level band. Each is sharp on one side and fades to the other, and no
// two are as long or as bright.
fn streaks_bars(p: vec2f, a: vec4f, b: vec4f, aa: f32) -> f32 {
  let q = turned(p, a.x);
  let n = floor(q.x / a.y);
  let s = fract(q.x / a.y);
  let h = hash21(vec2f(n, b.z));
  let h2 = hash21(vec2f(n, b.z + 7.0));
  let mid = (a.z - sin(a.x) * (n + 0.5) * a.y) / cos(a.x) + (h2 - 0.5) * a.w * 0.5; // where the bar meets the band
  let len = a.w * (0.6 + 0.8 * h);
  let across = smoothstep(0.0, max(b.x, aa / a.y), s) * pow(1.0 - s, b.y);
  return across * (1.0 - smoothstep(len * 0.35, len, abs(q.y - mid))) * (0.55 + 0.45 * h2);
}

fn wp_streaks(uv: vec2f, wh: vec2f) -> vec3f {
  let p = sheet(uv, wh);
  var c = sky(p);
  for (var i = 0; i < 3; i++) {
    let a = P.pts[4 + i * 2];
    if (a.y <= 0.0) { continue; }
    let v = 1.0 - exp(-2.0 * P.pts[10][i] * streaks_bars(p, a, P.pts[5 + i * 2], 1.5 / wh.y));
    c = vivid(c, vivid(P.cols[4 + i * 2].xyz, P.cols[5 + i * 2].xyz, smoothstep(0.3, 0.85, v)), v);
  }
  return oklabToSrgb(c);
}
