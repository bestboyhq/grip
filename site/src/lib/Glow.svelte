<script module lang="ts">
	export type Box = readonly [x: number, y: number, width: number, height: number];

	export type Layer = Readonly<{
		box: Box;
		color?: string;
		peak: readonly [light: number, dark: number];
		start?: number;
	}>;

	const MAX = 3;

	const FRAGMENT = `
precision highp float;
uniform vec2 size;
uniform vec3 bg;
uniform vec4 box[${MAX}];
uniform vec3 color[${MAX}];
uniform float paint[${MAX}];
uniform float peak[${MAX}];
uniform float start[${MAX}];
uniform int count;
uniform float opacity, soft, grain, weighted, grow;

vec3 painting(float t) {
	vec3 c0 = vec3(25., 87., 250.) / 255., c1 = vec3(99., 101., 205.) / 255., c2 = vec3(158., 101., 148.) / 255.;
	vec3 c3 = vec3(211., 83., 81.) / 255., c4 = vec3(237., 62., 17.) / 255., c5 = vec3(251., 132., 0.) / 255.;
	if (t < .06) return c0;
	if (t < .26) return mix(c0, c1, (t - .06) / .20);
	if (t < .44) return mix(c1, c2, (t - .26) / .18);
	if (t < .58) return mix(c2, c3, (t - .44) / .14);
	if (t < .72) return mix(c3, c4, (t - .58) / .14);
	if (t < .94) return mix(c4, c5, (t - .72) / .22);
	return c5;
}

float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
	vec2 px = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
	vec3 c = vec3(0.);
	float a = 0.;
	for (int i = ${MAX - 1}; i >= 0; i--) {
		if (i >= count) continue;
		vec2 at = (px - box[i].xy) / box[i].zw;
		float d = length((at - .5) / .5) / mix(.6, 1., grow);
		float s = soft * mix(3., 1., grow);
		float la = grow * peak[i] * (1. - smoothstep(start[i] - s, 1. + s, d));
		vec3 lc = paint[i] > .5 ? painting(at.x) : color[i];
		c = lc * la + c * (1. - la);
		a = la + a * (1. - la);
	}
	vec3 o = bg * (1. - a * opacity) + c * opacity;
	float n = rand(gl_FragCoord.xy) + rand(gl_FragCoord.yx + 7.1) - 1.;
	float amount = weighted > .5 ? mix(1., grain, clamp(a * opacity * 8., 0., 1.)) : grain;
	gl_FragColor = vec4(o + n * amount / 255., 1.);
}`;

	const rgb = (css: string): number[] =>
		(css.match(/[\d.]+/gu) ?? ['0', '0', '0'])
			.slice(0, 3)
			.map((value) => Number(value) / (css.startsWith('color(') ? 1 : 255));

	const hex = (code: string): number[] =>
		[1, 3, 5].map((at) => Number.parseInt(code.slice(at, at + 2), 16) / 255);
</script>

<script lang="ts">
	type Props = {
		layers: readonly Layer[];
		opacity: number;
		soft?: number;
		grain?: number;
		weighted?: boolean;
	};

	let { layers, opacity, soft = 0.1, grain = 7.6, weighted = false }: Props = $props();

	function program(gl: WebGLRenderingContext): WebGLProgram | null {
		const linked = gl.createProgram();
		const vertex = gl.createShader(gl.VERTEX_SHADER);
		const fragment = gl.createShader(gl.FRAGMENT_SHADER);
		if (!linked || !vertex || !fragment) return null;
		gl.shaderSource(vertex, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }');
		gl.shaderSource(fragment, FRAGMENT);
		gl.compileShader(vertex);
		gl.compileShader(fragment);
		gl.attachShader(linked, vertex);
		gl.attachShader(linked, fragment);
		gl.bindAttribLocation(linked, 0, 'p');
		gl.linkProgram(linked);
		return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
	}

	function draw(canvas: HTMLCanvasElement): (() => void) | undefined {
		const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
		if (!gl) return undefined;
		const linked = program(gl);
		if (!linked) return undefined;
		gl.useProgram(linked);
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const uniform = (name: string): WebGLUniformLocation | null =>
			gl.getUniformLocation(linked, name);

		const render = (): number => {
			const width = Math.round(canvas.clientWidth * devicePixelRatio);
			const height = Math.round(canvas.clientHeight * devicePixelRatio);
			if (!width || !height) return 1;
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
				gl.viewport(0, 0, width, height);
			}
			const style = getComputedStyle(canvas);
			const grown = Number.parseFloat(style.getPropertyValue('--grow'));
			const grow = Number.isNaN(grown) ? 1 : grown;
			const [red = 0, green = 0, blue = 0] = rgb(style.color);
			const dark = 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5;
			const list = layers.slice(0, MAX);
			gl.uniform2f(uniform('size'), width, height);
			gl.uniform3fv(uniform('bg'), [red, green, blue]);
			gl.uniform4fv(
				uniform('box'),
				list.flatMap(({ box: [x, y, w, h] }) => [x * width, y * height, w * width, h * height]),
			);
			gl.uniform3fv(
				uniform('color'),
				list.flatMap((layer) => (layer.color ? hex(layer.color) : [0, 0, 0])),
			);
			gl.uniform1fv(
				uniform('paint'),
				list.map((layer) => (layer.color ? 0 : 1)),
			);
			gl.uniform1fv(
				uniform('peak'),
				list.map((layer) => layer.peak[dark ? 1 : 0]),
			);
			gl.uniform1fv(
				uniform('start'),
				list.map((layer) => layer.start ?? 0),
			);
			gl.uniform1i(uniform('count'), list.length);
			gl.uniform1f(uniform('opacity'), opacity);
			gl.uniform1f(uniform('soft'), soft);
			gl.uniform1f(uniform('grain'), grain);
			gl.uniform1f(uniform('weighted'), weighted ? 1 : 0);
			gl.uniform1f(uniform('grow'), grow);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			return grow;
		};

		let frame = 0;
		const play = (): void => {
			frame = render() < 1 ? requestAnimationFrame(play) : 0;
		};
		play();
		const resized = new ResizeObserver(render);
		resized.observe(canvas);
		const themed = new MutationObserver(render);
		themed.observe(document.documentElement, { attributeFilter: ['data-theme'] });
		const scheme = matchMedia('(prefers-color-scheme: dark)');
		scheme.addEventListener('change', render);
		return () => {
			cancelAnimationFrame(frame);
			resized.disconnect();
			themed.disconnect();
			scheme.removeEventListener('change', render);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		};
	}
</script>

<canvas {@attach draw} aria-hidden="true"></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
