// Sphere: glowing gradient orbs. Each disc is shaded as a lit sphere whose light-to-shadow axis
// runs through a palette ramp in OKLab, with a fresnel rim, a soft specular and an outer glow; on
// light grounds a soft contact shadow sits under it. Coordinates are in units of the frame's
// geometric mean side, so spheres stay round and keep their size at any aspect ratio.
// P.pts[0] = light direction x, y (screen, y down), rim, glow
// P.pts[1] = ground vignette, shadow, specular, exposure
// P.pts[2 + i] = sphere i center x, y (0.5 + offset from the center, mean-side units), radius,
//   ramp shift (0..1); up to 3, radius 0 ends the list. Later spheres sit in front.
// cols[0] = ground center, cols[1] = ground edge, cols[2..] = sphere ramp, lit side first.

fn sphere_lin(lab: vec3f) -> vec3f {
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

fn sphere_ramp(t: f32) -> vec3f {
  let n = max(i32(P.a.y) - 2, 1);
  var acc = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0; i < n; i++) {
    let dt = t - f32(i) / f32(max(n - 1, 1));
    let w = exp(-dt * dt / 0.03) + 1e-6;
    acc += P.cols[2 + i].xyz * w;
    sum += w;
  }
  return sphere_lin(acc / sum);
}

fn wp_sphere(uv: vec2f, wh: vec2f) -> vec3f {
  let unit = wh / sqrt(wh.x * wh.y);
  let G = P.pts[0];
  let H = P.pts[1];
  let px = 1.0 / sqrt(wh.x * wh.y);
  let q = (uv - 0.5) * unit;
  var c = sphere_lin(mix(P.cols[0].xyz, P.cols[1].xyz, smoothstep(0.0, 1.0, H.x * length(q))));
  let L = normalize(vec3f(G.x, G.y, 0.7));

  for (var i = 0; i < 3; i++) {
    let s = P.pts[2 + i];
    if (s.z <= 0.0) { break; }
    let d = q - (s.xy - 0.5);
    let r = length(d) / s.z;
    // Contact shadow below, and an outer glow in the sphere's lit color.
    let sd = (d - vec2f(-G.x, -G.y + 0.6) * s.z * 0.25) / s.z;
    c *= 1.0 - H.y * exp(-dot(sd, sd) * 1.6) * 0.6;
    let glowCol = sphere_ramp(s.w + 0.15);
    c += glowCol * G.w * (exp(-max(r - 1.0, 0.0) * 3.0) * 0.35 + exp(-max(r - 1.0, 0.0) * 0.8) * 0.1) * step(1.0, r);
    // The lit sphere.
    let k = min(r, 1.0);
    let n = vec3f(d / s.z, sqrt(max(1.0 - k * k, 0.0)));
    let lit = dot(n, L);
    var col = sphere_ramp(s.w + 0.5 - 0.5 * lit);
    let fres = pow(1.0 - n.z, 3.0);
    col += sphere_ramp(s.w) * G.z * fres;
    let hv = normalize(L + vec3f(0.0, 0.0, 1.0));
    col += vec3f(H.z * pow(max(dot(n, hv), 0.0), 40.0));
    let mask = 1.0 - smoothstep(s.z - 1.5 * px, s.z, length(d));
    c = mix(c, col * H.w, mask);
  }
  return encodeSrgb(select(c, 1.0 - 0.2 * exp(-(c - 0.8) / 0.2), c > vec3f(0.8)));
}
