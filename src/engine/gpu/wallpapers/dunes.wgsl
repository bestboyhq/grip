// Dunes: up to four long waves in front of the sky, back to front. Each is sharp and lit at its crest, shifts
// its color along the crest and deepens below it, and casts a soft shade on what lies behind. A dune with
// threads is a sheet of silk: lit at its crest and clear below it.
// Six rows per dune from P.pts[4] (Dune in src/engine/backgrounds/picture.ts):
//   angle, line, height, scale | phase, blur, top, deep | depth, rim, reach, shade
//   | fade from, to, along from, to | threads, thread, pinch, turn | light
// Four colors per dune from P.cols[4]: the crest's two ends, then the depth under each.

fn wp_dunes(uv: vec2f, wh: vec2f) -> vec3f {
  let p = sheet(uv, wh);
  let aa = 1.5 / wh.y;
  var c = sky(p);
  let count = min((i32(P.a.y) - 4) / 4, 4);
  for (var i = 0; i < count; i++) {
    let a = P.pts[4 + i * 6];
    let b = P.pts[5 + i * 6];
    let e = P.pts[6 + i * 6];
    let f = P.pts[7 + i * 6];
    let g = P.pts[8 + i * 6];
    let light = P.pts[9 + i * 6].x;
    let k = 4 + i * 4;
    let q = turned(p, a.x);
    let x = q.x * a.w + b.x;
    let y = a.y + a.z * (sin(x) + 0.3 * sin(x * 2.1 + b.x));
    let lean = cos(x) + 0.63 * cos(x * 2.1 + b.x);
    let slope = a.z * a.w * lean;
    let d = (q.y - y) / sqrt(1.0 + slope * slope); // how far below the crest
    let u = 0.5 + q.x / 1.6; // 0 at one end of the crest, 1 at the other
    let there = ramp(f.x, f.y, u); // where the dune fades in
    let under = max(d, 0.0);
    let s = under / (e.x * (1.0 + g.z * sin(x * 0.7 + g.w))); // how deep, in depths: a sheet swells and thins along its crest
    let deep = 1.0 - exp(-s);
    let al = ramp(f.z, f.w, u);
    var lc = vivid(vivid(P.cols[k].xyz, P.cols[k + 1].xyz, al), vivid(P.cols[k + 2].xyz, P.cols[k + 3].xyz, al), deep);
    lc.x *= max(0.0, 1.0 + light * lean / 1.63); // a light from one side: the slopes that face it are bright
    // The crest glows, and a fine line of light runs on it.
    let lit = e.y * exp(-under / 0.07);
    let rim = e.y * exp(-under / 0.008);
    lc = vec3f(lc.x + 0.2 * lit * (1.0 - lc.x), lc.yz * (1.0 + 0.15 * lit));
    lc = vec3f(mix(lc.x, 1.0, 0.5 * rim), lc.yz * (1.0 - 0.2 * rim));
    // The shade deepens the color behind it, it does not gray it, and it turns a yellow to gold, not to olive.
    let sh = e.w * there * exp(-abs(d) / e.z);
    c *= vec3f(1.0 - sh, 1.0 + 0.6 * sh, 1.0 + 0.6 * sh);
    c.y += 2.0 * sh * max(c.z, 0.0);
    let soft = max(aa, b.y);
    var solid = smoothstep(-soft, soft, d) * mix(b.z, b.w, deep) * there;
    if (g.x > 0.0) {
      // Threads run along the sheet, one at each whole number, and no two are as bright. They lie in bundles,
      // some brighter. Where threads lie closer than a pixel, they melt into the sheet.
      let ts = s * g.x;
      let fw = max(fwidth(ts), 1e-4);
      let on = (1.0 - smoothstep(0.2 - fw, 0.2 + fw, abs(fract(ts + 0.5) - 0.5))) * (0.5 + hash21(vec2f(floor(ts + 0.5), f32(i) * 17.0)));
      let n = ts / 7.0;
      let bundle = mix(hash21(vec2f(floor(n), f32(i) * 31.0)), hash21(vec2f(floor(n) + 1.0, f32(i) * 31.0)), smoothstep(0.0, 1.0, fract(n)));
      solid *= mix(1.0, mix(on / 0.4, 1.0, smoothstep(0.25, 0.6, fw)) * (0.45 + 1.1 * bundle), g.y);
    }
    c = vivid(c, lc, min(solid, 1.0));
  }
  return oklabToSrgb(c);
}
