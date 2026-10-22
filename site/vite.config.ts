import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Prerendered into build/grip, so the worker (`wrangler.jsonc`) serves it under bestboy.dev/grip.
export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ pages: 'build/grip', assets: 'build/grip', strict: true }),
			paths: { base: '/grip', relative: false },
			prerender: { handleHttpError: 'fail', handleMissingId: 'fail' },
		}),
	],
	// The page shows the README's own screenshots, from `.github/readme` outside this folder.
	server: { fs: { allow: ['..'] } },
});
