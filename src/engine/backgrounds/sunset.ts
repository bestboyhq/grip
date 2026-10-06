import type { Wallpaper } from './index.ts'
import { dunes, relief, type DuneLayer, type DuneLook, type ReliefLook } from './spring.ts'

const sand = (id: string, name: string, colors: string[], look: ReliefLook) => relief('Sunset', `sunset-${id}`, name, colors, look)
const sunset = (id: string, name: string, colors: string[], look: DuneLook, layers: DuneLayer[]) => dunes('Sunset', `sunset-${id}`, name, colors, { turn: 0.15, ...look }, layers)

// Warm desert light: crests lean (skew) toward a steep lee side, light comes low from the side, and
// shadows run long and deep red rather than grey.
export const SUNSET: Wallpaper[] = [
  // Dunes: layered dune horizons.
  sunset('sahara', 'Sahara', ['#f7a58f', '#ffd9a0', '#ffc28a', '#f08a5a', '#d9533f', '#8a2a3a', '#ffe0a8'], { angle: 0.05, light: -0.6, skew: 0.45, sheen: 0.6, shadow: 0.6 }, [
    [0.0, 0.04, 4.0, 1, 6, 2, 0.3],
    [0.05, 0.05, 3.4, 120, 2, 3, 0.3],
    [0.11, 0.06, 2.8, 2, 3, 4, -0.3],
    [0.2, 0.26, 0.9, 3, 6, 4, 0.5],
    [0.36, 0.12, 1.6, 121, 4, 5, -0.3],
  ]),
  sunset('mirage', 'Mirage', ['#f2a08f', '#fbd2b0', '#f7b89a', '#ee8f78', '#d8606a', '#b04060'], { angle: 0.32, light: 0.5, skew: 0.3, haze: 0.6, shadow: 0.45 }, [
    [-0.06, 0.05, 3.4, 124, 2, 3, 0.2],
    [0.0, 0.07, 2.6, 7, 2, 3, 0.3],
    [0.09, 0.08, 3.0, 125, 3, 4, -0.2],
    [0.17, 0.09, 2.2, 8, 3, 4, -0.3],
    [0.28, 0.14, 1.5, 9, 4, 5, 0.3],
  ]),
  sunset('erg', 'Erg', ['#7a2a4a', '#e8704a', '#c8483f', '#9a2a3a', '#6a1a34', '#4a1028', '#ff9a5a'], { light: -0.7, skew: 0.6, sheen: 0.8, shadow: 0.6, haze: 0.35, glow: 0.6, glowX: -0.3, glowColor: 6 }, [
    [-0.24, 0.04, 4.4, 127, 2, 3, 0.2],
    [-0.14, 0.06, 3.4, 14, 2, 3, 0.3],
    [-0.02, 0.08, 2.8, 15, 3, 4, -0.3],
    [0.12, 0.09, 2.3, 16, 4, 5, 0.3],
    [0.28, 0.16, 1.4, 128, 4, 5, -0.2],
  ]),
  sunset('harmattan', 'Harmattan', ['#f4c0a8', '#fff0dc', '#f6c4a8', '#eea08a', '#dc7c74', '#c05e66'], { light: 0.4, skew: 0.3, haze: 0.7, shadow: 0.4, dof: 0.008, glow: 0.7, glowX: 0.2 }, [
    [0.22, 0.03, 4.0, 60, 2, 3, 0.2],
    [0.27, 0.04, 3.2, 61, 3, 4, -0.2],
    [0.33, 0.06, 2.4, 62, 4, 5, 0.2],
  ]),
  // Sun: a low sun disc with the dunes in near silhouette.
  sunset('solstice', 'Solstice', ['#ff7a6a', '#ffcf80', '#e0586a', '#b02a50', '#801a44', '#561030', '#fff2b8'], { light: 0.2, haze: 0.3, sheen: 0.8, shadow: 0.4, sunX: 0.12, sunY: 0.05, sunR: 0.12, sunColor: 6, glow: 0.5, glowX: 0.12 }, [
    [0.1, 0.05, 3.2, 1, 2, 3, 0.2],
    [0.18, 0.07, 2.6, 2, 3, 4, -0.2],
    [0.29, 0.1, 1.9, 3, 4, 5, 0.2],
  ]),
  sunset('afterglow', 'Afterglow', ['#5a3a8a', '#ff9a80', '#c8607a', '#9a3a6a', '#6a2050', '#40143a', '#ffd8a8'], { light: -0.2, haze: 0.3, sheen: 0.7, shadow: 0.4, sunX: -0.2, sunY: 0.14, sunR: 0.22, sunColor: 6, glow: 0.4, glowX: -0.2 }, [
    [0.15, 0.04, 2.8, 54, 2, 3, 0.2],
    [0.24, 0.06, 2.2, 55, 3, 4, -0.2],
    [0.34, 0.08, 1.6, 56, 4, 5, 0.2],
  ]),
  sunset('cinnabar', 'Cinnabar', ['#a83a5a', '#ff8a60', '#ff9a6a', '#e85a4a', '#b8304a', '#6a1a40', '#ffeab8'], { light: 0.5, skew: 0.5, sheen: 0.7, shadow: 0.6, sunX: -0.38, sunY: -0.16, sunR: 0.05, sunColor: 6, glow: 0.5, glowX: -0.38 }, [
    [0.04, 0.1, 2.6, 51, 2, 3, 0.3],
    [0.18, 0.12, 2.2, 52, 3, 4, -0.3],
    [0.32, 0.12, 1.6, 53, 4, 5, 0.2],
  ]),
  // Aerial: wind-cut dune ridges seen from above, sharp crests and long shadows.
  sand('sirocco', 'Sirocco', ['#ffd8a0', '#ffd8a0', '#c84a3a', '#f08050', '#ffb070', '#ffd8a0'], { mode: 'ridges', freq: 3.5, angle: 0.5, sunAz: -2.6, sunEl: 0.32, lean: 0.8, detail: 0, warp: 1.1, swell: 0.3 }),
  sand('paprika', 'Paprika', ['#ffc090', '#ffc090', '#b8303c', '#e8583f', '#ff8a58', '#ffc498'], { mode: 'ridges', freq: 2.3, angle: -0.35, seed: 3, sunAz: -0.4, sunEl: 0.42, lean: 0.9, detail: 0, warp: 0.9, swell: 0.25 }),
  sand('saffron', 'Saffron', ['#ffe8a8', '#ffe8a8', '#e0603a', '#f5983f', '#ffc860', '#ffeab0'], { mode: 'ridges', freq: 5.5, angle: 1.25, seed: 5, sunAz: -2.0, sunEl: 0.42, lean: 0.5, detail: 0, warp: 1.3, swell: 0.2 }),
  // Ripples: sand ripples running to the horizon, seen low and close.
  sand('mojave', 'Mojave', ['#b86a9a', '#ffb07a', '#c0503f', '#f08a5a', '#ffc890'], { mode: 'ridges', freq: 14, horizon: -0.15, sunAz: -2.0, sunEl: 0.35, lean: 0.6, detail: 0, haze: 0.25 }),
  sand('apricot', 'Apricot', ['#ffc0a8', '#fff0d8', '#e88a6a', '#ffb088', '#ffe2c4'], { mode: 'ridges', freq: 9, angle: 0.35, horizon: -0.26, sunAz: -0.9, sunEl: 0.4, lean: 0.3, detail: 0, haze: 0.35, swell: 0.3 }),
  // Swell: one huge dune crossing the frame.
  sunset('amberlight', 'Amberlight', ['#ff9a5a', '#ffd27a', '#ffc060', '#ff8a3f', '#e0502f', '#a02a2a'], { angle: -0.3, light: 0.6, skew: 0.35, sheen: 0.7, glow: 0.6, glowX: -0.3 }, [
    [-0.02, 0.04, 2.4, 17, 2, 3, 0.4],
    [0.14, 0.32, 0.75, 18, 3, 5, -0.4],
  ]),
  sunset('tangerine', 'Tangerine', ['#ffb070', '#ffd8a0', '#ffa04a', '#ff7a3a', '#f0503a', '#c8303f'], { angle: 1.15, light: -0.6, skew: 0.5, sheen: 0.6, shadow: 0.55 }, [
    [-0.36, 0.05, 2.0, 44, 2, 3, 0.4],
    [0.05, 0.3, 0.7, 45, 3, 5, -0.4],
  ]),
  // Mesas: flat-topped buttes and steep cliffs.
  sunset('canyon', 'Canyon', ['#ffa880', '#ffe4c0', '#f0906a', '#d8604a', '#b03a40', '#7a2238', '#ffc090'], { light: 0.7, mesa: 0.5, sheen: 0.5, shadow: 0.6, haze: 0.45 }, [
    [-0.02, 0.18, 4.0, 29, 6, 2, 0.2],
    [0.1, 0.24, 3.2, 30, 2, 3, -0.2],
    [0.24, 0.28, 2.6, 31, 3, 4, 0.2],
    [0.38, 0.2, 2.2, 32, 4, 5, -0.2],
  ]),
  sunset('terracotta', 'Terracotta', ['#e07a6a', '#ffc8a0', '#f09a78', '#c84a40', '#962f3a', '#64192e', '#fff0c0'], { light: -0.6, mesa: 0.55, sheen: 0.6, shadow: 0.6, haze: 0.5, sunX: 0.3, sunY: -0.02, sunR: 0.09, sunColor: 6, glow: 0.5, glowX: 0.3 }, [
    [0.1, 0.12, 2.2, 22, 2, 3, 0.2],
    [0.24, 0.42, 1.1, 24, 3, 5, 0.2],
  ]),
  // Curl: sweeping folds bent around an off-frame center.
  sunset('marrakesh', 'Marrakesh', ['#fff0d8', '#ffb08a', '#ffb08a', '#f0704f', '#d0404a', '#8a1f48', '#ffd09a'], { curl: true, cx: -1.0, cy: -0.6, light: -0.5, sheen: 0.6, shadow: 0.6 }, [
    [-0.3, 0.03, 2.6, 26, 6, 2, 0.2],
    [-0.12, 0.04, 2.2, 27, 2, 3, -0.2],
    [0.06, 0.05, 2.8, 28, 3, 4, 0.2],
    [0.26, 0.05, 2.2, 29, 4, 5, 0.2],
  ]),
  sunset('copperline', 'Copperline', ['#ffe8d0', '#ffd4a8', '#ffc890', '#f8a060', '#e06a40', '#a83a30', '#fff0d0'], { curl: true, cx: 0.85, cy: 1.05, light: 0.5, sheen: 0.8, shadow: 0.55 }, [
    [-0.42, 0.025, 3.4, 35, 6, 2, 0.2],
    [-0.26, 0.03, 3.0, 36, 2, 3, 0.2],
    [-0.1, 0.035, 2.6, 37, 3, 4, -0.2],
    [0.06, 0.04, 3.0, 38, 3, 4, 0.2],
    [0.24, 0.045, 2.4, 39, 4, 5, -0.2],
  ]),
  sunset('ochre', 'Ochre', ['#fff4d8', '#ffd890', '#f8c070', '#e09040', '#c06a30', '#984030', '#7a2a2c'], { curl: true, cx: 0.0, cy: 1.25, light: 0.6, sheen: 0.6, shadow: 0.65 }, [
    [-0.4, 0.04, 2.2, 64, 2, 3, 0.2],
    [-0.22, 0.05, 2.6, 65, 3, 4, -0.2],
    [-0.04, 0.05, 2.0, 66, 4, 5, 0.2],
    [0.14, 0.06, 2.4, 67, 5, 6, -0.2],
  ]),
  // Strata: banded sandstone stepped like contour lines, seen from above.
  sand('kiln', 'Kiln', ['#ff9a6a', '#ff9a6a', '#a8283a', '#d8503f', '#f58a50', '#ffc080', '#ffe4b8'], { mode: 'terraces', freq: 4.2, lean: 14, seed: 4, sunAz: -2.6, sunEl: 0.55, shadow: 0.6, warp: 1.0, swell: 0.1 }),
  sand('oasis', 'Sandstone', ['#ffe0c0', '#ffe0c0', '#e0705a', '#ffa880', '#ffd6b0', '#fff2e2', '#f59070'], { mode: 'terraces', freq: 2.6, lean: 18, seed: 11, sunAz: -0.6, sunEl: 0.6, shadow: 0.5, warp: 1.4, swell: 0.2, gloss: 0.25 }),
]
