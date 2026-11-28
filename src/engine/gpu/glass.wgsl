// Owner: compositor. The glass loupe's optics, light, and shadow, and the helpers they draw with: one lens,
// wherever it shows. The compositor's lenses (shaders.wgsl, joined after this file) and the area picker's
// loupe (src/windows/area/loupe.wgsl) both draw through it. No bindings: every input is an argument.

// Interleaved gradient noise: deterministic per pixel, so every render of a frame is identical.
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

// Antialiased coverage of a signed distance, aa = size of one output pixel in the same units.
fn cover(sd: f32, aa: f32) -> f32 { return clamp(0.5 - sd / aa, 0.0, 1.0); }

// erf of x and y (Abramowitz and Stegun 7.1.27): the edge of a Gaussian blur.
fn erf2(x: vec2f) -> vec2f {
  let s = sign(x);
  let a = abs(x);
  var r = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  r = r * r;
  return s - s / (r * r);
}

// ---- The lens ----
// A flat-topped glass disc with a rounded bevel. The flat top magnifies almost to the edge;
// across the bevel the content slows to a stop short of the rim and turns back, so the outer bevel
// mirrors what lies just inside it, and in its last part it curls back several times faster, the
// way a thick lens hooks every line that reaches its rim. Content that stands still at the rim
// smears every stroke reaching it into a streak to the edge, and squeezing the frame around the
// lens into the bevel instead aliases into streaks. No outline: the bending is the edge, and the
// glass is clear up to it and ends in a crisp cut. A bevel that blurs what it bends, or an edge that
// fades into the screen, reads as frost on the glass. Lit by one key light from above: the bevel
// shades darker and a little warmer turned away from it, a thin line of light catches the rim
// where it faces the light, Fresnel reflection at grazing angles, and dispersion splits the colors
// where the bevel bends hardest. White added all around the rim rings every dark window. Moving,
// the drop stretches along its motion, keeping its area, and what it shows smears across the
// shutter like the rest of the frame. Each lens casts a wide, soft shadow away from the light, so
// it lifts off the screen; that shadow sets the lens off, so the frame around it keeps its
// brightness.

const BEVEL = 0.15; // bevel width, fraction of the radius
const FOLD = 0.6; // how far across the bevel the content stops and turns back: the outer bevel mirrors
// the band just inside the fold
const CURL = 0.72; // from here across the bevel the turn back tightens...
const CURL_K = 6.76; // ...by this much: the rim shows what lies a third of a bevel inside the flat top's
// edge, running back 4.5 times faster than the flat top magnifies
const DISPERSION = 0.12; // how much less red bends than green, and blue more: a share of the bevel's bend
const KEY = vec3f(0.0, -0.9, 0.43); // key light direction (output px axes, z toward the viewer): straight above,
// so a lens's shadow falls the way the window's and the camera's do
const SHADOW = 0.55; // how dark a lens's shadow is under it
const SHADOW_SHIFT = 0.32; // the shadow falls this many radii off the lens, away from the light
const SHADOW_BLUR = 0.65; // ...blurred over this many radii (the Gaussian's sigma)
const SHADOW_STEP = 2.0; // ...and by no more units than this for each 8-bit level it darkens what it falls on

// Cubic Hermite from (0, p0) with slope m0 to (1, p1) with slope m1, at s: value, slope.
fn hermite(s: f32, p0: f32, m0: f32, p1: f32, m1: f32) -> vec2f {
  let s2 = s * s;
  let s3 = s2 * s;
  return vec2f(
    (2.0 * s3 - 3.0 * s2 + 1.0) * p0 + (s3 - 2.0 * s2 + s) * m0 + (3.0 * s2 - 2.0 * s3) * p1 + (s3 - s2) * m1,
    (6.0 * s2 - 6.0 * s) * p0 + (3.0 * s2 - 4.0 * s + 1.0) * m0 + (6.0 * s - 6.0 * s2) * p1 + (3.0 * s2 - 2.0 * s) * m1);
}

// Radius shown at radius rho (both fractions of the lens radius, from its center), and its
// derivative: magnified on the flat top, then across the bevel the content slows evenly, stops at
// FOLD and runs back, faster and faster from CURL to the rim: it stands still at one radius, not
// across the outer bevel. Under 1.5x it blends into a monotone cubic that ends on the content just
// outside the rim, so at magnification 1 the lens is flat glass and shows exactly what lies under it.
fn lensMap(rho: f32, mag: f32) -> vec2f {
  let e = 1.0 - BEVEL;
  if (rho <= e) { return vec2f(rho / mag, 1.0 / mag); }
  let s = min((rho - e) / BEVEL, 1.0);
  let p0 = e / mag;
  let m0 = BEVEL / mag;
  let c = max(s - CURL, 0.0);
  let fold = vec2f(p0 + m0 * (s - 0.5 * s * s / FOLD - CURL_K * c * c), m0 * (1.0 - s / FOLD - 2.0 * CURL_K * c));
  let meet = hermite(s, p0, m0, 1.0, (1.0 - p0) * (1.0 + 1.8 * clamp(mag - 1.0, 0.0, 1.0))); // under 3x the secant: stays monotone
  let h = mix(meet, fold, clamp(2.0 * (mag - 1.0), 0.0, 1.0));
  return vec2f(h.x, h.y / BEVEL);
}

// q in the stretched drop's frame, where it is a circle: the drop is an ellipse 1 + k long along its
// motion st (length k) and 1 / sqrt(1 + k) across it. The map is symmetric, so drop(drop(q)) points
// along the gradient of length(drop(q)).
fn drop(q: vec2f, st: vec2f) -> vec2f {
  let k = length(st);
  let ax = select(vec2f(1.0, 0.0), st / max(k, 1e-6), k > 1e-6);
  let along = dot(q, ax);
  return ax * (along / (1.0 + k)) + (q - ax * along) * sqrt(1.0 + k);
}

// What the lens shows for red and for blue at rho, as shares of the distance from its center (mx: lensMap's
// shown radius there): red bends least, so it shows what lies a little further out, and blue the reverse,
// each by a share of how far the bevel bends the content in. Splitting the shown radius instead tears the
// colors into rainbows where the content turns back. At magnification 1 the lens is flat glass: no split.
fn dispersed(rho: f32, mag: f32, mx: f32) -> vec2f {
  let sp = DISPERSION * (rho / mag - mx) * clamp(mag - 1.0, 0.0, 1.0);
  return vec2f(mx + sp, mx - sp) / max(rho, 1e-4);
}

// The lit glass over col, what the lens shows at rho (s: 0 on the flat top, 1 at the rim), dir the rim's
// normal, d out from the center of a lens of radius R, aa per output px.
fn glassLight(col: vec3f, rho: f32, s: f32, dir: vec2f, R: f32, d: f32, aa: f32) -> vec3f {
  // Surface normal of the bevel: flat on top, turning to near vertical at the rim.
  let tilt = 1.5 * pow(s, 2.4);
  let n = vec3f(dir * sin(tilt), cos(tilt));
  let fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  let env = mix(vec3f(1.0), vec3f(0.55, 0.58, 0.64), smoothstep(-0.7, 0.9, dir.y)); // bright sky above, the room below
  // The rim rounds away: from where the bevel starts it shades darker, three times as much on the
  // side turned from the light, where the light that crossed the glass also leaves it a little
  // warmer. A thin line of light catches the rim over the arc that faces the light, even along its
  // length and as wide as a hundredth of the radius. An outline all around, dark or light, rings flat
  // UI; broad specular crescents read as plastic, not glass.
  let toward = dot(dir, normalize(KEY.xy)); // 1 facing the light, -1 turned away
  let round = smoothstep(1.0 - 1.2 * BEVEL, 1.0, rho);
  let px = (R - d) / aa; // output px in from the rim
  var g = col * (1.0 - round * mix(0.14, 0.047, 0.5 + 0.5 * toward));
  g *= 1.0 - 0.065 * smoothstep(0.4, 0.9, rho) * smoothstep(0.0, 0.8, -toward) * vec3f(0.0, 0.3, 1.0);
  g = mix(g, env, fres * 0.05);
  let line = max(0.0105 * R / aa, 1.5); // the line's width, output px
  g += vec3f(0.07 * pow(clamp((toward - 0.788) / 0.212, 0.0, 1.0), 0.178)) * (1.0 - smoothstep(0.5 * line, line, px));
  return g;
}

// A lens's shadow, picked up `lift` (0 to 1) off the screen: its strength, its blur (sigma), and how far it
// falls from the lens, away from the light, all for a lens of radius R.
struct Shade { s: f32, sigma: f32, off: vec2f }
fn shadeOf(R: f32, lift: f32) -> Shade {
  return Shade(SHADOW * lift * lift, SHADOW_BLUR * R * mix(0.15, 1.0, lift), normalize(KEY.xy) * SHADOW_SHIFT * mix(0.05, 1.0, lift) * R);
}
// The shade's darkening at q from the lens's center, its drop stretched by st, when the content under it
// can show k of its reach (shadowReach; 1 for the wide shadow).
fn shadowEdge(q: vec2f, st: vec2f, R: f32, sh: Shade, k: f32) -> f32 {
  let x = length(drop(q + sh.off * k, st)) - R; // out from the shadow's edge
  return sh.s * (0.5 - 0.5 * erf2(vec2f(x * 0.70710678 / (sh.sigma * k))).x);
}
// The share of the wide reach content `levels` bright (8-bit luma) can show, SHADOW_STEP units of blur per
// level it darkens: unit is output px per style unit, scale output px per px of R.
fn shadowReach(sh: Shade, levels: f32, unit: f32, scale: f32) -> f32 {
  return clamp(SHADOW_STEP * unit * levels * sh.s / (sh.sigma * scale), 0.01, 1.0);
}
