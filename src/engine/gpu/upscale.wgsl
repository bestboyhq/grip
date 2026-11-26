// The UI-text upscaler (scripts/upscale/train.py): where the output shows the recording past its pixel
// density, a small network trained on UI text redraws it SCALE times denser into upTex, which
// screenSample reads instead of the recording. Joined into the compositor's module, so it reads the
// recording the way screenTap does.
//
// Compute passes over F.up, a region of the recording in its px, one tile of it at a time: up_first
// reads the recording's luma, up_hidden runs a 3x3 layer on the features (rgba16float, 4 channels per
// array layer), and up_last adds the network's luma detail to the bilinear recording at each of the
// SCALE x SCALE points a recording px becomes. Color stays bilinear: the recording's chroma is half
// resolution anyway. Every point reads only its own neighborhood, so neither the region nor the tile
// changes a value: a tile's box reaches a halo past what it writes, and the margin upscale.ts leaves
// around what the frame samples holds every value that reads past the region's edge.

@group(0) @binding(41) var<storage, read> Wt: array<vec4f>; // [tap][in group][out group] mat4x4 as 4 columns, then the biases
@group(0) @binding(42) var featIn: texture_2d_array<f32>;
@group(0) @binding(43) var featOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(44) var upOut: texture_storage_2d<rgba8unorm, write>;
struct UpTile {
  box: vec4f, // recording px the passes run over, within F.up: x, y, w, h
  keep: vec4f, // box px up_last writes, x0, y0, x1, y1: the box less its halo
}
@group(0) @binding(45) var<uniform> U: UpTile;

override IN: u32; // input channel groups of 4
override OUT: u32; // output channel groups of 4
override SCALE: u32 = 2u;
const GROUPS = 4u; // most channel groups a layer has

fn upW(t: u32, i: u32, o: u32) -> mat4x4f {
  let k = ((t * IN + i) * OUT + o) * 4u;
  return mat4x4f(Wt[k], Wt[k + 1u], Wt[k + 2u], Wt[k + 3u]);
}
fn upB(o: u32) -> vec4f { return Wt[9u * IN * OUT * 4u + o]; }
fn upTap(t: u32) -> vec2i { return vec2i(i32(t % 3u) - 1, i32(t / 3u) - 1); }
fn upLuma(p: vec2i) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(textureDimensions(screenTex)) - 1); // the recording's edge repeats, as in training
  return dot(recorded(textureLoad(screenTex, q).rgb), vec3f(0.2126, 0.7152, 0.0722));
}

// A layer over features: acc = bias + sum over the 3x3 taps, edges held to the box's.
fn upLayer(p: vec2i) -> array<vec4f, GROUPS> {
  var acc: array<vec4f, GROUPS>;
  for (var o = 0u; o < OUT; o++) { acc[o] = upB(o); }
  let last = vec2i(U.box.zw) - 1;
  for (var t = 0u; t < 9u; t++) {
    let q = clamp(p + upTap(t), vec2i(0), last);
    for (var i = 0u; i < IN; i++) {
      let x = textureLoad(featIn, q, i, 0);
      for (var o = 0u; o < OUT; o++) { acc[o] += upW(t, i, o) * x; }
    }
  }
  return acc;
}

@compute @workgroup_size(8, 8) fn up_first(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy);
  if (any(p >= vec2i(U.box.zw))) { return; }
  var acc: array<vec4f, GROUPS>;
  for (var o = 0u; o < OUT; o++) { acc[o] = upB(o); }
  for (var t = 0u; t < 9u; t++) {
    let y = vec4f(upLuma(vec2i(U.box.xy) + p + upTap(t)), 0.0, 0.0, 0.0);
    for (var o = 0u; o < OUT; o++) { acc[o] += upW(t, 0u, o) * y; }
  }
  for (var o = 0u; o < OUT; o++) { textureStore(featOut, p, o, max(acc[o], vec4f(0.0))); }
}

@compute @workgroup_size(8, 8) fn up_hidden(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy);
  if (any(p >= vec2i(U.box.zw))) { return; }
  let acc = upLayer(p);
  for (var o = 0u; o < OUT; o++) { textureStore(featOut, p, o, max(acc[o], vec4f(0.0))); }
}

@compute @workgroup_size(8, 8) fn up_last(@builtin(global_invocation_id) id: vec3u) {
  let p = vec2i(id.xy);
  if (any(p < vec2i(U.keep.xy)) || any(p >= vec2i(U.keep.zw))) { return; }
  let acc = upLayer(p);
  let n = f32(SCALE);
  let size = vec2f(textureDimensions(screenTex));
  let to = vec2i(U.box.xy - F.up.xy) + p; // its px in upTex, over SCALE
  for (var c = 0u; c < SCALE * SCALE; c++) {
    let d = vec2u(c % SCALE, c / SCALE); // channel c is the point in column c % SCALE, row c / SCALE (pixel shuffle)
    let at = U.box.xy + vec2f(p) + (vec2f(d) + 0.5) / n; // its center, recording px
    let rgb = screenTap(at / size) + acc[c / 4u][c % 4u];
    textureStore(upOut, to * i32(SCALE) + vec2i(d), vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0));
  }
}
