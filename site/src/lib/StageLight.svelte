<!-- The light on a feature's stage, ported from Tony's site (`site/src/lib/StageLight.svelte`): a spot rising from a
     bottom corner, a floor that brightens toward it, and the window's shadow. CSS gradients and a big box-shadow step
     through 8-bit tones in visible rings; WebGL works in floats and dithers, so the light and the shadow run smooth. One
     WebGL context draws every stage, each copied into its own 2D canvas. Until it draws, or without WebGL, a CSS
     version shows with a fine grain, `lit` stays false, and the window keeps its CSS shadow. -->
<script module lang="ts">
	import type { Attachment } from 'svelte/attachments';

	type Point = readonly [x: number, y: number];
	type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

	// Shares of the stage: the spot's centre and radii, and the floor's gradient from its page end to its lit end.
	type Lighting = Readonly<{ spot: Point; spread: Point; floorFrom: Point; floorTo: Point }>;

	export type Side = 'left' | 'right';

	const LIGHTING: Record<Side, Lighting> = {
		left: { spot: [0, 1], spread: [1.1, 1.3], floorFrom: [1, 0], floorTo: [0, 1] },
		right: { spot: [1, 1], spread: [1.1, 1.3], floorFrom: [0, 0], floorTo: [1, 1] },
	};

	// The window's `0 32px 64px -24px` box-shadow, in CSS pixels.
	const CAST = { offset: 32, blur: 64, spread: -24 } as const;

	type Cast = Readonly<{
		rect: readonly [x: number, y: number, width: number, height: number];
		radius: number;
		sigma: number;
		offset: number;
		spread: number;
	}>;

	type Scene = Readonly<{
		lighting: Lighting;
		page: Rgba;
		ink: Rgba;
		strength: number;
		shadow: Rgba;
		cast: Cast | null;
	}>;

	type Renderer = Readonly<{
		source: HTMLCanvasElement;
		draw: (width: number, height: number, scene: Scene) => void;
	}>;

	const NO_CAST: Cast = { rect: [0, 0, 0, 0], radius: 0, sigma: 1, offset: 0, spread: 0 };

	const VERTEX = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0., 1.); }';

	const FRAGMENT = `
precision highp float;

uniform vec2 size;
uniform vec3 page;
uniform vec3 ink;
uniform vec2 spot;
uniform vec2 spread;
uniform vec2 floorFrom;
uniform vec2 floorTo;
uniform float strength;
uniform vec4 caster;
uniform float casterRadius;
uniform float shadowSigma;
uniform float shadowOffset;
uniform float shadowSpread;
uniform vec4 shadow;

float softClamp(float x, float knee) {
	float halfKnee = knee * .5;
	if (x <= -halfKnee) return 0.;
	if (x < halfKnee) return (x + halfKnee) * (x + halfKnee) / (2. * knee);
	if (x <= 1. - halfKnee) return x;
	if (x < 1. + halfKnee) return 1. - (1. + halfKnee - x) * (1. + halfKnee - x) / (2. * knee);
	return 1.;
}

float whiteNoise(vec2 point) {
	vec3 p = fract(vec3(point.xyx) * .1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

vec2 erf(vec2 x) {
	vec2 s = sign(x);
	vec2 a = abs(x);
	x = 1. + (.278393 + (.230389 + .078108 * (a * a)) * a) * a;
	x *= x;
	return s - s / (x * x);
}

float gaussian(float x, float sigma) {
	return exp(-(x * x) / (2. * sigma * sigma)) / (2.5066282746 * sigma);
}

// A rounded box's Gaussian shadow, as the browser draws a box-shadow: exact across, 8 samples down.
float shadowRow(float x, float y, float sigma, float corner, vec2 halfSize) {
	float delta = min(halfSize.y - corner - abs(y), 0.);
	float curved = halfSize.x - corner + sqrt(max(0., corner * corner - delta * delta));
	vec2 integral = .5 + .5 * erf((x + vec2(-curved, curved)) * (.7071067812 / sigma));
	return integral.y - integral.x;
}

float roundedBoxShadow(vec2 lower, vec2 upper, vec2 point, float sigma, float corner) {
	vec2 halfSize = max((upper - lower) * .5, 0.);
	point -= (lower + upper) * .5;
	corner = min(corner, min(halfSize.x, halfSize.y));
	float start = clamp(-3. * sigma, point.y - halfSize.y, point.y + halfSize.y);
	float end = clamp(3. * sigma, point.y - halfSize.y, point.y + halfSize.y);
	float stride = (end - start) / 8.;
	float y = start + stride * .5;
	float value = 0.;
	for (int i = 0; i < 8; i++) {
		value += shadowRow(point.x, point.y - y, sigma, corner, halfSize) * gaussian(y, sigma) * stride;
		y += stride;
	}
	return value;
}

void main() {
	vec2 uv = vec2(gl_FragCoord.x / size.x, 1. - gl_FragCoord.y / size.y);

	vec2 axis = floorTo - floorFrom;
	float floorPosition = dot(uv - floorFrom, axis) / dot(axis, axis);
	vec3 floorTone = mix(page, ink, .1125 * strength);
	vec3 color = mix(page, floorTone, softClamp(floorPosition, .2));

	float spotDistance = length((uv - spot) / spread);
	color = mix(color, ink, .1875 * strength * softClamp(1. - spotDistance, .3));
	color += (ink - page) * .0186 * strength;

	if (shadow.a > 0.) {
		vec2 point = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
		vec2 lower = caster.xy - shadowSpread + vec2(0., shadowOffset);
		vec2 upper = caster.xy + caster.zw + shadowSpread + vec2(0., shadowOffset);
		float corner = max(casterRadius + shadowSpread, 0.);
		color = mix(color, shadow.rgb, shadow.a * roundedBoxShadow(lower, upper, point, shadowSigma, corner));
	}

	// Triangular noise of one 8-bit level either way hides the steps.
	float dither = whiteNoise(gl_FragCoord.xy) + whiteNoise(gl_FragCoord.xy + 71.37) - 1.;
	gl_FragColor = vec4(color + dither / 255., 1.);
}`;

	const repaints = new Set<() => void>();
	let renderer: Renderer | null = null;
	let unavailable = false;
	let probe: CanvasRenderingContext2D | null = null;

	// Any CSS color, `light-dark()` and `color-mix()` included, as the browser paints it.
	function toRgba(color: string): Rgba {
		probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
		if (!probe) return [0, 0, 0, 0];
		probe.clearRect(0, 0, 1, 1);
		probe.fillStyle = 'transparent';
		probe.fillStyle = color.trim();
		probe.fillRect(0, 0, 1, 1);
		const [red = 0, green = 0, blue = 0, alpha = 0] = probe.getImageData(0, 0, 1, 1).data;
		return [red / 255, green / 255, blue / 255, alpha / 255];
	}

	function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
	}

	function link(gl: WebGLRenderingContext): WebGLProgram | null {
		const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
		const program = gl.createProgram();
		if (!vertex || !fragment || !program) return null;
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
	}

	function create(source: HTMLCanvasElement): Renderer | null {
		const gl = source.getContext('webgl', {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: true,
			powerPreference: 'low-power',
		});
		if (!gl) return null;
		const program = link(gl);
		if (!program) return null;
		gl.useProgram(program);
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, 'position');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
		const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
		const size = uniform('size');
		const page = uniform('page');
		const ink = uniform('ink');
		const spot = uniform('spot');
		const spread = uniform('spread');
		const floorFrom = uniform('floorFrom');
		const floorTo = uniform('floorTo');
		const strength = uniform('strength');
		const caster = uniform('caster');
		const casterRadius = uniform('casterRadius');
		const shadowSigma = uniform('shadowSigma');
		const shadowOffset = uniform('shadowOffset');
		const shadowSpread = uniform('shadowSpread');
		const shadow = uniform('shadow');

		return {
			source,
			draw(width, height, scene) {
				if (source.width !== width) source.width = width;
				if (source.height !== height) source.height = height;
				gl.viewport(0, 0, width, height);
				gl.uniform2f(size, width, height);
				gl.uniform3fv(page, scene.page.slice(0, 3));
				gl.uniform3fv(ink, scene.ink.slice(0, 3));
				gl.uniform2f(spot, ...scene.lighting.spot);
				gl.uniform2f(spread, ...scene.lighting.spread);
				gl.uniform2f(floorFrom, ...scene.lighting.floorFrom);
				gl.uniform2f(floorTo, ...scene.lighting.floorTo);
				gl.uniform1f(strength, scene.strength);
				const cast = scene.cast ?? NO_CAST;
				const [red, green, blue, opacity] = scene.shadow;
				gl.uniform4f(caster, ...cast.rect);
				gl.uniform1f(casterRadius, cast.radius);
				gl.uniform1f(shadowSigma, cast.sigma);
				gl.uniform1f(shadowOffset, cast.offset);
				gl.uniform1f(shadowSpread, cast.spread);
				gl.uniform4f(shadow, red, green, blue, scene.cast ? opacity : 0);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			},
		};
	}

	function shared(): Renderer | null {
		if (renderer || unavailable) return renderer;
		const source = document.createElement('canvas');
		source.addEventListener('webglcontextlost', (event) => {
			event.preventDefault();
			renderer = null;
		});
		source.addEventListener('webglcontextrestored', () => {
			renderer = create(source);
			unavailable = renderer === null;
			for (const repaint of repaints) repaint();
		});
		renderer = create(source);
		unavailable = renderer === null;
		return renderer;
	}

	// The caster's box and corner in the canvas's device pixels.
	function castOf(canvas: HTMLCanvasElement, caster: Element): Cast {
		const stage = canvas.getBoundingClientRect();
		const box = caster.getBoundingClientRect();
		const scale = stage.width > 0 ? canvas.width / stage.width : 1;
		// Media's frame sets its corner in percentages of its box (`a% / b%`), and the computed style keeps them.
		const [across = '', down = across] = getComputedStyle(caster).borderTopLeftRadius.split(' ');
		const length = (value: string, size: number): number =>
			(Number.parseFloat(value) || 0) * (value.endsWith('%') ? size / 100 : 1);
		return {
			rect: [(box.left - stage.left) * scale, (box.top - stage.top) * scale, box.width * scale, box.height * scale],
			radius: Math.min(length(across, box.width), length(down, box.height)) * scale,
			sigma: (CAST.blur / 2) * scale,
			offset: CAST.offset * scale,
			spread: CAST.spread * scale,
		};
	}

	function deviceSize(entry: ResizeObserverEntry): [number, number] {
		const width = Math.round(entry.contentRect.width * devicePixelRatio);
		const height = Math.round(entry.contentRect.height * devicePixelRatio);
		const exact = entry.devicePixelContentBoxSize?.[0];
		return exact && Math.abs(exact.inlineSize - width) <= 2 && Math.abs(exact.blockSize - height) <= 2
			? [exact.inlineSize, exact.blockSize]
			: [width, height];
	}

	// Paints the stage while it is near the viewport, on resize and theme changes.
	function light(
		lighting: Lighting,
		ready: (lit: boolean) => void,
		caster: Element | undefined,
	): Attachment<HTMLCanvasElement> {
		return (canvas) => {
			let visible = false;

			function paint(): void {
				if (!visible || canvas.width === 0 || canvas.height === 0) return;
				const gl = shared();
				const target = canvas.getContext('2d');
				if (!gl || !target) {
					ready(false);
					return;
				}
				const style = getComputedStyle(canvas);
				gl.draw(canvas.width, canvas.height, {
					lighting,
					page: toRgba(style.borderTopColor),
					ink: toRgba(style.color),
					strength: Number.parseFloat(style.getPropertyValue('--strength')) || 1,
					shadow: toRgba(style.getPropertyValue('--shadow')),
					cast: caster ? castOf(canvas, caster) : null,
				});
				target.drawImage(gl.source, 0, 0);
				ready(true);
			}

			const resized = new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (entry.target === canvas) [canvas.width, canvas.height] = deviceSize(entry);
				}
				paint();
			});
			const seen = new IntersectionObserver(
				([entry]) => {
					visible = entry?.isIntersecting ?? false;
					paint();
				},
				{ rootMargin: '200px' },
			);
			const themed = new MutationObserver(paint);
			const scheme = matchMedia('(prefers-color-scheme: dark)');
			try {
				resized.observe(canvas, { box: 'device-pixel-content-box' });
			} catch {
				resized.observe(canvas);
			}
			if (caster) resized.observe(caster);
			seen.observe(canvas);
			themed.observe(document.documentElement, { attributeFilter: ['data-theme'] });
			scheme.addEventListener('change', paint);
			repaints.add(paint);
			return () => {
				resized.disconnect();
				seen.disconnect();
				themed.disconnect();
				scheme.removeEventListener('change', paint);
				repaints.delete(paint);
			};
		};
	}
</script>

<script lang="ts">
	type Props = {
		side: Side; // the bottom corner the light rises from
		caster?: Element | undefined;
		lit?: boolean;
	};

	let { side, caster, lit = $bindable(false) }: Props = $props();
</script>

<div class={['light', side, { lit }]} aria-hidden="true">
	<canvas width="0" height="0" {@attach light(LIGHTING[side], (ready) => (lit = ready), caster)}></canvas>
</div>

<style>
	.light {
		--strength: 0.5;
		--shadow: rgb(24 20 19 / 0.28);
		--spot: 0% 100%;
		--floor: 225deg;
		position: absolute;
		isolation: isolate;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(
				110% 130% at var(--spot),
				color-mix(in srgb, var(--stage-ink) calc(18.75% * var(--strength)), transparent),
				transparent
			),
			linear-gradient(
				var(--floor),
				var(--surface-root),
				color-mix(in srgb, var(--stage-ink) calc(11.25% * var(--strength)), var(--surface-root))
			);
	}

	.right {
		--spot: 100% 100%;
		--floor: 135deg;
	}

	:global(:root[data-theme='dark']) .light {
		--strength: 1;
		--shadow: rgb(0 0 0 / 0.7);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) .light {
			--strength: 1;
			--shadow: rgb(0 0 0 / 0.7);
		}
	}

	.light::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
		background-size: 180px 180px;
		mix-blend-mode: soft-light;
		opacity: 0.5;
	}

	.lit {
		background: none;
	}

	.lit::after {
		content: none;
	}

	/* The canvas reads the page from its border color and the light from its text color. */
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border-top-color: var(--surface-root);
		color: var(--stage-ink);
		visibility: hidden;
	}

	.lit canvas {
		visibility: visible;
	}
</style>
