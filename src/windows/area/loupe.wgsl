// Owner: capture. The area picker's loupe (loupe.ts): the editor's glass lens (glass.wgsl, joined before this
// file) in place over the frozen screen, with the shade's dim and the area's hairline where they lie on it,
// and the lens's shadow. One triangle covers the canvas; px are its device px. Premultiplied output.

struct Uniforms {
  lens: vec4f,   // center x, y (px), radius (px), magnification
  look: vec4f,   // glass opacity, lift (0 flat on the screen, 1 picked up), px per point, has an area
  map: vec4f,    // texture px under the center x, y; texture px per px unmagnified; checker cell (texture px)
  area: vec4f,   // the area (texture px): x0, y0, x1, y1
  screen: vec4f, // the display (texture px): x0, y0, x1, y1; dashed where it ends when x1 > x0
  even: vec4f,   // the checkerboard where nothing lies past the screen (Area.svelte .room.clear)
  odd: vec4f,
  rule: array<vec4f, 4>, // the measure lines (texture px): x0, y0, x1, y1
  ruleOn: vec4f, // each line: 1 drawn, 0 none
  brand: vec4f,  // their color
  flat: vec4f,   // texture px under the center unmagnified, where its shadow falls: x, y
}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler; // nearest where magnified: the screen's true pixels

const DIM = 0.42; // the shade's dim (Area.svelte .shade)

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
}

// Signed distance from texture px t to the edge of rect r (x0, y0, x1, y1).
fn sdRect(t: vec2f, r: vec4f) -> f32 {
  let half = 0.5 * (r.zw - r.xy);
  let e = abs(t - r.xy - half) - half;
  return min(max(e.x, e.y), 0.0) + length(max(e, vec2f(0.0)));
}

// How much of a measure line (Area.svelte .ruler) covers a point u px along it and v px across it, a line
// len px long: hw px either side of it, with a tick hl px either side across each end.
fn ruleCover(u: f32, v: f32, len: f32, hw: f32, hl: f32) -> f32 {
  let body = cover(max(abs(u - 0.5 * len) - 0.5 * len, v - hw), 1.0);
  let tick = cover(max(min(abs(u), abs(u - len)) - hw, v - hl), 1.0);
  return max(body, tick);
}

// What the screen shows at texture px t, foot texture px per output px: the frozen screen, the shade's
// dim outside the area and its hairline a point wide just outside it, dashes where the display ends, and
// the measure lines, a point wide with 7 pt ticks, in the brand's color.
// Lines keep their width on screen: the lens magnifies the pixels they mark, not the lines.
fn under(t: vec2f, foot: f32) -> vec3f {
  let size = vec2f(textureDimensions(tex));
  var c = textureSampleGrad(tex, smp, t / size, vec2f(foot / size.x, 0.0), vec2f(0.0, foot / size.y));
  if (any(t < vec2f(0.0)) || any(t > size)) { c = vec4f(0.0); }
  let cell = vec2i(floor(t / U.map.w));
  var col = mix(select(U.even.rgb, U.odd.rgb, ((cell.x + cell.y) & 1) == 1), c.rgb, c.a);
  let pt = U.look.z;
  if (U.screen.z > U.screen.x) {
    let o = sdRect(t, U.screen) / foot;
    let e = abs(t - 0.5 * (U.screen.xy + U.screen.zw)) - 0.5 * (U.screen.zw - U.screen.xy);
    let along = select(t.x, t.y, e.x > e.y) / U.map.w; // in checker cells: 6 of 10 white, as .edge's dashes
    let dash = select(vec4f(0.0, 0.0, 0.0, 0.45), vec4f(1.0), fract(along / 1.25) < 0.6);
    col = mix(col, dash.rgb, dash.a * (cover(o - pt, 1.0) - cover(o, 1.0)));
  }
  if (U.look.w > 0.5) {
    let o = sdRect(t, U.area) / foot; // px out from the area's edge
    col *= 1.0 - DIM * (1.0 - cover(o, 1.0));
    col = mix(col, vec3f(1.0), 0.95 * (cover(o - pt, 1.0) - cover(o, 1.0)));
  }
  for (var i = 0; i < 4; i++) {
    let on = U.ruleOn[i];
    let r = U.rule[i];
    let ab = r.zw - r.xy;
    let n = length(ab);
    if (on < 0.5 || n < 1e-3) { continue; }
    let dir = ab / n;
    let rel = (t - r.xy) / foot;
    let u = dot(rel, dir);
    let v = abs(dot(rel, vec2f(-dir.y, dir.x)));
    let len = n / foot;
    col = mix(col, U.brand.rgb, ruleCover(u, v, len, 0.5 * pt, 3.5 * pt));
  }
  return col;
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy;
  let c = U.lens.xy;
  let R = U.lens.z;
  let mag = U.lens.w;
  let k = U.map.z;
  let q = p - c;
  let d = length(q);

  // The shadow first, black: its alpha dithered, so a wide one stays a smooth ramp on the 8-bit canvas.
  var out = vec4f(0.0);
  let shade = shadeOf(R, U.look.y);
  if (shadowEdge(q, vec2f(0.0), R, shade, 1.0) >= 1.0 / 1020.0) {
    let levels = 255.0 * dot(under(U.flat.xy + q * k, k), vec3f(0.2126, 0.7152, 0.0722));
    let sh = shadowEdge(q, vec2f(0.0), R, shade, shadowReach(shade, levels, U.look.z, 1.0));
    out = vec4f(0.0, 0.0, 0.0, clamp(sh + (ign(p) - 0.5) / 255.0, 0.0, 1.0));
  }

  let cv = cover(d - R, 2.0); // glass ends in a crisp cut
  if (cv <= 0.0) { return out; }
  let rho = min(d / R, 1.0);
  let dir = q / max(d, 1e-6);
  let m = lensMap(rho, mag);
  let shown = m.x / max(rho, 1e-4);
  let s = clamp((rho - (1.0 - BEVEL)) / BEVEL, 0.0, 1.0); // 0 on the flat top, 1 at the rim
  let foot = k * max(abs(m.y), shown);
  var col = under(U.map.xy + q * shown * k, foot);
  if (s > 0.0) {
    let rb = dispersed(rho, mag, m.x);
    col = vec3f(under(U.map.xy + q * rb.x * k, foot).r, col.g, under(U.map.xy + q * rb.y * k, foot).b);
  }
  col = mix(col, glassLight(col, rho, s, dir, R, d, 1.0), U.look.x);
  return vec4f(col * cv, cv) + out * (1.0 - cv);
}
