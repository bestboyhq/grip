import type { TransitionConfig } from 'svelte/transition';

export const REST_MS = 150;
export const LEAVE_MS = 200;
export const DROP_IN_MS = 200;
export const DROP_OUT_MS = 150;
export const MOVE_MS = 200;
export const CLICK_GRACE_MS = 400;

export const still = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const bezier = (a: number, b: number, s: number): number =>
	3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;

export function easeOut(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i++) {
		const s = (lo + hi) / 2;
		if (bezier(0.22, 0.36, s) < t) lo = s;
		else hi = s;
	}
	return bezier(1, 1, (lo + hi) / 2);
}

type Direction = Readonly<{ direction?: 'in' | 'out' | 'both' }>;

export type Drop = TransitionConfig | ((options?: Direction) => TransitionConfig);

export function drop(): Drop {
	if (still()) return { duration: 0 };
	return ({ direction } = {}) => ({
		duration: direction === 'out' ? DROP_OUT_MS : DROP_IN_MS,
		easing: easeOut,
		css: (t) => `opacity: ${t}; transform: scale(${0.935 + 0.065 * t})`,
	});
}
