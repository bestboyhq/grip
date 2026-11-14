// Sky: the four colors of a picture's sky that run into each other, and nothing in front of them.

fn wp_sky(uv: vec2f, wh: vec2f) -> vec3f {
  return oklabToSrgb(sky(sheet(uv, wh)));
}
