import type { Wallpaper } from './index.ts'
import { waves, type Waves, type Layer } from './radiant.ts'

const e = (id: string, name: string, colors: string[], w: Waves, layers: Layer[]) => waves('Energy', id, name, colors, w, layers)

// Punchy magenta, orange, blue, and cyan with dark accents, in seven motifs: ribbons, rising
// flames, shock rings, a liquid crown, a spiral curl, folded sheets, and fiber strands.
export const ENERGY: Wallpaper[] = [
  // Ribbons
  e('energy-surge', 'Surge', ['#12062e', '#3a0a4a', '#ff2a7a', '#2a0f6e', '#ff2fa0', '#ff7a3d', '#ffc14d'], { flow: -35, seed: 2, freq: 0.6, gloss: 1.2, shadow: 0.8, twist: 0.7, glow: [0.85, 0.85, 0.3] }, [
    [-0.3, 0.09, 1, 0.05],
    [-0.08, 0.08, 0.18, 0.35],
    [0.1, 0.1, 1, 0.65],
    [0.32, 0.08, 1, 0.95],
  ]),
  e('energy-blaze', 'Blaze', ['#2a0610', '#6a0f1e', '#ff8a3d', '#d81f4f', '#ff3d5e', '#ff7a2e', '#ffc04a', '#fff0b0'], { flow: 30, seed: 6, freq: 0.55, gloss: 1.3, curl: 0.6, shadow: 0.85, twist: 0.9, glow: [0.1, 0.9, 0.4] }, [
    [-0.36, 0.07, 0.2, 0.0],
    [-0.12, 0.09, 0.18, 0.3],
    [0.1, 0.09, 0.2, 0.6],
    [0.34, 0.07, 0.22, 0.9],
  ]),
  e('energy-voltage', 'Voltage', ['#020818', '#071a3e', '#1ad8ff', '#0b2f9a', '#1f6bff', '#18c8ff', '#7af0ff', '#ffffff'], { flow: -48, seed: 8, freq: 0.5, gloss: 1.6, curl: 0.8, shadow: 0.9, twist: 0.9, glow: [0.15, 0.15, 0.35] }, [
    [-0.4, 0.06, -0.0016, 0.9],
    [-0.26, 0.07, 0.16, 0.1],
    [-0.04, 0.08, 0.14, 0.45],
    [0.04, 0.08, -0.0012, 1],
    [0.2, 0.08, 0.18, 0.7],
    [0.42, 0.06, 0.2, 0.3],
  ]),
  e('energy-velocity', 'Velocity', ['#04030c', '#140820', '#ff2f6a', '#ff2f6a', '#ff6a3d', '#ffc04a', '#2ad8ff'], { flow: -30, seed: 26, freq: 0.4, gloss: 1.6, curl: 0.7, shadow: 0.9, twist: 0.5, glow: [0.9, 0.2, 0.3] }, [
    [-0.32, 0.05, -0.0014, 0.4],
    [-0.24, 0.06, -0.002, 0.7],
    [-0.04, 0.08, 0.12, 0.0],
    [0.08, 0.08, 0.1, 0.35],
    [0.2, 0.07, 0.1, 0.65],
    [0.3, 0.07, -0.0016, 1],
  ]),
  e('energy-overdrive', 'Overdrive', ['#0a0414', '#1a0a3a', '#ff2fa0', '#3a0ab8', '#ff1f8a', '#ff6a2a', '#2ad8ff'], { flow: 68, seed: 38, freq: 0.5, gloss: 1.6, curl: 0.8, shadow: 0.95, twist: 1.2, glow: [0.5, 0.5, 0.5], haze: 0.1 }, [
    [-0.18, 0.1, 0.3, 0.2],
    [0.02, 0.08, -0.0018, 1],
    [0.18, 0.1, 0.3, 0.7],
  ]),

  // Burst: twisted satin rays and light threads fanning out from an edge.
  e('energy-ignite', 'Ignite', ['#0a0410', '#2a0818', '#ff4f2a', '#4a0a3a', '#c8104a', '#ff3d2a', '#ff8a1f', '#ffd04a'], { mode: 'rays', center: [0.5, 1.08], flow: -90, seed: 16, freq: 0.6, scale: 9, twist: 1.4, gloss: 1.5, curl: 0.7, shadow: 0.85, blur: 0.002, glow: [0.5, 1, 0.5] }, [
    [-0.06, 0.02, 0.1, 0.2],
    [0.07, 0.02, 0.08, 0.6],
    [0.0, 0.01, -0.0018, 1],
  ]),
  e('energy-afterburn', 'Afterburn', ['#02030c', '#0a0a2a', '#2a8aff', '#2a1ab8', '#4a3aff', '#2a9aff', '#5ae0ff', '#ffffff'], { mode: 'rays', center: [-0.06, 0.5], flow: 0, seed: 44, freq: 0.5, scale: 16, strands: 3, glow: [0, 0.5, 0.45], blur: 0.001 }, [
    [-0.04, 0.02, -0.12, 0.4],
    [0.05, 0.02, -0.1, 0.9],
  ]),
  e('energy-fever', 'Fever', ['#1a0228', '#4a0848', '#ff3d6a', '#8a0a8a', '#ff1f6a', '#ff6a2a', '#ffb02a', '#ffe0a0'], { mode: 'rays', center: [1.05, -0.05], flow: 135, seed: 36, freq: 0.7, scale: 12, twist: 1.6, gloss: 1.5, curl: 0.8, shadow: 0.9, blur: 0.002, glow: [1, 0, 0.5] }, [
    [-0.08, 0.02, 0.12, 0.1],
    [0.0, 0.015, -0.0016, 0.9],
    [0.06, 0.02, 0.1, 0.55],
  ]),
  e('energy-cinder', 'Cinder', ['#ffe6d6', '#ffc2d0', '#ffffff', '#2a1ab8', '#7a2ae0', '#d02ae0', '#ff2f8a', '#ff7a3d'], { mode: 'rays', center: [-0.04, 1.04], flow: -45, seed: 66, freq: 0.5, scale: 20, twist: 1.2, gloss: 1.3, curl: 0.6, shadow: 0.6, blur: 0.002, drift: 0.6, glow: [0, 1, 0.5] }, [
    [-0.04, 0.015, 0.07, 0.15],
    [0.04, 0.015, 0.06, 0.65],
  ]),

  // Rings: shock rings bursting from a corner.
  e('energy-pulse', 'Pulse', ['#0e0326', '#2a0848', '#ff2fb0', '#4a12c8', '#a020f0', '#ff2fa8', '#ff8a5a', '#ffd06a'], { mode: 'rings', center: [0, 0], flow: 45, seed: 112, freq: 0.9, gloss: 1.5, curl: 0.8, shadow: 0.9, twist: 1.2, blur: 0.001, light: -45, glow: [0, 0, 0.5] }, [
    [0.45, 0.012, 0.08, 0.0],
    [0.6, 0.015, 0.09, 0.3],
    [0.69, 0.01, -0.0016, 1],
    [0.78, 0.018, 0.1, 0.6],
    [0.97, 0.02, 0.11, 0.9],
  ]),
  e('energy-shockwave', 'Shockwave', ['#02040e', '#0a1030', '#2a8aff', '#0a2a9a', '#2a6aff', '#2ad8ff', '#ff3da0', '#ffffff'], { mode: 'rings', center: [0.85, 0.75], flow: -150, seed: 62, freq: 1.4, scale: 0.3, gloss: 1.6, curl: 0.8, shadow: 0.9, twist: 1, glow: [0.85, 0.75, 0.3] }, [
    [0.12, 0.01, -0.002, 1],
    [0.24, 0.015, 0.06, 0.2],
    [0.38, 0.02, -0.0014, 0.85],
    [0.52, 0.025, 0.08, 0.5],
    [0.7, 0.02, -0.0018, 0.95],
    [0.86, 0.03, 0.1, 0.7],
  ]),
  e('energy-dynamo', 'Dynamo', ['#0a2a6a', '#2a0a5a', '#2affd0', '#1a5aff', '#2ad0ff', '#2affb0', '#ffd04a', '#ff5a8a'], { mode: 'rings', center: [1.0, 1.0], flow: -135, seed: 54, freq: 3, gloss: 1.3, curl: 0.6, shadow: 0.75, twist: 1, drift: 0.6, glow: [0.1, 0.1, 0.5] }, [
    [0.3, 0.015, 0.1, 0.0],
    [0.48, 0.02, 0.12, 0.3],
    [0.66, 0.02, 0.12, 0.6],
    [0.84, 0.025, 0.14, 0.95],
  ]),

  // Domes: concentric glossy swells rising from an edge like a sunrise.
  e('energy-fuse', 'Fuse', ['#1a0628', '#4a0a3a', '#ff8a3d', '#ffb04a', '#ff6a3a', '#ff2f6a', '#c81a8a', '#4a1ab8'], { mode: 'dome', center: [0.5, 1.15], flow: -90, seed: 52, freq: 0.8, scale: 0.6, gloss: 1.3, curl: 0.3, shadow: 0.9, twist: 0.6, blur: 0.0008, glow: [0.5, 1, 0.6] }, [
    [-0.86, 0.01, 1, 0.9],
    [-0.7, 0.01, 1, 0.65],
    [-0.55, 0.008, 1, 0.4],
    [-0.41, 0.006, 1, 0.15],
    [-0.28, 0.004, 1, 0.0],
  ]),
  e('energy-spark', 'Spark', ['#06122a', '#0a2a5a', '#2ad8ff', '#1a2ab8', '#2a6aff', '#2ad8ff', '#ff4fa0', '#ffe07a'], { mode: 'dome', center: [1.1, 0.5], flow: 180, seed: 28, freq: 0.9, scale: 0.4, gloss: 1.5, curl: 0.3, shadow: 0.9, twist: 0.6, blur: 0.0008, glow: [1, 0.5, 0.45] }, [
    [-0.95, 0.01, 1, 0.0],
    [-0.8, 0.008, -0.0016, 0.95],
    [-0.74, 0.01, 1, 0.35],
    [-0.54, 0.008, 1, 0.65],
    [-0.36, 0.006, 1, 1],
  ]),
  e('energy-rush', 'Rush', ['#0a0a3a', '#1a1a6a', '#ff5aa0', '#7a2ae0', '#ff2f7a', '#ff5f5f', '#ff9a3d', '#ffd36a'], { mode: 'dome', center: [-0.1, -0.1], flow: 45, seed: 14, freq: 1.0, scale: 0.5, gloss: 1.4, curl: 0.3, shadow: 0.9, twist: 0.6, drift: 0.4, blur: 0.0008, glow: [0.0, 0.0, 0.3] }, [
    [-1.15, 0.012, 1, 0.0],
    [-0.95, 0.01, 1, 0.3],
    [-0.78, 0.008, -0.0018, 0.95],
    [-0.74, 0.01, 1, 0.6],
    [-0.52, 0.008, 1, 0.9],
  ]),

  // Curl: one huge twisted ribbon spiraling in from the edge.
  e('energy-torque', 'Torque', ['#100828', '#2a0a3a', '#ff6a2a', '#3a1aa8', '#7a2ae0', '#ff2f8a', '#ff7a2a', '#ffc04a'], { mode: 'spiral', center: [1.0, 0.95], flow: -150, seed: 22, freq: 0.5, scale: 0.5, twist: 1.6, gloss: 1.5, curl: 0.7, shadow: 0.85, glow: [1, 1, 0.5] }, [
    [0.3, 0.02, 0.28, 0.2],
    [0.56, 0.015, -0.0018, 1],
    [0.7, 0.02, 0.18, 0.7],
  ]),
  e('energy-turbo', 'Turbo', ['#1a0228', '#4a0848', '#ff3d6a', '#8a0a8a', '#ff1f6a', '#ff6a2a', '#ffb02a'], { mode: 'spiral', center: [-0.2, 0.15], flow: 20, seed: 58, freq: 0.6, scale: 0.7, twist: 1.6, gloss: 1.5, curl: 0.7, shadow: 0.9, blur: 0.0015, glow: [0, 0, 0.5] }, [
    [0.4, 0.02, 0.3, 0.3],
    [0.78, 0.02, 0.22, 0.85],
  ]),
  e('energy-momentum', 'Momentum', ['#ffd0a0', '#ff8a6a', '#fff0e0', '#2a1ab8', '#7a2ae0', '#ff3d8a', '#ff8a3d', '#ffd06a'], { mode: 'spiral', center: [0.5, 1.05], flow: -90, seed: 146, freq: 0.5, scale: 0.4, twist: 1.4, gloss: 1.3, curl: 0.6, shadow: 0.7, glow: [0.5, 0.0, 0.6] }, [
    [0.22, 0.015, 0.16, 0.1],
    [0.42, 0.02, 0.22, 0.5],
    [0.68, 0.02, 0.16, 0.9],
  ]),

  // Folds: creased sheets with sharp lit facets.
  e('energy-kinetic', 'Kinetic', ['#0c2a8a', '#ff3d8a', '#ffb0d0', '#1a3adf', '#3a7aff', '#a03aff', '#ff3d9a', '#ff8a4a'], { flow: -55, seed: 24, freq: 1.2, shape: -1, gloss: 1.2, curl: 0.2, shadow: 0.7, twist: 0, bgAngle: -40, blur: 0.002 }, [
    [-0.36, 0.08, 1, 0.0],
    [-0.16, 0.09, 1, 0.3],
    [0.04, 0.09, 1, 0.6],
    [0.24, 0.08, 1, 0.9],
  ]),
  e('energy-rally', 'Rally', ['#140820', '#2a0a3a', '#ff2f7a', '#ff2f6a', '#ff7a3d', '#ff3db0', '#7a3aff', '#2a7aff'], { flow: 20, seed: 134, freq: 0.7, shape: -1, gloss: 1.4, curl: 0.2, shadow: 0.85, twist: 0, drift: 0.6, blur: 0.002 }, [
    [-0.2, 0.1, 0.12, 0.0],
    [-0.04, 0.12, 0.16, 0.35],
    [0.12, 0.1, 0.12, 0.7],
    [0.26, 0.08, 0.1, 1],
  ]),
  e('energy-thrust', 'Thrust', ['#03122a', '#0a2a5a', '#1affe0', '#0a4ab8', '#1a8aff', '#1ad8e0', '#8affc8'], { flow: 65, seed: 32, freq: 0.8, shape: -0.9, gloss: 0.6, curl: 0.1, shadow: 0.85, twist: 0, light: -150, glow: [0.1, 0.1, 0.3], blur: 0.0008 }, [
    [-0.12, 0.12, 1, 0.0],
    [0.08, 0.13, 1, 0.45],
    [0.28, 0.11, 1, 0.9],
  ]),

  // Strands: fiber bundles, glowing or glossy.
  e('energy-flux', 'Flux', ['#020818', '#0a1a4a', '#2ae0ff', '#1a3ad8', '#2a8aff', '#2ae0ff', '#ff3da0', '#ff9a4a'], { flow: -35, seed: 18, freq: 0.5, strands: 20, glow: [0.15, 0.85, 0.5], blur: 0.001 }, [
    [-0.08, 0.12, -0.26, 0.2],
    [0.1, 0.1, -0.16, 0.85],
  ]),
  e('energy-charge', 'Charge', ['#06021a', '#12063a', '#7a3aff', '#2a1ad8', '#6a2aff', '#d02ae0', '#ff3da0', '#ff9a3d'], { flow: 80, seed: 48, freq: 0.9, strands: 10, glow: [0.5, 0.5, 0.5], blur: 0.001 }, [
    [-0.38, 0.05, -0.1, 0.3],
    [-0.12, 0.06, -0.12, 0.6],
    [0.12, 0.06, -0.12, 0.8],
    [0.38, 0.05, -0.1, 0.95],
  ]),
  e('energy-riptide', 'Riptide', ['#021028', '#04304a', '#3affff', '#0a3a8a', '#0a7ac8', '#1ad8f0', '#ff4fa0', '#ffc04a'], { flow: -15, seed: 142, freq: 0.6, strands: 14, curl: 1, gloss: 1.5, shadow: 0.8, glow: [0.85, 0.1, 0.4] }, [
    [-0.12, 0.1, 0.3, 0.3],
    [0.14, 0.12, 0.3, 0.8],
  ]),
]
