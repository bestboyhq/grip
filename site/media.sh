#!/bin/sh
# The page's looping clips and their stills, from the app's exports of the README demos: run `sh site/media.sh`
# after `scripts/readme/export.ts`, which leaves them in .context/readme without the frame the page's cards draw.
# Each is the app's light take (<name>-light.mp4), which the page shows in either of its themes.
# A clip is H.264 at web size for every browser, at level 5.1 so every Mac decodes it in hardware: left
# alone, the veryslow preset's 16 reference frames push the hero to level 6, which sends older Macs to
# software decoding. Its still is the frame at the time after its name, shown until the clip plays and
# instead of it under reduced motion. Needs ffmpeg and cwebp.
set -e
cd "$(dirname "$0")"
mkdir -p static/media
for clip in hero:0.1 loupe:1.3 captions:7.1 macbook:9.9 formats:7.6; do
	name=${clip%:*}
	src=../.context/readme/$name-light.mp4
	ffmpeg -v error -y -i "$src" -an -c:v libx264 -preset veryslow -crf 26 -level:v 5.1 -pix_fmt yuv420p \
		-vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' -movflags +faststart "static/media/$name.mp4"
	ffmpeg -v error -y -ss "${clip#*:}" -i "$src" -frames:v 1 "static/media/$name.png"
	cwebp -quiet -q 88 "static/media/$name.png" -o "static/media/$name.webp"
	rm "static/media/$name.png"
done
