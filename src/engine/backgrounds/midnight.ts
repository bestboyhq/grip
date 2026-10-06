import type { Wallpaper } from './index.ts'
import { lustre, silk } from './iridescent.ts'

const MID = 'Midnight'
const K = '#020203'
/** Dark studio: black sky, a bright key softbox, a rim strip. */
const NIGHT: [number, number, number, number] = [0.12, 3, 0.25, 0.7]

// Motifs: satin dunes, a single ribbon, chrome objects, brushed metal, water, folded paper, stars.
export const MIDNIGHT: Wallpaper[] = [
  // Satin dunes
  silk('midnight-obsidian', 'Obsidian', MID, [K, '#3a3b3f'], {
    seed: 2.2, fade: 0.35, lip: 0.08, sheets: [[-0.12, 0, 0.05, 6], [-0.02, 0.05, 0.06, 5], [0.08, -0.04, 0.05, 7], [0.18, 0.02, 0.04, 6]],
    fold: [0.03, 24, -0.5, 0.1], light: [20, 30], spec: 0.6, rough: 0.1, ambient: 0.1, broad: [3, 3], glow: 0.019,
  }),
  silk('midnight-noir', 'Noir', MID, [K, '#303135'], {
    angle: 88, seed: 6.3, fade: 0.3, lip: 0.06, sheets: [[-0.9, 0, 0, 3], [-0.25, 0, 0.04, 5], [-0.08, 0.03, 0.05, 6], [0.1, -0.03, 0.05, 5.5], [0.26, 0, 0.04, 6]],
    fold: [0.02, 22, -0.4, 0.1], light: [-60, 30], spec: 0.6, rough: 0.08, ambient: 0.06, broad: [2, 3], gap: 0.45,
  }),
  silk('midnight-eclipse', 'Eclipse', MID, [K, '#1d1a17', '#f0d2a8'], {
    angle: -55, seed: 4.4, lip: 0.3, fade: 0.4, sheets: [[-0.9, 0, 0, 3], [0.06, 0.2, 0.05, 2]],
    fold: [0.012, 5, 0.3, 0.05], film: [0, 0, 0, 0], specTint: 0.3, light: [35, 30], spec: 0.7, rough: 0.04, ambient: 0.04, broad: [0.8, 3], crease: 2.5,
  }),
  silk('midnight-platinum', 'Platinum', MID, ['#16171a', '#74777e'], {
    angle: -24, seed: 6.9, fade: 0.7, lip: 0.14, sheets: [[-0.9, 0, 0, 3], [0.04, 0.05, 0.1, 3.5]],
    fold: [0.03, 19, 0.5, 0.15], light: [-50, 40], spec: 0.9, rough: 0.08, ambient: 0.06, broad: [1.5, 3], crease: 2.5, exposure: 0.95,
  }),
  // A single ribbon
  silk('midnight-jet', 'Jet', MID, [K, '#141416'], {
    angle: -8, seed: 9.6, lip: 0.1, sheets: [[0.06, 0.05, 0.08, 4]],
    fold: [0.015, 16, 0.2, 0.1], light: [20, 30], spec: 0.5, rough: 0.035, ambient: 0.03, broad: [1.2, 3], glow: 0.034,
  }),
  silk('midnight-tuxedo', 'Tuxedo', MID, [K, '#26272a'], {
    angle: 38, seed: 1.4, lip: 0.12, fade: 0.35, sheets: [[-0.9, 0, 0, 3], [0.02, 0, 0.1, 4.5]],
    fold: [0.025, 20, 0.3, 0.1], light: [-20, 35], spec: 0.7, rough: 0.04, ambient: 0.04, broad: [0.3, 3],
  }),
  // Chrome
  lustre('midnight-lacquer', 'Lacquer', MID, ['#0d0d10', K, '#e4e6ea'], {
    mode: 'objects', seed: 1, env: NIGHT, light: [-40, 45],
    a: [1, 0, 0, 0.6], b: [0.5, 0, 0, 0],
    items: [[0.64, 0.52, 0.44, 0]],
  }),
  lustre('midnight-quicksilver', 'Quicksilver', MID, ['#0d0d10', K, '#dcdee4'], {
    mode: 'objects', seed: 2, env: NIGHT, light: [35, 50],
    a: [1, 0, 0, 0.6], b: [0.5, 0.26, 0, 0],
    items: [[0.5, 0.5, 0.3, 4]],
  }),
  lustre('midnight-mercury', 'Mercury', MID, ['#0d0d10', K, '#d0d3d8'], {
    mode: 'objects', seed: 3, env: NIGHT, light: [-30, 50],
    a: [7, 0, 0, 0.6], b: [0.5, 0, 0, 0],
    items: [[0.2, 0.72, 0.2, 0], [0.38, 0.86, 0.1, 0], [0.08, 0.42, 0.08, 0], [0.33, 0.5, 0.05, 0], [0.86, 0.22, 0.09, 0], [0.94, 0.42, 0.045, 0], [0.5, 0.95, 0.04, 0]],
  }),
  // Brushed metal
  lustre('midnight-pewter', 'Pewter', MID, ['#3a3c41', '#141518', '#ffffff'], {
    mode: 'brushed', seed: 2, light: [-35, 50], a: [0.5, 0.5, 1, 0.6], b: [0.12, 0.6, 1, 1],
  }),
  lustre('midnight-slate', 'Slate', MID, ['#6a6e76', '#24272c', '#ffffff'], {
    mode: 'brushed', seed: 6, light: [-20, 50], a: [0.42, 0.5, 0, 0.3], b: [0.07, 0.6, 0.85, 1.57],
  }),
  lustre('midnight-gunmetal', 'Gunmetal', MID, ['#3c3e43', '#101113', '#ffffff'], {
    mode: 'brushed', seed: 4, a: [0.68, 0.5, 0, 0.6], b: [0.07, 0.75, 0.85, 0.35],
  }),
  // Water
  lustre('midnight-nocturne', 'Nocturne', MID, [K, '#2a3140', '#e8eeff'], {
    mode: 'water', seed: 3, env: [0, 1.4, 1, 0], a: [0.36, 0.25, 26, 0.008], b: [0.25, 0.0024, 0.25, 0.05],
    items: [[0.25, 1.0, 1, 0], [-0.6, 1.9, 0.6, 1.5], [0, 0, 0, 0]],
  }),
  lustre('midnight-raven', 'Raven', MID, [K, '#3a3c44', '#ffffff'], {
    mode: 'water', seed: 7, env: [0, 2, 12, 0.5], a: [-0.02, 0.3, 48, 0.005], b: [0.12, 0.0006, 0, 0.03],
    items: [[0.02, 0.4, 1, 0], [-0.3, 0.7, 0.7, 2], [0.4, 1.1, 0.5, 4]],
  }),
  // Folded paper
  lustre('midnight-carbon', 'Carbon', MID, ['#9a9ca2', '#24252a', '#ffffff', '#0b0b0d'], {
    mode: 'pleats', light: [-50, 32], a: [0.0, 1.0, 44, 0.45], b: [1, 0, 0, 0.012],
    items: [[0.9, 0.025, 0, 0]],
  }),
  lustre('midnight-smoke', 'Smoke', MID, ['#a4a6ac', '#2c2d32', '#ffffff', '#0d0d10'], {
    mode: 'pleats', light: [-70, 30], a: [0, 0, 9, 0.5], b: [0, -0.5, 0.35, 0.012],
    items: [[0.17, 0.03, -0.02, 0]],
  }),
  // Stars
  lustre('midnight-onyx', 'Stardust', MID, ['#030305', '#2c3140', '#ffffff'], {
    mode: 'stars', seed: 4, a: [-0.4, 0, 0.1, 0.28], b: [0.9, 0.9, 1, 0.6],
  }),
  lustre('midnight-ebony', 'Starfall', MID, ['#040303', '#3a2f26', '#fff3e2'], {
    mode: 'stars', seed: 11, a: [0.9, -0.05, 0.16, 0.25], b: [0.8, 0.9, 1.2, -0.6],
  }),
]
