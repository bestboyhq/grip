import type { Wallpaper } from './index.ts'
import { dune, picture, type Dune, type Picture } from './picture.ts'

const iridescent = (id: string, name: string, p: Picture) => picture('Iridescent', `iridescent-${id}`, name, p)
/** A fold of pearl: a bright crest over a shallow, pale depth. */
const fold = (a: string, b: string, d: string | string[], angle: number, line: number, height: number, scale: number, ph: number, o: Partial<Dune> = {}) =>
  dune(a, b, d, angle, line, height, scale, ph, { depth: 0.2, shade: 0.04, rim: 0.8, ...o })

// Iridescent: pearl, white folds over pastels.
export const IRIDESCENT: Wallpaper[] = [
  iridescent('nacre', 'Nacre', { sky: [[-0.6, -0.5, '#d0e4dc'], [0.6, -0.5, '#c8c4f0'], [0.6, 0.1, '#e8e0f0'], [-0.6, 0.1, '#bce8d4']], dunes: [
    fold('#ffffff', '#f4fff8', ['#c0ead8', '#f0d0e8'], -0.5, 0.05, 0.1, 1.8, 0.6, { depth: 0.12, deep: 0.3 }),
    fold('#ffffff', '#fff0e0', ['#f8c0e0', '#ffdcc0'], -0.3, 0.3, 0.07, 2.0, 2.4)] }),
  iridescent('chiffon', 'Chiffon', { sky: [[-0.6, -0.5, '#90e0d8'], [0.6, -0.5, '#a8e8e0'], [0.6, 0.1, '#d8f0e8'], [-0.6, 0.1, '#b0e4e0']], dunes: [
    fold('#f0c0e8', '#e8d0f0', '#d8a0e8', 0.1, 0.22, 0.05, 3.4, 0.8, { blur: 0.02, depth: 0.25 }),
    fold('#f8e0f0', '#80c8f0', ['#e0a8e0', '#5a98e8'], -0.2, 0.36, 0.05, 2.6, 2.6, { depth: 0.14 })] }),
  iridescent('tulle', 'Tulle', { sky: [[-0.6, -0.5, '#f0f0fa'], [0.6, -0.5, '#ffffff'], [0.6, 0.2, '#fff0f4'], [-0.6, 0.1, '#c8b0f8']], dunes: [
    fold('#fbf4ff', '#fff4f8', ['#d8b8f8', '#f8d0e8'], 0.3, 0.2, 0.06, 2.0, 0.6, { blur: 0.03, depth: 0.3 })] }),
  iridescent('halo', 'Halo', { sky: [[-0.6, -0.5, '#f8a8c8'], [0.5, -0.5, '#ffd8c8'], [-0.5, 0.05, '#c060f0'], [0.3, 0.2, '#a0b8f8']], dunes: [
    fold('#ffffff', '#e8f0f8', ['#b8c8d8', '#a8c0d0'], -1.1, 0.3, 0.08, 1.8, 0.6, { depth: 0.16 }),
    fold('#e0f0ff', '#f8ffff', '#a8c8f8', 0.1, 0.4, 0.04, 2.4, 2.4, { blur: 0.03, fade: [0.7, 0.3] })] }),
  iridescent('bubble', 'Soap Bubble', { sky: [[-0.6, -0.5, '#80e8f0'], [0.6, -0.5, '#d0c8f8'], [0.6, 0, '#f8e0f0'], [-0.6, 0, '#a0f0e8']], dunes: [
    fold('#d8f4f4', '#ffffff', ['#a8e0e8', '#f8e8f0'], 0.05, -0.02, 0.05, 4.4, 0.6, { depth: 0.14, deep: 0.5 }),
    fold('#fff0f0', '#ffe0e0', ['#f8b0c0', '#f8c8d0'], -0.1, 0.16, 0.05, 3.0, 2.6, { blur: 0.02 }),
    fold('#f090a8', '#f8b0c0', ['#70a8f0', '#e880a8'], 0.1, 0.36, 0.04, 2.8, 4.4, { blur: 0.03, rim: 0.5 })] }),
  iridescent('opaline', 'Opaline', { sky: [[-0.6, -0.5, '#c8e8e0'], [0.6, -0.5, '#fff0d8'], [0.6, 0.1, '#fff4e4'], [-0.6, 0.1, '#d0c8f0']], dunes: [
    fold('#b0e8e8', '#d0f4f0', ['#d8c8f0', '#f0d0e8'], 0.6, -0.12, 0.06, 1.8, 0.6, { depth: 0.1 }),
    fold('#fbf0ff', '#fff4f0', ['#d0b0f0', '#f8c8e0'], 0.6, 0.1, 0.07, 1.8, 2.4, { depth: 0.25 })] }),
  iridescent('gossamer', 'Gossamer', { sky: [[-0.6, -0.5, '#f8b0d0'], [0.5, -0.5, '#ffffff'], [0.6, 0, '#f4f0ff'], [-0.6, 0, '#f080d8']], dunes: [
    fold('#ffffff', '#f0f4ff', ['#c080f0', '#9a90f8'], -0.55, 0.2, 0.06, 1.8, 0.8, { depth: 0.1 }),
    fold('#c0b0f8', '#b0c0f8', '#9a80f0', -0.4, 0.4, 0.05, 2.0, 2.6, { blur: 0.03 })] }),
  iridescent('moonstone', 'Moonstone', { sky: [[-0.6, -0.5, '#ece8e0'], [0.6, -0.5, '#e0d8f0'], [0.6, 0, '#d8c8f8'], [-0.6, 0, '#f0ece8']], dunes: [
    fold('#fbfbf8', '#e8e0f8', ['#d0d8d8', '#c8a8f8'], -0.15, 0.1, 0.07, 2.8, 2.4, { depth: 0.16, deep: 0.6 }),
    fold('#ffffff', '#d8c0ff', ['#90a8f8', '#e080f0'], -0.1, 0.24, 0.06, 2.6, 4.2, { depth: 0.12 })] }),
  iridescent('meringue', 'Meringue', { sky: [[-0.6, -0.5, '#c8a0f8'], [-0.1, -0.5, '#f8c0e0'], [0.6, -0.2, '#fff8f0'], [0.5, 0.3, '#f4f0ec']], dunes: [
    fold('#e8ecf0', '#f8f8f8', ['#c0c8d0', '#d8dce0'], 0.5, 0.0, 0.05, 1.8, 0.6, { depth: 0.2, deep: 0.7 }),
    fold('#a0e0f8', '#c0f0f0', ['#2a40b0', '#70d0d0'], 0.7, 0.3, 0.06, 1.8, 2.4, { depth: 0.1 })] }),
  iridescent('lustre', 'Lustre', { sky: [[-0.7, -0.5, '#8a40e0'], [0.5, -0.5, '#f8f0f8'], [0.6, 0, '#fff4f0'], [-0.3, -0.2, '#f0e0f8']], dunes: [
    fold('#fff8e0', '#fff0e8', ['#ffe0b0', '#f8d8e0'], 0.45, -0.06, 0.07, 2.0, 0.4, { depth: 0.1, deep: 0.3 }),
    fold('#70e0e0', '#c0f4ec', ['#80e0c0', '#d8f0e8'], 0.4, 0.08, 0.08, 2.2, 2.0, { depth: 0.16 })] }),
  iridescent('holo', 'Holo', { sky: [[-0.6, -0.5, '#b0e0e0'], [0.6, -0.5, '#d0d8dc'], [0.6, 0, '#e8e0e8'], [-0.6, 0, '#c0d0d8']], dunes: [
    fold('#f4f4f4', '#fff0e0', ['#c8d0d8', '#f8d0d0'], -0.6, 0.1, 0.07, 1.8, 0.6, { depth: 0.14, deep: 0.5 }),
    fold('#ffe8e8', '#ffd0e0', ['#f0a0c8', '#f080c0'], -0.35, 0.26, 0.06, 2.0, 2.4)] }),
  iridescent('glaze', 'Glaze', { sky: [[0, -0.6, '#70c0d0'], [0, -0.15, '#f0f4f8'], [0.3, 0.3, '#f070f0'], [-0.4, 0.3, '#d0a0f8']], dunes: [
    fold('#fbfbff', '#f8f4ff', '#f0e0fb', 0.08, -0.08, 0.04, 3.0, 0.8, { blur: 0.03, depth: 0.2, deep: 0.3, rim: 0.4 })] }),
  iridescent('taffeta', 'Marbling', { sky: [[-0.6, -0.5, '#ffffff'], [0.5, -0.5, '#c060e8'], [0.6, 0, '#b090f8'], [-0.6, 0.1, '#fbe8e0']], dunes: [
    fold('#f8f4ff', '#d0d0ff', ['#f0c8b8', '#8098f8'], -0.75, 0.2, 0.06, 1.8, 0.6, { depth: 0.14 }),
    fold('#c0d0f8', '#90d8f8', ['#90b0f0', '#60c0f0'], -0.7, 0.4, 0.05, 1.8, 2.4)] }),
  iridescent('organza', 'Caustic', { sky: [[-0.6, -0.5, '#f8b890'], [0.6, -0.5, '#e8e0f8'], [0.6, 0, '#d0b8f8'], [-0.6, 0, '#ffe0d0']], dunes: [
    fold('#f8a090', '#f080c0', ['#ffc8b0', '#d880e0'], 0.35, -0.15, 0.06, 2.2, 0.6, { depth: 0.12, deep: 0.3 }),
    fold('#f8fbe8', '#c8f0e8', ['#d0f0d8', '#a0e0d8'], 0.3, 0.1, 0.07, 2.2, 2.4, { depth: 0.25 }),
    fold('#c8f4f0', '#90c8c8', '#5a9aa0', 0.4, 0.36, 0.05, 2.0, 4.2, { fade: [0.3, 0.7] })] }),
  iridescent('gelato', 'Rainlight', { sky: [[-0.6, -0.5, '#fff0e8'], [0.6, -0.5, '#f8d0e0'], [0.6, 0, '#f0c8e8'], [-0.6, 0, '#fbf0f0']], dunes: [
    fold('#f8e8f8', '#f0d0f0', ['#e8e0f0', '#d8a8e8'], 0.9, 0.2, 0.06, 1.6, 0.6, { blur: 0.03, depth: 0.3, deep: 0.5, rim: 0.3 }),
    fold('#ffffff', '#b0a0f8', ['#b0e8f0', '#6a50d8'], -0.15, 0.26, 0.05, 2.6, 2.4, { depth: 0.12 })] }),
  iridescent('seashell', 'Seashell', { sky: [[-0.6, -0.5, '#f8b0d0'], [0.6, -0.5, '#f0c0f0'], [0, 0, '#fbf0f4'], [-0.6, 0.2, '#ffe8e0']], dunes: [
    fold('#fff8f8', '#a0c8f0', ['#f8d8e8', '#80b0e8'], -0.2, 0.3, 0.06, 2.4, 0.4, { depth: 0.14, blur: 0.02 })] }),
  iridescent('petal', 'Abalone', { sky: [[-0.6, -0.5, '#d8d0e8'], [0.6, -0.5, '#fbfbfb'], [0.6, 0, '#fff0e0'], [-0.6, 0, '#e8e0f0']], dunes: [
    fold('#ffffff', '#fff4e8', ['#e0e0f0', '#ffe0c8'], 0.75, -0.1, 0.06, 1.6, 0.6, { depth: 0.1, deep: 0.4 }),
    fold('#e8f8f8', '#fff0e0', ['#a0d8f0', '#f8d0b8'], 0.7, 0.1, 0.07, 1.8, 2.2, { depth: 0.2 }),
    fold('#80c0f0', '#f8b0c0', ['#5a90e0', '#f090b0'], 0.3, 0.36, 0.05, 2.2, 4.0, { blur: 0.02 })] }),
]
