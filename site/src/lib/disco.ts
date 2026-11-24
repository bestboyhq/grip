// The strip's mirror ball and the light it throws, drawn every frame from one model: two spotlights on a turning ball
// of mirror tiles, each tilted a hair. The ball shows what each tile reflects toward you: the strip it hangs from, its
// colors flowing as the strip's do, and the seam below it; a tile that sends a laser takes the laser's color. The
// light shows where each tile sends a spotlight: a laser beam to a spot on the page, or to the hero's seam, which stops
// it and lights up. Each shaft and spot takes the seam's color under where it lands, so the light is the seam's
// gradient fanned out.
// The light covers the window, which the strip stays at the top of as the page scrolls under it. It sits behind the
// hero's text and buttons and in front of the top bar and what is above the hero, or in front of all of it while the
// page is dimmed behind a dialog; the seam's light and the ball's glints sit in front of everything.

type RGB = number[];

// The look, tuned by eye: the ball's tiles, its turn in ms, and the light's strength, beams, and fan.
export type Tuning = Readonly<{
	rows: number;
	grout: number;
	groutColor: string;
	specPow: number;
	turn: number;
	gain: number;
	// The share of tiles that send no shaft, and the shafts' strength.
	beams: number;
	beamAlpha: number;
	// How far the light fans out sideways, against a real wall's 1.
	spread: number;
	// Radians from straight down where the light starts to fade, and where it is gone.
	fan: readonly [number, number];
	// A shaft's width where it lands, in px: a base and a share of its length.
	width: readonly [number, number];
	// A shaft's softness across, in px of its 64 px sprite: at the ball, and how much more where it lands.
	sigma: readonly [number, number];
	halo: number;
	// How long the spotlights take to come on once the ball is down, in ms; they go off in 160.
	rise: number;
}>;

export type Parts = Readonly<{
	// The strip the ball hangs from, which `front` and the ball sit in.
	strip: HTMLElement;
	ball: HTMLCanvasElement;
	// The light above the hero, over everything, and in the hero, behind its text and buttons.
	front: HTMLCanvasElement;
	back: HTMLCanvasElement;
	// The line that stops the light, and where the light goes behind the page, never above the top bar's bottom.
	seam: Element | null;
	bar: Element | null;
	hero: Element | null;
	// Where the strip's gradient is in its sweep, in sweeps.
	phase: () => number;
	// Whether all the light is in front of the page, as over the dim behind a dialog.
	above: () => boolean;
	// Reduced motion: one still frame.
	still: boolean;
}>;

const TAU = Math.PI * 2;
const WALL = 250; // how far behind the ball the page stands, in px
const TILT = -0.32; // its axis leans back, so you look up at it a little
const unit = (x: number, y: number, z: number): RGB => {
	const l = Math.hypot(x, y, z);
	return [x / l, y / l, z / l];
};
// Where the two spotlights shine from: up and in front, one from the left and one from the right.
const LIGHTS = [unit(-0.38, 0.62, 0.68), unit(0.5, 0.5, 0.7)];
const hash = (a: number, b: number): number => {
	let h = (a * 374761393 + b * 668265263) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: RGB, b: RGB, k: number): RGB => a.map((v, i) => v + (b[i] - v) * k);
type Stops = [number, RGB][];
const ramp = (stops: Stops, x: number): RGB => {
	if (x <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++)
		if (x <= stops[i][0])
			return mix(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
	return stops[stops.length - 1][1];
};
// The strip's gradient and the seam's, as their CSS draws them: the seam's across the page's column.
const STRIP: Stops = ['#1d4ed8', '#7c3aed', '#c2410c', '#7c3aed', '#1d4ed8'].map((h, i) => [i / 4, hex(h)]);
const SEAM: Stops = (
	[
		[0.18, '#1957fa'],
		[0.32, '#6365cd'],
		[0.44, '#9e6594'],
		[0.58, '#d35351'],
		[0.7, '#ed3e11'],
		[0.82, '#fb8400'],
	] as const
).map(([p, h]) => [p, hex(h)]);
// The light's colors: the seam's, in steps across it.
const HUES = 24;
const COLORS = Array.from({ length: HUES }, (_, i) => ramp(SEAM, (i + 0.5) / HUES));
// The color a tile takes while it sends a laser, and the deep violet tiles fade to: never to black, which turns
// orange to brown.
const LIT = COLORS.map((c) => c.map((v) => v * 1.25 + 50));
const DEEP = [14, 8, 34];

// What a tile reflects, by direction (x right, y up, z toward you): the strip, as it is at `g` of its sweep, beside and
// above the ball, and the seam below it.
const env = (R: RGB, g: number): RGB =>
	R[1] > -0.2 ? ramp(STRIP, (((0.25 + R[0] * 0.42 - g) % 1) + 1) % 1) : ramp(SEAM, 0.5 + R[0] * 0.384);

const canvas = (w: number, h: number): HTMLCanvasElement => {
	const el = document.createElement('canvas');
	[el.width, el.height] = [w, h];
	return el;
};
const context = (el: HTMLCanvasElement): CanvasRenderingContext2D => {
	const ctx = el.getContext('2d');
	if (!ctx) throw new Error('No 2D canvas');
	return ctx;
};
const rgb = (c: RGB): string => c.map(Math.round).join(',');
const glow = (c: RGB): HTMLCanvasElement => {
	const el = canvas(64, 64);
	const g = context(el);
	const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.16, `rgba(${rgb(c)},.9)`);
	grad.addColorStop(0.45, `rgba(${rgb(c)},.28)`);
	grad.addColorStop(1, `rgba(${rgb(c)},0)`);
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	return el;
};

// Starts drawing, and returns what stops it.
export function disco(parts: Parts, V: Tuning): () => void {
	const { strip, ball: ballEl, front: frontEl, back: backEl, seam: floorEl, bar, hero, phase, above, still } = parts;
	const DPR = Math.min(2, devicePixelRatio || 1);

	// The tiles: rows of near-square ones from pole to pole, each row offset from the last.
	// `shade` is how much of its reflection a tile shows, over deep violet; `lit` is the strength of the laser it sends
	// this frame, in the color `hue`.
	type Tile = {
		lat: number;
		lon: number;
		shade: number;
		beam: number;
		n: RGB;
		color: RGB;
		spec: number;
		lit: number;
		hue: number;
	};
	const rows: { cols: number; gv: number; tiles: Tile[] }[] = [];
	for (let r = 0; r < V.rows; r++) {
		const lat = -Math.PI / 2 + ((r + 0.5) * Math.PI) / V.rows;
		const cols = Math.max(4, Math.round(V.rows * 2 * Math.cos(lat)));
		const tiles: Tile[] = [];
		for (let c = 0; c < cols; c++)
			tiles.push({
				lat: lat + (hash(r, c) - 0.5) * 0.09,
				lon: ((c + 0.5) / cols) * TAU - r * 0.37 + (hash(c, r + 50) - 0.5) * 0.09,
				shade: 0.3 + hash(r + 9, c) * 0.7,
				beam: hash(r + 3, c + 7),
				n: [0, 0, 1],
				color: [0, 0, 0],
				spec: 0,
				lit: 0,
				hue: 0,
			});
		rows.push({ cols, gv: (V.grout * (Math.PI / V.rows)) / ((Math.cos(lat) * TAU) / cols), tiles });
	}
	const all = rows.flatMap((row) => row.tiles);
	const GAIN = V.gain * Math.sqrt(150 / all.length); // about the same light, whatever the tile count

	// Each tile's normal as you see it at turn `theta`, and how straight it sends a spotlight at you. No tile sends a
	// laser yet.
	const turn = (theta: number): void => {
		const [c, s, ct, st] = [Math.cos(theta), Math.sin(theta), Math.cos(TILT), Math.sin(TILT)];
		for (const f of all) {
			const cl = Math.cos(f.lat);
			const [bx, by, bz] = [cl * Math.sin(f.lon), Math.sin(f.lat), cl * Math.cos(f.lon)];
			const x1 = bx * c + bz * s;
			const z1 = -bx * s + bz * c;
			const n = f.n;
			n[0] = x1;
			n[1] = by * ct - z1 * st;
			n[2] = by * st + z1 * ct;
			const R = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
			f.spec = Math.max(...LIGHTS.map((L) => R[0] * L[0] + R[1] * L[1] + R[2] * L[2]), 0) ** V.specPow;
			f.lit = 0;
		}
	};
	// Each tile's color, with the strip at `g` of its sweep and the spotlights at `lit` of their strength: its reflection
	// over deep violet, washed in the color of the laser it sends, and the spotlights' glare.
	const shine = (g: number, lit: number): void => {
		for (const f of all) {
			const n = f.n;
			const c = mix(
				DEEP,
				env([2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1], g).map((v) => v * 1.3 + 18),
				f.shade,
			);
			const k = Math.min(1, f.lit * 3);
			const hot = f.spec * 900 * lit;
			f.color = c.map((v, i) => v + (LIT[f.hue][i] - v) * k + hot);
		}
	};

	// The ball, pixel by pixel: which tile each pixel shows, or the grout between tiles.
	const bctx = context(ballEl);
	const GROUT = hex(V.groutColor);
	let N = 0;
	let img = bctx.createImageData(1, 1);
	let pixels: { k: number; x: number; y: number; z: number; cover: number }[] = [];
	const setup = (size: number): void => {
		N = Math.max(8, Math.round(size * DPR));
		ballEl.width = ballEl.height = N;
		img = bctx.createImageData(N, N);
		pixels = [];
		for (let j = 0; j < N; j++)
			for (let i = 0; i < N; i++) {
				const x = ((i + 0.5) / N) * 2 - 1;
				const y = -(((j + 0.5) / N) * 2 - 1);
				const d2 = x * x + y * y;
				const cover = Math.min(1, Math.max(0, (1 - Math.sqrt(d2)) * (N / 2) + 0.5));
				if (cover) pixels.push({ k: (j * N + i) * 4, x, y, z: Math.sqrt(Math.max(0, 1 - d2)), cover });
			}
	};
	const paint = (theta: number): void => {
		const [c, s, ct, st] = [Math.cos(theta), Math.sin(theta), Math.cos(TILT), Math.sin(TILT)];
		const d = img.data;
		for (const p of pixels) {
			const by = p.y * ct + p.z * st;
			const z1 = -p.y * st + p.z * ct;
			const bx = p.x * c - z1 * s;
			const bz = p.x * s + z1 * c;
			const fr = ((Math.asin(Math.max(-1, Math.min(1, by))) + Math.PI / 2) / Math.PI) * V.rows;
			const r = Math.min(V.rows - 1, Math.floor(fr));
			const fu = fr - r;
			const row = rows[r];
			const u = (((((Math.atan2(bx, bz) + r * 0.37) / TAU) % 1) + 1) % 1) * row.cols;
			const fv = u - Math.floor(u);
			const grout = fu < V.grout || fu > 1 - V.grout || fv < row.gv || fv > 1 - row.gv;
			const color = grout ? GROUT : row.tiles[Math.floor(u) % row.cols].color;
			// Toward the edge the tiles fade to deep violet, not to black.
			const limb = 0.55 + 0.45 * p.z;
			d[p.k] = DEEP[0] + (color[0] - DEEP[0]) * limb;
			d[p.k + 1] = DEEP[1] + (color[1] - DEEP[1]) * limb;
			d[p.k + 2] = DEEP[2] + (color[2] - DEEP[2]) * limb;
			d[p.k + 3] = 255 * p.cover;
		}
		bctx.putImageData(img, 0, 0);
	};

	// The light: soft sprites drawn once, added up every frame.
	const SPOTS = COLORS.map(glow);
	const HALO = glow(hex('#9b5cff'));
	const STAR = (() => {
		const el = canvas(64, 64);
		const g = context(el);
		const ray = (x0: number, y0: number, x1: number, y1: number): CanvasGradient => {
			const gr = g.createLinearGradient(x0, y0, x1, y1);
			gr.addColorStop(0, 'rgba(255,255,255,0)');
			gr.addColorStop(0.5, 'rgba(255,255,255,1)');
			gr.addColorStop(1, 'rgba(255,255,255,0)');
			return gr;
		};
		g.fillStyle = ray(0, 32, 64, 32);
		g.fillRect(0, 31, 64, 2);
		g.fillStyle = ray(32, 0, 32, 64);
		g.fillRect(31, 0, 2, 64);
		const core = g.createRadialGradient(32, 32, 0, 32, 32, 9);
		core.addColorStop(0, 'rgba(255,255,255,1)');
		core.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = core;
		g.fillRect(0, 0, 64, 64);
		return el;
	})();
	// A laser beam: thin at the ball, a little wider and fainter where it lands. Drawn once in white, then
	// once in each color.
	const SHAFT = (() => {
		const [w, h] = [256, 64];
		const el = canvas(w, h);
		const g = context(el);
		const im = g.createImageData(w, h);
		for (let j = 0; j < h; j++)
			for (let i = 0; i < w; i++) {
				const u = (i + 0.5) / w;
				const dy = j + 0.5 - h / 2;
				const k = (j * w + i) * 4;
				im.data[k] = im.data[k + 1] = im.data[k + 2] = 255;
				im.data[k + 3] =
					255 *
					Math.min(1, u * 14) *
					(1 - 0.6 * u) *
					Math.exp(-((dy / (V.sigma[0] + u * V.sigma[1])) ** 2));
			}
		g.putImageData(im, 0, 0);
		return el;
	})();
	const SHAFTS = COLORS.map((c) => {
		const el = canvas(SHAFT.width, SHAFT.height);
		const g = context(el);
		g.drawImage(SHAFT, 0, 0);
		g.globalCompositeOperation = 'source-in';
		g.fillStyle = `rgb(${rgb(c)})`;
		g.fillRect(0, 0, el.width, el.height);
		return el;
	});
	const front = context(frontEl);
	const back = context(backEl);
	const light = context(canvas(1, 1));
	const SCALE = DPR;
	let W = 0;
	let H = 0;
	let floor = Infinity;
	let band = 0; // where the hero or the top bar ends: above it the light is in front, below it behind
	let backTop = 0;
	let cx = 0;
	let cy = 0;
	let rad = 0;
	// The page's column, which the seam's gradient spans as `.wrap` does.
	let colX = 0;
	let colW = 1;
	const measure = (): void => {
		const s = strip.getBoundingClientRect();
		const b = ballEl.getBoundingClientRect();
		if (Math.round(b.width * DPR) !== N) setup(b.width);
		rad = b.width / 2;
		const col = (floorEl ?? hero)?.querySelector('.wrap')?.getBoundingClientRect();
		[colX, colW] = col?.width ? [col.left - s.left, col.width] : [0, strip.clientWidth];
		if (W === strip.clientWidth && H === innerHeight) return;
		[W, H] = [strip.clientWidth, innerHeight];
		for (const el of [frontEl, backEl]) {
			el.style.height = `${H}px`;
			el.width = Math.ceil(W * SCALE);
			el.height = Math.ceil(H * SCALE);
		}
		[light.canvas.width, light.canvas.height] = [frontEl.width, frontEl.height];
	};
	const reset = (ctx: CanvasRenderingContext2D, dy = 0): void => {
		ctx.setTransform(SCALE, 0, 0, SCALE, 0, -dy * SCALE);
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.clearRect(0, dy, W, H);
		ctx.globalCompositeOperation = 'lighter';
	};
	// Draws `sprite` from (x0, y0) toward (x1, y1), `len` long and `w` wide.
	const toward = (
		ctx: CanvasRenderingContext2D,
		sprite: HTMLCanvasElement,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		len: number,
		w: number,
	): void => {
		const a = Math.atan2(y1 - y0, x1 - x0);
		const [c, s] = [Math.cos(a) * SCALE, Math.sin(a) * SCALE];
		ctx.setTransform(c, s, -s, c, x0 * SCALE, y0 * SCALE);
		ctx.drawImage(sprite, 0, -w / 2, len, w);
		ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
	};
	// The color under `x`, of the seam's at that point across the column.
	const hue = (x: number): number => Math.max(0, Math.min(HUES - 1, Math.floor(((x - colX) / colW) * HUES)));
	const spot = (x: number, y: number, r: number, a: number): void => {
		light.globalAlpha = Math.min(1, a);
		light.drawImage(SPOTS[hue(x)], x - r * 3, y - r * 3, r * 6, r * 6);
	};
	// A shaft the seam stops: a streak along the seam, a hot core, and light thrown back up, all in the seam's color
	// there, fading out where the seam does.
	const hit = (x: number, y: number, a: number, slope: number): void => {
		const k = (x - colX) / colW;
		const edge = Math.max(0, Math.min(1, (k - 0.04) / 0.14, (0.96 - k) / 0.14));
		const lit = SPOTS[hue(x)];
		a *= 0.3 + 0.7 * edge;
		const w = Math.min(280, 80 + slope * 80);
		front.globalAlpha = Math.min(1, a * 1.4);
		front.drawImage(lit, x - w / 2, y - 6, w, 12);
		front.globalAlpha = Math.min(1, a * 0.4);
		front.drawImage(lit, x - 26, y - 44, 52, 70);
		front.globalAlpha = Math.min(1, a * 1.1);
		front.drawImage(lit, x - 8, y - 8, 16, 16);
	};
	const sparkle = (x: number, y: number, s: number): void => {
		const z = (12 + s * 26) * (rad / 30);
		front.globalAlpha = Math.min(1, s * 1.6);
		front.drawImage(STAR, x - z / 2, y - z / 2, z, z);
	};

	// The party: while the strip has the class `on`, the ball comes down, and once it is down the spotlights come on
	// (`level` to 1); without it, they go off and the ball goes back up.
	let level = 0;
	let last = 0;
	// The ball, and the page as it scrolls under the strip: the seam stops the light only while it is below the ball.
	const place = (): { gone: boolean; down: boolean } => {
		const s = strip.getBoundingClientRect();
		const b = ballEl.getBoundingClientRect();
		[cx, cy] = [b.left - s.left + b.width / 2, b.top - s.top + b.height / 2];
		const seam = floorEl ? floorEl.getBoundingClientRect().top - s.top : Infinity;
		floor = seam > cy + rad ? seam : Infinity;
		const top = hero?.getBoundingClientRect().top ?? s.top;
		band = Math.max(top, bar?.getBoundingClientRect().bottom ?? top) - s.top;
		backTop = backEl.getBoundingClientRect().top - s.top;
		return { gone: b.bottom <= s.top, down: b.top - s.top >= ballEl.offsetTop - 3 };
	};
	// Draws the moment `t`, and says whether there is nothing more to draw until the strip turns on again.
	const draw = (t: number): boolean => {
		const { gone, down } = place();
		const on = strip.classList.contains('on');
		const want = on && down ? 1 : 0;
		level = still
			? want
			: level + (want - level) * (1 - Math.exp(-Math.min(100, Math.max(0, t - last)) / (want ? V.rise : 160)));
		last = t;
		const glow = level;
		reset(front);
		reset(back, backTop);
		if (gone) return !on && level < 0.002; // the ball is up and the light is out
		const theta = (t / V.turn) * TAU;
		turn(theta);
		if (glow < 0.002) {
			shine(phase(), glow);
			paint(theta);
			return false;
		}
		reset(light);
		const seen: [number, number, number, number][] = [];
		for (const L of LIGHTS)
			for (const f of all) {
				const n = f.n;
				const ln = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
				if (ln < 0.08) continue;
				const r = [2 * ln * n[0] - L[0], 2 * ln * n[1] - L[1], 2 * ln * n[2] - L[2]];
				if (r[2] > -0.1) continue; // toward you, not the page
				// The ray leaves from the tile itself, on the ball's surface, and meets the page `WALL` px behind the ball's
				// center.
				const [sx, sy, sz] = [cx + n[0] * rad, cy - n[1] * rad, n[2] * rad];
				const dist = (WALL + sz) / -r[2];
				// The light fans out less sideways than it would off a real wall, so it falls mostly below the ball.
				const [px, py] = [sx + r[0] * dist * V.spread, sy - r[1] * dist];
				if (py < cy) continue; // up past the top of the page
				// Past `V.fan[0]` radians from straight down the light fades out, and past `V.fan[1]` it is gone, so the fan
				// stays narrow.
				const fan =
					1 -
					Math.min(1, Math.max(0, (Math.atan2(Math.abs(px - cx), py - cy) - V.fan[0]) / (V.fan[1] - V.fan[0])));
				if (!fan) continue;
				const power = GAIN * ln * (0.5 + 0.5 * f.beam) * fan * fan * (3 - 2 * fan);
				// The seam is the top of a shelf that runs from you to the page: a ray stops where it meets that plane,
				// which seen from the front is where its line crosses the seam. Its light goes no further, and is that much
				// brighter.
				const seam = py > floor;
				const [ex, ey] = seam ? [sx + ((px - sx) * (floor - sy)) / (py - sy), floor] : [px, py];
				const a = power / (1 + Math.hypot(ex - cx, ey - cy) / 650);
				if (a * glow > f.lit) [f.lit, f.hue] = [a * glow, hue(ex)];
				if (seam) hit(ex, ey, a * glow, Math.abs((px - sx) / (py - sy)));
				else seen.push([px, py, 1.6 + dist * 0.008, a * glow]);
				if (f.beam <= V.beams) continue;
				// A tile on the far side of the ball sends its shaft from behind it: the ball hides the shaft until it
				// clears the outline.
				let [x0, y0] = [sx, sy];
				if (n[2] < 0) {
					const span = Math.hypot(ex - sx, ey - sy);
					const [ux, uy] = [(ex - sx) / span, (ey - sy) / span];
					const b = (sx - cx) * ux + (sy - cy) * uy;
					const out = -b + Math.sqrt(Math.max(0, b * b - ((sx - cx) ** 2 + (sy - cy) ** 2 - rad * rad)));
					if (out >= span) continue;
					[x0, y0] = [sx + ux * out, sy + uy * out];
				}
				const len = Math.hypot(ex - x0, ey - y0);
				light.globalAlpha = Math.min(1, a * V.beamAlpha * glow);
				toward(light, SHAFTS[hue(ex)], x0, y0, ex, ey, len, V.width[0] + len * V.width[1]);
			}
		shine(phase(), glow);
		paint(theta);
		// The glow around the ball, lit by all of it.
		light.globalAlpha = Math.min(1, V.halo * glow);
		light.drawImage(HALO, cx - rad * 3, cy - rad * 2, rad * 6, rad * 6);
		// The spots land on the page.
		for (const s of seen) spot(...s);
		// Above the hero the light is in front; in the hero it is behind the text and buttons, unless all of it is in
		// front. Each copy is whole: the seam's last hit left its own strength on `front`.
		const cut = above() ? H : Math.max(0, Math.min(H, band));
		const k = SCALE;
		front.setTransform(1, 0, 0, 1, 0, 0);
		front.globalAlpha = 1;
		if (cut > 0) front.drawImage(light.canvas, 0, 0, W * k, cut * k, 0, 0, W * k, cut * k);
		front.setTransform(k, 0, 0, k, 0, 0);
		back.setTransform(1, 0, 0, 1, 0, 0);
		const from = Math.max(cut, backTop);
		if (from < H)
			back.drawImage(
				light.canvas,
				0,
				from * k,
				W * k,
				(H - from) * k,
				0,
				(from - backTop) * k,
				W * k,
				(H - from) * k,
			);
		// The tiles that flash a spotlight straight at you.
		for (const f of all)
			if (f.spec * glow > 0.2 && f.n[2] > 0.2)
				sparkle(cx + f.n[0] * rad, cy - f.n[1] * rad, Math.min(1, f.spec * glow));
		front.globalAlpha = 1;
		return false;
	};

	// The light runs a frame at a time while the party is on, and stops once the ball is up. With reduced motion it
	// holds still at one moment, drawn again when the strip turns on or off, the window or page changes size, or the
	// page scrolls under the party.
	const resized = (): void => {
		measure();
		if (still) draw(4000);
	};
	const sizes = new ResizeObserver(resized);
	sizes.observe(document.body);
	addEventListener('resize', resized);
	const scrolled = (): void => {
		if (still && strip.classList.contains('on')) draw(4000);
	};
	addEventListener('scroll', scrolled, { passive: true });
	measure();
	let raf = 0;
	const frame = (now: number): void => {
		raf = draw(now) ? 0 : requestAnimationFrame(frame);
	};
	const wake = (): void => {
		if (still) draw(4000);
		else if (!raf) raf = requestAnimationFrame(frame);
	};
	const toggles = new MutationObserver(wake);
	toggles.observe(strip, { attributes: true, attributeFilter: ['class'] });
	wake();
	return () => {
		sizes.disconnect();
		toggles.disconnect();
		removeEventListener('resize', resized);
		removeEventListener('scroll', scrolled);
		cancelAnimationFrame(raf);
	};
}
