import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [svelte({ configFile: '../svelte.config.js' })], // relative to root
  server: { port: Number(process.env.VITE_PORT ?? 0) },
  build: { outDir: '../dist', emptyOutDir: true, target: 'esnext' },
  worker: { format: 'es' },
})
