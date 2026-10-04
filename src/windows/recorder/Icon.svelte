<!-- Line icons for the recording UI. Our own drawings: stroke = currentColor, sized by width/height. -->
<script lang="ts" module>
  export type IconName =
    | 'display' | 'window' | 'area' | 'device' | 'camera' | 'camera-off' | 'mic' | 'mic-off' | 'speaker' | 'speaker-off'
    | 'gear' | 'chevron' | 'close' | 'pause' | 'play' | 'stop' | 'restart' | 'trash' | 'check' | 'screen' | 'keyboard' | 'accessibility'

  /** Drawing boxes other than 24 x 24. Toolbar glyphs are drawn in points (1 unit = 1 pt at their size). */
  const BOX: Partial<Record<IconName, string>> = {
    display: '0 0 26 20',
    window: '0 0 26 20',
    chevron: '0 0 10 6',
    mic: '0 0 12 17',
    'mic-off': '0 0 12 17',
    speaker: '0 0 20 16',
    'speaker-off': '0 0 20 16',
    gear: '0 0 18 18',
  }
  /** 16 teeth around the gear's rim. */
  const TEETH = Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8
    const p = (r: number, d: number) => `${(9 + r * Math.cos(a + d)).toFixed(2)} ${(9 + r * Math.sin(a + d)).toFixed(2)}`
    return `M${p(6.7, -0.17)}L${p(8.5, -0.05)}L${p(8.5, 0.05)}L${p(6.7, 0.17)}Z`
  }).join('')
</script>

<script lang="ts">
  let { name, size = 20, width, height, stroke = 1.6 }: { name: IconName; size?: number; width?: number; height?: number; stroke?: number } = $props()
</script>

<svg
  width={width ?? size}
  height={height ?? size}
  viewBox={BOX[name] ?? '0 0 24 24'}
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'display'}
    <rect x="1.5" y="1.5" width="23" height="17" rx="2.6" />
    <rect x="4.6" y="12.7" width="16.8" height="2.6" rx="1.3" fill="currentColor" stroke="none" />
  {:else if name === 'window'}
    <rect x="1.5" y="1" width="23" height="18" rx="2.6" />
    <path d="M1.5 5.9h23" />
    <circle cx="4.6" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="6.9" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="9.2" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
  {:else if name === 'area'}
    <path d="M3 7.5V5a2 2 0 0 1 2-2h2.5M16.5 3H19a2 2 0 0 1 2 2v2.5M21 16.5V19a2 2 0 0 1-2 2h-2.5M7.5 21H5a2 2 0 0 1-2-2v-2.5" />
    <path d="M10.5 3h3M10.5 21h3M3 10.5v3M21 10.5v3" />
  {:else if name === 'device'}
    <rect x="6" y="1.5" width="12" height="21" rx="3" />
    <path d="M10.5 4.6h3" />
    <path d="M9.2 9h.01M12 9h.01M14.8 9h.01M9.2 12.3h.01M12 12.3h.01M14.8 12.3h.01M9.2 15.6h.01M12 15.6h.01M14.8 15.6h.01M9.2 18.9h.01M12 18.9h.01M14.8 18.9h.01" />
  {:else if name === 'camera' || name === 'camera-off'}
    <rect x="1.5" y="6" width="14" height="12" rx="2.8" />
    <path d="M15.5 10.6l5.4-3.1a.7.7 0 0 1 1.1.6v7.8a.7.7 0 0 1-1.1.6l-5.4-3.1" />
    {#if name === 'camera-off'}<path d="M2 3l19 17" />{/if}
  {:else if name === 'mic' || name === 'mic-off'}
    <rect x="3.5" y="0.5" width="5" height="11" rx="2.5" fill="currentColor" stroke="none" />
    <path d="M1.25 8.4a4.75 4.75 0 0 0 9.5 0M6 13.15v2.6M2.75 15.75h6.5" />
    {#if name === 'mic-off'}<path d="M.75 .75l10.5 15.5" />{/if}
  {:else if name === 'speaker' || name === 'speaker-off'}
    <!-- A display with a note: the sound your Mac plays. -->
    <rect x="0.75" y="0.75" width="18.5" height="11.5" rx="1.9" />
    <rect x="5.5" y="14.5" width="9" height="1.5" fill="currentColor" stroke="none" />
    <path d="M9.5 3.4l3.4-.9v2.4l-2.9.7z" fill="currentColor" stroke="none" />
    <path d="M9.95 3.3v5.9" stroke-width="0.95" />
    <ellipse cx="8.45" cy="9.35" rx="1.5" ry="1.15" transform="rotate(-25 8.45 9.35)" fill="currentColor" stroke="none" />
    {#if name === 'speaker-off'}<path d="M2.5 .75l15 14.5" />{/if}
  {:else if name === 'gear'}
    <path d={TEETH} fill="currentColor" stroke="none" />
    <circle cx="9" cy="9" r="6.4" stroke-width="1.25" />
    <circle cx="9" cy="9" r="1.45" stroke-width="1.1" />
    {#each [0, 120, 240] as deg (deg)}<path d="M10.45 9h4.3" stroke-width="1.1" transform="rotate({deg} 9 9)" />{/each}
  {:else if name === 'chevron'}
    <path d="M1 1l4 4 4-4" />
  {:else if name === 'close'}
    <path d="M7 7l10 10M17 7L7 17" />
  {:else if name === 'pause'}
    <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
  {:else if name === 'play'}
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor" stroke="none" />
  {:else if name === 'stop'}
    <rect x="5.5" y="5.5" width="13" height="13" rx="3" fill="currentColor" stroke="none" />
  {:else if name === 'restart'}
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.2 3.6v3.6h3.6" />
  {:else if name === 'trash'}
    <path d="M4 6.5h16M9.5 6.5V4.6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.9M6.2 6.5l.9 12.6a2 2 0 0 0 2 1.9h5.8a2 2 0 0 0 2-1.9l.9-12.6" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'screen'}
    <rect x="2" y="3.5" width="20" height="14" rx="2.6" />
    <circle cx="12" cy="10.5" r="2.6" fill="currentColor" stroke="none" />
    <path d="M8.5 21h7" />
  {:else if name === 'keyboard'}
    <rect x="1.5" y="5" width="21" height="14" rx="2.6" />
    <path d="M5.5 9h1M9.5 9h1M13.5 9h1M17.5 9h1M5.5 12.5h1M9.5 12.5h1M13.5 12.5h1M17.5 12.5h1M8 16h8" />
  {:else if name === 'accessibility'}
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="7.4" r="1.4" fill="currentColor" stroke="none" />
    <path d="M7.5 10.2l4.5 1.1 4.5-1.1M12 11.3v3.2l-2.3 3.6M12 14.5l2.3 3.6" />
  {/if}
</svg>
