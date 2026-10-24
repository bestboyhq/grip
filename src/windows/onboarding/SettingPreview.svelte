<!-- What a recording setting looks like on screen, so nobody has to imagine it. A small desktop, closer
     than true scale so it reads, plays the setting on a loop as it is set: off shows recording without
     it, dimmed, and flipping the switch plays the change. Graphite like the app: color comes only from
     the recording dot. The countdown and the recording controls are
     the real components; the rest are drawings, since a preview must never turn on the camera.
     Decorative: the setting's row describes it to assistive tech. -->
<script lang="ts">
  import { fade } from 'svelte/transition'
  import Countdown, { burst, pop } from '../area/Countdown.svelte'
  import Widget from '../widget/Widget.svelte'
  import { shell, type Settings } from '../recorder/shell.svelte.ts'

  let { kind, on }: { kind: keyof Settings; on: boolean } = $props()

  // The countdown's 3-2-1, then a moment of recording, again.
  let count = $state(3)
  $effect(() => {
    if (kind !== 'countdown' || !on) return
    let t: ReturnType<typeof setTimeout>
    const step = () => {
      count = count === 0 ? 3 : count - 1
      t = setTimeout(step, count === 0 ? 1600 : 1000)
    }
    count = 3
    t = setTimeout(step, 1000)
    return () => clearTimeout(t)
  })
</script>

{#snippet menubar(recording = false)}
  <div class="menubar">
    <i></i><i class="short"></i><i class="short"></i>
    <span class="push"></span>
    {#if recording}<b class="rec"></b>{/if}
    <i class="short"></i>
  </div>
{/snippet}

{#snippet app()}
  <div class="app">
    <div class="lights"><i></i><i></i><i></i></div>
    <div class="lines"><i style:width="62%"></i><i style:width="84%"></i><i style:width="48%"></i><i style:width="72%"></i></div>
  </div>
{/snippet}

<div class="stage {kind}" class:off={!on} inert>
  {#if kind === 'countdown'}
    {@render menubar(!on || count === 0)}
    {@render app()}
    {#if on && count > 0}
      <div class="center" in:pop out:burst><Countdown {count} /></div>
    {/if}
  {:else if kind === 'showWidget'}
    {@render menubar(true)}
    {@render app()}
    {#if on}<div class="widget-at" transition:fade={{ duration: 200 }}><Widget params={new URLSearchParams('preview')} /></div>{/if}
  {:else if kind === 'showCamera'}
    {@render menubar(true)}
    {@render app()}
    {#if on}
      <div class="bubble {shell.settings?.cameraCorner ?? 'bottom-right'}" transition:fade={{ duration: 200 }}>
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle class="head" cx="32" cy="26" r="11" />
          <path class="body" d="M10 64c2-14 11-21 22-21s20 7 22 21z" />
        </svg>
      </div>
    {/if}
  {:else if kind === 'speakerNotes'}
    {@render menubar(true)}
    {@render app()}
    {#if on}
      <div class="notes" transition:fade={{ duration: 200 }}>
        <p>
          Hi, I’m Sam. In the next minute I’ll show you how to share a project with your team. First, open the project and
          press Share. Pick who can see it, then copy the link. That’s it: they can watch it right away, and leave comments.
        </p>
      </div>
    {/if}
  {:else if kind === 'hideDesktopIcons'}
    {@render menubar(true)}
    <div class="icons">
      {#each ['folder', 'doc', 'folder', 'doc'] as icon, i (i)}<span class={icon}><i></i><b></b></span>{/each}
    </div>
  {:else if kind === 'autoZoom'}
    <div class="screen">
      {@render menubar(true)}
      {@render app()}
      <span class="target"></span>
      <svg class="cursor" viewBox="0 0 12 18" aria-hidden="true"><path d="M1 1v14l3.6-3.4 2.3 5.4 2.3-1-2.3-5.3H12z" /></svg>
    </div>
  {/if}
</div>

<style>
  /* A desktop: a graphite wallpaper lit from the top left, a menu bar, one app window. */
  .stage {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background:
      radial-gradient(130% 110% at 10% -10%, rgb(255 255 255 / 0.2), transparent 60%),
      linear-gradient(165deg, #4a4a4f, #2a2a2e 60%, #212124);
    box-shadow: var(--hairline);
    transition: filter 300ms;
  }
  .stage.off {
    filter: grayscale(1) brightness(0.55);
  }
  .screen {
    position: absolute;
    inset: 0;
  }
  .menubar {
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 9px;
    padding: 0 7px;
    background: rgb(0 0 0 / 0.22);
  }
  .menubar i {
    width: 14px;
    height: 3px;
    border-radius: 1.5px;
    background: rgb(255 255 255 / 0.55);
  }
  .menubar i.short {
    width: 8px;
    background: rgb(255 255 255 / 0.35);
  }
  .push {
    flex: 1;
  }
  .rec {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--record);
    animation: fade-in 300ms both;
  }
  .app {
    position: absolute;
    top: 19%;
    left: 13%;
    width: 74%;
    height: 66%;
    border-radius: 6px;
    background: #1e1e22;
    box-shadow:
      0 0 0 0.5px rgb(255 255 255 / 0.12),
      0 8px 20px rgb(0 0 0 / 0.35);
  }
  .lights {
    display: flex;
    gap: 3px;
    padding: 6px 7px;
  }
  .lights i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.18);
  }
  .lines {
    display: grid;
    gap: 6px;
    padding: 6px 14px;
  }
  .lines i {
    height: 5px;
    border-radius: 2.5px;
    background: rgb(255 255 255 / 0.1);
  }

  /* Countdown: the real circle over the screen, at half size. */
  .center {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    zoom: 0.5;
  }

  /* Recording controls: the real widget, where it opens. The blur stands in for the HUD vibrancy. */
  .widget-at {
    position: absolute;
    bottom: 9%;
    left: 50%;
    width: 316px;
    height: 48px;
    translate: -50% 0;
    zoom: 0.6;
    contain: layout; /* holds the widget's position: fixed */
    border-radius: var(--radius-lg);
    backdrop-filter: blur(24px) saturate(1.6);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }

  /* Camera bubble: the real one's ring and shadow, in its corner, with a stand-in for you. */
  .bubble {
    position: absolute;
    top: 13%;
    left: 5%;
    width: 25%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 20%, #7a7a80, #46464b);
    box-shadow:
      0 0 0 1.5px rgb(255 255 255 / 0.2),
      0 6px 16px rgb(0 0 0 / 0.38);
  }
  .bubble:is(.bottom-left, .bottom-right) {
    top: auto;
    bottom: 8%;
  }
  .bubble:is(.top-right, .bottom-right) {
    left: auto;
    right: 5%;
  }
  .bubble svg {
    width: 100%;
    height: 100%;
    animation: nod 3.2s ease-in-out infinite;
  }
  .head {
    fill: #d6d6da;
  }
  .body {
    fill: #2c2c30;
  }

  /* Speaker notes: the prompter under the menu bar, scrolling. */
  .notes {
    position: absolute;
    top: 12%;
    left: 50%;
    width: 56%;
    height: 34%;
    translate: -50% 0;
    overflow: hidden;
    border-radius: 6px;
    background: rgb(28 28 30 / 0.72);
    backdrop-filter: blur(16px);
    box-shadow:
      0 0 0 0.5px rgb(255 255 255 / 0.16),
      0 8px 20px rgb(0 0 0 / 0.35);
  }
  .notes p {
    margin: 0;
    padding: 0 9px;
    mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent);
    color: #fff;
    font-size: 9px;
    font-weight: 500;
    line-height: 1.4;
    animation: scroll 14s linear infinite;
  }

  /* Hide desktop icons: they leave while you record, and come back after. */
  .icons {
    position: absolute;
    top: 15%;
    right: 5%;
    display: grid;
    gap: 9px;
    animation: hide 4.8s ease-in-out infinite;
  }
  .icons span {
    display: grid;
    justify-items: center;
    gap: 3px;
  }
  .icons i {
    width: 20px;
    height: 15px;
    border-radius: 2px;
    background: linear-gradient(#cfcfd4, #a4a4ab);
  }
  .icons .doc i {
    width: 14px;
    height: 18px;
    background: #f3f3f5;
  }
  .icons b {
    width: 22px;
    height: 3px;
    border-radius: 1.5px;
    background: rgb(255 255 255 / 0.7);
  }
  .hideDesktopIcons .rec {
    animation: recording 4.8s ease-in-out infinite;
  }
  .hideDesktopIcons.off :is(.icons, .rec) {
    animation: none; /* they stay through the recording */
  }

  /* Auto zoom: a click, then the view glides in on it, and back out. */
  .autoZoom .screen {
    transform-origin: 30% 67%;
    animation: zoom 5s infinite;
  }
  .autoZoom.off .screen {
    animation: none; /* the click, without the zoom */
  }
  .target {
    position: absolute;
    top: 63%;
    left: 23%;
    width: 14%;
    height: 8%;
    border-radius: 3px;
    background: var(--brand);
  }
  .target::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 6px;
    box-shadow: 0 0 0 1.5px rgb(255 255 255 / 0.8);
    opacity: 0;
    animation: click 5s infinite;
  }
  .cursor {
    position: absolute;
    top: 67%;
    left: 30%;
    width: 9px;
    fill: #000;
    stroke: #fff;
    stroke-width: 1.2;
    stroke-linejoin: round;
    animation: point 5s infinite;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes nod {
    50% {
      translate: 0 1.5px;
      rotate: 1.5deg;
    }
  }
  @keyframes scroll {
    from {
      translate: 0 40%;
    }
    to {
      translate: 0 -100%;
    }
  }
  @keyframes hide {
    0%,
    30%,
    100% {
      opacity: 1;
      scale: 1;
    }
    40%,
    88% {
      opacity: 0;
      scale: 0.92;
    }
  }
  @keyframes recording {
    0%,
    30%,
    96%,
    100% {
      opacity: 0;
    }
    36%,
    88% {
      opacity: 1;
    }
  }
  @keyframes zoom {
    0%,
    24% {
      scale: 1;
      animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
    }
    42%,
    72% {
      scale: 2;
      animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
    }
    90%,
    100% {
      scale: 1;
    }
  }
  @keyframes click {
    0%,
    19% {
      opacity: 0;
      scale: 0.8;
    }
    21% {
      opacity: 1;
      scale: 1;
    }
    34%,
    100% {
      opacity: 0;
      scale: 1.25;
    }
  }
  @keyframes point {
    0% {
      translate: 120px 40px;
      opacity: 0;
    }
    4% {
      opacity: 1;
      animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
    }
    18%,
    90% {
      translate: 0 0;
      opacity: 1;
    }
    98%,
    100% {
      translate: 0 0;
      opacity: 0;
    }
  }

  /* Reduced motion: each setting holds its telling frame. */
  @media (prefers-reduced-motion: reduce) {
    .stage *,
    .stage *::after {
      animation: none !important;
    }
    .autoZoom:not(.off) .screen {
      scale: 2;
    }
    .hideDesktopIcons:not(.off) .icons {
      opacity: 0;
    }
  }
</style>
