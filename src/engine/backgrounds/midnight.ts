import type { Wallpaper } from './index.ts'
import { dune, picture, veil, type Dune, type Picture, type SkyPoint } from './picture.ts'

const midnight = (id: string, name: string, p: Picture) => picture('Midnight', `midnight-${id}`, name, p)
/** A sheet of silk threads: its crest's two ends, lit, and clear far below it. */
const sheet = (a: string, b: string, angle: number, line: number, height: number, scale: number, ph: number, o: Partial<Dune> = {}) =>
  dune(a, b, '#000000', angle, line, height, scale, ph, { top: 0.9, deep: 0, depth: 0.3, rim: 1, shade: 0, threads: 70, thread: 0.5, pinch: 0.5, turn: ph, light: 0.6, ...o })
/** A dark hill that hides what lies behind it: only its crest takes the light. */
const hill = (a: string, b: string, angle: number, line: number, height: number, scale: number, ph: number, o: Partial<Dune> = {}) =>
  dune(a, b, '#000000', angle, line, height, scale, ph, { depth: 0.12, rim: 1, shade: 0, threads: 36, thread: 0.4, light: 0.8, ...o })
const NIGHT: SkyPoint[] = [[-0.7, -0.5, '#050506'], [0.6, -0.5, '#0b0c0e'], [0.6, 0.3, '#030304'], [-0.6, 0.3, '#070709']]

// Midnight: black and gray. Sheets of silk threads, lit at the crest and clear below it, and glossy dark
// shapes under a silver light. The threads show at full size and melt into smooth silk on a small tile.
export const MIDNIGHT: Wallpaper[] = [
  midnight('obsidian', 'Obsidian', { sky: NIGHT, dunes: [
    sheet('#2a2b2f', '#f0f2f5', -0.3, 0.12, 0.06, 2.8, 1.0, { depth: 0.35 }),
    sheet('#a4a6ac', '#3a3b40', 0.08, 0.3, 0.05, 3.4, 4.0, { depth: 0.22, light: -0.6 })] }),
  midnight('noir', 'Noir', { sky: NIGHT, dunes: [
    sheet('#f0f2f5', '#74777e', 0.05, -0.14, 0.05, 3.2, 0.5, { depth: 0.2, pinch: 0.85, threads: 50, thread: 0.7, top: 0.8 }),
    sheet('#55575c', '#d0d3d8', -0.08, -0.02, 0.07, 2.8, 2.6, { depth: 0.24, pinch: 0.8, threads: 56, thread: 0.7, top: 0.7 })] }),
  midnight('eclipse', 'Eclipse', { sky: [[-0.7, -0.5, '#060505'], [0.6, -0.5, '#0e0d0c'], [0.6, 0.3, '#030302'], [-0.6, 0.3, '#080707']], dunes: [
    sheet('#3a3836', '#f2ece4', 0.45, -0.1, 0.09, 2.0, 0.8, { top: 0.95, depth: 0.45, thread: 0.4, pinch: 0.3 }),
    hill('#4a4846', '#1d1c1a', 0.3, 0.33, 0.05, 2.4, 3.0, { rim: 0.6 })] }),
  midnight('platinum', 'Platinum', { sky: [[-0.7, -0.5, '#16171a'], [0.6, -0.5, '#2a2c30'], [0.6, 0.3, '#0a0a0c'], [-0.6, 0.3, '#101113']], dunes: [
    sheet('#f4f5f8', '#9a9da4', 0.2, -0.12, 0.08, 2.4, 0.4, { depth: 0.4 }),
    sheet('#74777e', '#e4e6ea', 0.12, 0.14, 0.07, 2.8, 2.6, { depth: 0.35 }),
    hill('#74777e', '#3a3c41', 0.05, 0.38, 0.04, 3.0, 5.0, { rim: 0.8 })] }),
  midnight('jet', 'Jet', { sky: NIGHT, dunes: [
    sheet('#2a2b2e', '#5a5c61', -0.1, 0.1, 0.08, 2.4, 1.2, { top: 0.6, rim: 0.6, thread: 0.4 }),
    hill('#3a3b40', '#18181b', 0.08, 0.3, 0.06, 2.6, 4.2, { rim: 0.5 })] }),
  midnight('tuxedo', 'Tuxedo', { sky: NIGHT, dunes: [
    sheet('#55575c', '#c8cad0', -0.3, -0.04, 0.06, 2.2, 0.6, { top: 0.7 }),
    dune('#2a2b2f', '#3a3c41', ['#d0d3d8', '#8a8d94'], 0.14, 0.12, 0.08, 2.6, 3.2, { top: 0.4, deep: 0.95, depth: 0.4, rim: 1, shade: 0, threads: 60, thread: 0.3, light: 0.5 })] }),
  midnight('lacquer', 'Lacquer', { sky: [[-0.7, -0.5, '#6a6d74'], [0.5, -0.6, '#dcdee4'], [0.7, 0, '#8a8d94'], [-0.6, 0.2, '#3a3c41']], dunes: [
    veil('#f0f2f5', 0.35, -0.25, 0.06, 1.8, 1.0),
    veil('#c8cad0', 0.2, -0.02, 0.05, 2.0, 2.4, { top: 0.25 }),
    dune('#2a2b2f', '#3a3c41', '#050506', -0.5, 0.12, 0.08, 1.8, 0.6, { depth: 0.12, rim: 1, shade: 0.2, reach: 0.08 })] }),
  midnight('quicksilver', 'Quicksilver', { sky: NIGHT, dunes: [
    sheet('#9a9da4', '#f0f2f5', -0.2, -0.15, 0.06, 2.6, 0.3, { depth: 0.18, top: 0.8 }),
    sheet('#f0f2f5', '#74777e', 0.1, 0, 0.07, 2.8, 2.2, { depth: 0.18, top: 0.85 }),
    sheet('#6a6c72', '#dcdee4', -0.12, 0.17, 0.06, 3.0, 4.4, { depth: 0.18, top: 0.85 }),
    sheet('#c8cad0', '#55575c', 0.06, 0.34, 0.05, 2.6, 1.0, { depth: 0.18, top: 0.8 })] }),
  midnight('mercury', 'Mercury', { sky: NIGHT, dunes: [
    hill('#5a5c61', '#8a8d94', 0, -0.1, 0.05, 6.5, 0.5, { light: 0.7 }),
    hill('#a4a6ac', '#6a6c72', -0.06, 0.02, 0.06, 5.5, 2.4, { light: 0.7 }),
    hill('#74777e', '#c8cad0', 0.05, 0.16, 0.06, 5.0, 4.6, { light: 0.7 }),
    hill('#3a3c41', '#74777e', 0, 0.33, 0.04, 4.0, 1.2, { light: 0.7 })] }),
  midnight('pewter', 'Pewter', { sky: [[-0.6, -0.5, '#9a9da4'], [0.6, -0.5, '#e4e6ea'], [0.6, 0, '#6a6d74'], [-0.6, 0, '#55575c']], dunes: [
    dune('#74777e', '#8a8d94', '#4a4c51', 0.15, -0.2, 0.04, 2.2, 0.5, { rim: 0.5, shade: 0.15 }),
    dune('#4a4c51', '#5a5d63', '#2a2c30', 0.2, -0.02, 0.04, 2.4, 2.2, { rim: 0.4, shade: 0.15 }),
    dune('#2a2c30', '#36383d', '#141518', 0.16, 0.16, 0.04, 2.6, 4.0, { rim: 0.35 }),
    dune('#141518', '#1c1d21', '#020203', 0.2, 0.34, 0.04, 2.4, 5.5, { rim: 0.3 })] }),
  midnight('slate', 'Slate', { sky: [[-0.6, -0.6, '#5a5e66'], [0.6, -0.6, '#6a6e76'], [0, 0, '#c0c4cc', 1.4], [0, 0.4, '#24272c']], dunes: [
    veil('#e4e6ea', -0.12, -0.2, 0.05, 1.6, 2.0, { top: 0.2 }),
    dune('#3a3d43', '#4a4d54', '#000000', 0.03, 0.1, 0.03, 1.8, 0.8, { rim: 0.9, depth: 0.22, shade: 0.1 })] }),
  midnight('gunmetal', 'Gunmetal', { sky: [[-0.6, -0.5, '#1c1d21'], [0.6, -0.5, '#101113'], [0.6, 0, '#26272b'], [-0.6, 0, '#18191c']], dunes: [
    dune('#101113', '#18191c', '#0a0a0c', -0.15, -0.3, 0.08, 1.8, 1.0, { rim: 0.25 }),
    dune('#3c3e43', '#2c2e32', '#1c1d21', 0.12, 0.02, 0.06, 2.4, 2.4, { rim: 0.4 }),
    dune('#26272b', '#32343a', '#141518', -0.08, 0.2, 0.06, 2.6, 4.2, { rim: 0.35 }),
    dune('#18191c', '#202125', '#060607', 0.1, 0.38, 0.05, 2.4, 0.5, { rim: 0.3 })] }),
  midnight('nocturne', 'Nocturne', { sky: [[-0.6, -0.5, '#06070a'], [0.6, -0.5, '#0a0c10'], [0.6, 0.3, '#030305'], [-0.6, 0.3, '#08090c']], dunes: [
    sheet('#eef1fa', '#7a8090', -0.06, -0.04, 0.06, 2.4, 0.2, { depth: 0.14, top: 0.8, pinch: 0.85, threads: 44, thread: 0.7 }),
    sheet('#5a606c', '#c8ccd8', 0.05, 0.06, 0.05, 2.8, 2.0, { depth: 0.16, top: 0.7, pinch: 0.8, threads: 44, thread: 0.7, light: -0.5 })] }),
  midnight('raven', 'Raven', { sky: [[-0.7, -0.5, '#0c0c0e'], [0.6, -0.5, '#16171a'], [0.6, 0.3, '#050506'], [-0.6, 0.3, '#020203']], dunes: [
    dune('#3a3c44', '#101113', '#000000', 0.5, -0.35, 0.015, 1.5, 0, { depth: 0.3, rim: 0.5, top: 0.9, deep: 0, shade: 0 }),
    dune('#dcdee4', '#26272b', '#000000', 0.55, -0.05, 0.015, 1.5, 1, { depth: 0.35, rim: 0.9, top: 0.95, deep: 0, shade: 0 }),
    dune('#55575c', '#141518', '#000000', 0.5, 0.25, 0.015, 1.5, 2, { depth: 0.3, rim: 0.5, top: 0.8, deep: 0, shade: 0 })] }),
  midnight('carbon', 'Carbon', { sky: NIGHT, dunes: [
    sheet('#8a8d94', '#d0d3d8', -0.14, -0.06, 0.08, 2.4, 1.6, { depth: 0.6, top: 0.75, threads: 120, thread: 0.7, pinch: 0.35 }),
    sheet('#c8cad0', '#55575c', 0.1, 0.26, 0.05, 2.8, 4.0, { depth: 0.45, top: 0.65, threads: 96, thread: 0.7, light: -0.5 })] }),
  midnight('smoke', 'Smoke', { sky: [[-0.7, -0.5, '#0d0d10'], [0.6, -0.5, '#16171a'], [0.6, 0.3, '#050506'], [-0.6, 0.3, '#0a0a0c']], dunes: [
    sheet('#74777e', '#b0b2b8', 0, -0.04, 0.04, 7.0, 0.6, { depth: 0.22, top: 0.7 }),
    sheet('#c8cad0', '#6a6c72', 0.06, 0.07, 0.05, 6.0, 2.8, { depth: 0.26, top: 0.75 }),
    sheet('#55575c', '#a4a6ac', -0.05, 0.23, 0.04, 5.0, 5.0, { depth: 0.26, top: 0.7 })] }),
  midnight('onyx', 'Stardust', { sky: [[0.5, -0.45, '#f4f5fa', 1.6], [-0.7, -0.5, '#3c3f48'], [0.8, 0.1, '#6c7078'], [-0.5, 0.1, '#1e2026']], dunes: [
    veil('#ffffff', -0.5, -0.1, 0.08, 1.6, 0.6, { top: 0.25 }),
    dune('#2e3038', '#15161a', '#020203', -0.55, 0.22, 0.07, 1.6, 0.9, { depth: 0.15, rim: 0.9, shade: 0.25, reach: 0.08 })] }),
  midnight('ebony', 'Starfall', { sky: [[-0.7, -0.5, '#060505'], [0.6, -0.5, '#0c0b0a'], [0.6, 0.3, '#030202'], [-0.6, 0.3, '#080707']], dunes: [
    sheet('#fff7ec', '#3a3632', -0.3, -0.12, 0.08, 2.2, 2.4, { depth: 0.35, light: -0.6 }),
    sheet('#dcd6cc', '#8a857e', -0.2, 0.14, 0.07, 2.6, 4.6, { top: 0.85, light: -0.6 }),
    hill('#2a2724', '#5a554e', -0.1, 0.37, 0.05, 2.8, 0.6, { rim: 0.7, light: -0.6 })] }),
]
