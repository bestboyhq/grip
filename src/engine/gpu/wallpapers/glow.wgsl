// Glow: luminous soft blobs on a dark or deep ground. Gaussian orbs sum into one metaball field;
// its soft threshold is the body, a wide second falloff is the bloom (per channel, so halos fade
// warm to cool), and emission goes through an exponential tone curve so dense cores burn to white.
// Coordinates are in units of the frame's geometric mean side, so a blob keeps its shape and size
// at every aspect ratio.
// P.pts[0] = exposure, bloom, core (whiteness of dense areas), edge softness
// P.pts[1] = stretch angle (rad), stretch (>1 smears along the angle), warp, seed
// P.pts[2 + i] = orb x, y (0.5 + offset from the center, in mean-side units), radius, weight;
//   radius 0 ends the list (max 10)
// cols[0] = ground, cols[1..] = orb colors, cycled.

fn glow_lin(lab: vec3f) -> vec3f {
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

fn wp_glow(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let g0 = P.pts[0];
  let g1 = P.pts[1];
  let ca = cos(g1.x);
  let sa = sin(g1.x);
  let ncol = max(i32(P.a.y) - 1, 1);

  // Organic outline: one gentle warp of the shared plane, so the tint inside stays smooth.
  var pw = (uv - 0.5) * unit;
  pw += g1.z * 0.1 * vec2f(sin(pw.y * 9.0 + g1.w), sin(pw.x * 7.0 + g1.w * 1.7));
  pw += g1.z * 0.04 * vec2f(sin(pw.y * 17.0 - g1.w * 2.3), sin(pw.x * 15.0 + g1.w * 0.6));

  var field = 0.0;
  var halo = vec3f(0.0);
  var lab = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    let o = P.pts[2 + i];
    if (o.z <= 0.0) { break; }
    let d = pw - (o.xy - 0.5);
    // Stretch along the angle: the smear of a light moving fast.
    let r = vec2f(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) * vec2f(1.0 / max(g1.y, 0.05), 1.0);
    let q = dot(r, r) / (o.z * o.z);
    let g = o.w * exp(-q);
    let c = P.cols[1 + i % ncol].xyz;
    field += g;
    lab += c * g;
    // Bloom: a wider falloff per channel (red reaching furthest) in a richer version of the
    // color, since dim light on black reads desaturated.
    halo += glow_lin(vec3f(c.x * 0.85, c.yz * 1.5)) * o.w * (exp(-q / vec3f(3.0, 2.6, 2.2)) + 0.03 / (1.0 + q * vec3f(0.6, 0.8, 1.0)));
  }
  let tint = glow_lin(lab / max(field, 1e-5));
  let soft = max(g0.w, 0.02);
  let body = smoothstep(0.45 - soft, 0.45 + soft, field);
  // Light builds up with density, and the densest parts run hot toward white.
  let hot = smoothstep(0.7, 2.4, field) * g0.z;
  let e = (body * mix(tint, vec3f(1.0), hot) * (0.35 + 0.65 * field * field) + g0.y * halo) * g0.x;
  let lit = 1.0 - exp(-e);
  let ground = glow_lin(P.cols[0].xyz);
  return encodeSrgb(1.0 - (1.0 - ground) * (1.0 - lit));
}
