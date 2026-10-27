// The Open Graph image and the fingerprint of what it shows, side by side in `src/lib`. `scripts/og.ts` renders the
// card (`/og`, the hero alone) into the image and stores the fingerprint; the tests recompute it from the build, so a
// hero that changes without a new image fails them.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const site = import.meta.dirname;

export const IMAGE = join(site, 'src/lib/og.jpg');
export const HASH = join(site, 'src/lib/og.hash');
export const RENDER = 'npx electron scripts/og.ts';

// What the card shows, from the build. Its page counts without scripts and module preloads: they carry the build's
// version and code shared with every other page, so they change when those do, and they draw nothing but the glow,
// whose sources stand in for them. The files it loads under `_app/immutable` are named by their content, so the page
// covers them; the rest, the hero's still among them, are hashed here.
export function fingerprint(build = join(site, 'build')): string {
	const page = readFileSync(join(build, 'grip/og.html'), 'utf8')
		.replace(/<script\b[\s\S]*?<\/script>/gu, '')
		.replace(/<link [^>]*rel="modulepreload"[^>]*>/gu, '');
	const hash = createHash('sha256').update(page);
	for (const [, file = ''] of page.matchAll(
		/(?:src|<link [^>]*href)="\/grip\/(?!_app\/immutable\/)([^"]+)"/gu,
	))
		hash.update(readFileSync(join(build, 'grip', file)));
	// ponytail: the glow is the one part a script draws; a second one adds its sources here.
	for (const source of ['Glow.svelte', 'Hero.svelte'])
		hash.update(readFileSync(join(site, 'src/lib', source)));
	return hash.digest('hex');
}
