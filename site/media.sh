#!/bin/sh
# The page's looping clips and their stills, from the README's GIFs: run `sh site/media.sh` after a GIF changes.
# A clip is H.264 for every browser, a few times smaller than its GIF; its still is the frame at the time after its name,
# shown until the clip plays and instead of it under reduced motion. Needs ffmpeg and cwebp.
set -e
cd "$(dirname "$0")"
mkdir -p static/media
for clip in hero:2.6 loupe:1.3 captions:7.1 macbook:9.9 formats:7.6; do
	name=${clip%:*}
	gif=../.github/readme/$name.gif
	ffmpeg -v error -y -i "$gif" -an -c:v libx264 -preset veryslow -crf 26 -pix_fmt yuv420p \
		-vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' -movflags +faststart "static/media/$name.mp4"
	ffmpeg -v error -y -ss "${clip#*:}" -i "$gif" -frames:v 1 "static/media/$name.png"
	cwebp -quiet -q 88 "static/media/$name.png" -o "static/media/$name.webp"
	rm "static/media/$name.png"
done
