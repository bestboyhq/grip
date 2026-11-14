// Glow: three round lobes that melt into one soft shape on the sky, white at its heart and colored at its edge,
// in a faint halo.
// P.pts[4..6] = a lobe each: x, y, radius, weight.
// P.pts[7] = where the edge begins, where the heart does, the halo's strength, how much the lower side keeps its color.
// P.cols[4..6] = heart, edge, halo.

fn wp_glow(uv: vec2f, wh: vec2f) -> vec3f {
  let p = sheet(uv, wh);
  var c = sky(p);
  var f = 0.0;
  for (var i = 4; i < 7; i++) {
    let d = (p - P.pts[i].xy) / P.pts[i].z;
    f += P.pts[i].w * exp(-dot(d, d));
  }
  let k = P.pts[7];
  c = vivid(c, P.cols[6].xyz, k.z * pow(min(f / k.x, 1.0), 0.6));
  let heart = smoothstep(k.y, k.y * 2.2, f - k.w * (p.y - P.pts[4].y));
  c = vivid(c, vivid(P.cols[5].xyz, P.cols[4].xyz, heart), smoothstep(k.x, k.y, f));
  return oklabToSrgb(c);
}
