<!-- Line icons for the recording UI. Our own drawings: stroke = currentColor, sized by width/height. -->
<script lang="ts" module>
  export type IconName =
    | 'display' | 'window' | 'area' | 'device' | 'camera' | 'camera-off' | 'mic' | 'mic-off' | 'speaker' | 'speaker-off'
    | 'gear' | 'chevron' | 'close' | 'pause' | 'play' | 'stop' | 'restart' | 'trash' | 'check' | 'screen' | 'keyboard'
</script>

<script lang="ts">
  let { name, size = 20, width, height, stroke = 1.6 }: { name: IconName; size?: number; width?: number; height?: number; stroke?: number } = $props()
</script>

<svg
  width={width ?? size}
  height={height ?? size}
  viewBox={name === 'display' || name === 'window' ? '0 0 26 20' : name === 'chevron' ? '0 0 10 6' : '0 0 24 24'}
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'display'}
    <rect x="1.5" y="1.5" width="23" height="13.5" rx="2.6" />
    <path d="M9.5 18.5h7M13 15v3.5" />
  {:else if name === 'window'}
    <rect x="1.5" y="1" width="23" height="18" rx="2.6" />
    <path d="M1.5 5.9h23" />
    <circle cx="4.6" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="6.9" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="9.2" cy="3.5" r="0.55" fill="currentColor" stroke="none" />
  {:else if name === 'area'}
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <path d="M10 12h4M12 10v4" stroke-width={stroke * 0.85} />
  {:else if name === 'device'}
    <rect x="6" y="1.5" width="12" height="21" rx="3" />
    <path d="M10.5 4.6h3" />
  {:else if name === 'camera' || name === 'camera-off'}
    <rect x="1.5" y="6" width="14" height="12" rx="2.8" />
    <path d="M15.5 10.6l5.4-3.1a.7.7 0 0 1 1.1.6v7.8a.7.7 0 0 1-1.1.6l-5.4-3.1" />
    {#if name === 'camera-off'}<path d="M2 3l20 18" />{/if}
  {:else if name === 'mic' || name === 'mic-off'}
    <rect x="8.5" y="2" width="7" height="12.5" rx="3.5" />
    <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22" />
    {#if name === 'mic-off'}<path d="M3 3l18 18" />{/if}
  {:else if name === 'speaker' || name === 'speaker-off'}
    <rect x="1.5" y="2.5" width="21" height="15" rx="2.6" />
    <path d="M8.5 21.5h7" />
    <path d="M7.5 8.5h2l3-2.5v8l-3-2.5h-2z" stroke-width={stroke * 0.9} />
    {#if name === 'speaker'}<path d="M15.2 7.8a3.4 3.4 0 0 1 0 4.4M17.4 6a6 6 0 0 1 0 8" stroke-width={stroke * 0.9} />
    {:else}<path d="M15.5 8l3 4M18.5 8l-3 4" stroke-width={stroke * 0.9} />{/if}
  {:else if name === 'gear'}
    <circle cx="12" cy="12" r="8.3" stroke-width={stroke * 1.9} stroke-dasharray="3.2 3.32" stroke-linecap="butt" />
    <circle cx="12" cy="12" r="6.6" />
    <circle cx="12" cy="12" r="2.6" />
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
  {/if}
</svg>
