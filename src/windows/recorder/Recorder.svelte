<!-- Recording toolbar, bottom center of the active display: close, Display / Window / Area / Device,
     camera, microphone with a live level, system audio, settings. A downloaded update veils it until
     the user restarts or puts it off (Later, Esc) for a day.
     It is also the session controller (electron/shell/recorder.ts): it runs the shell's commands
     against the capture engine and reports the engine's errors and warnings to the shell. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { blur, fade } from 'svelte/transition'
  import { dropFiles, invoke, on } from '../../lib/ipc.ts'
  import Icon from './Icon.svelte'
  import { springProgress, type SpringConfig } from '../../engine/motion/spring.ts'
  import {
    ensurePermission,
    inputs,
    meterLevel,
    popup,
    setSettings,
    shell,
    startRequest,
    windowList,
    type Device,
    type MenuItem,
    type Mode,
    type Settings,
    type StartRequest,
    type Target,
    type WindowSource,
  } from './shell.svelte.ts'

  let { params }: { params: URLSearchParams } = $props()

  const MODES: Array<{ id: Mode; label: string; w: number; h: number }> = [
    { id: 'display', label: 'Display', w: 27.5, h: 21 },
    { id: 'window', label: 'Window', w: 26.5, h: 20.4 },
    { id: 'area', label: 'Area', w: 24, h: 24 },
    { id: 'device', label: 'Device', w: 24, h: 24 },
  ]

  let lists = $state<{ cameras: Device[]; mics: Device[]; devices: Device[] }>({ cameras: [], mics: [], devices: [] })
  let level = $state(0)
  let countdown = $state<{ n: number; name: string } | null>(null)

  const s = $derived(shell.settings)
  const camera = $derived(lists.cameras.find((c) => c.id === s?.camera))
  const mic = $derived(lists.mics.find((m) => m.id === s?.mic))
  /** "FaceTime HD Camera" reads "FaceTime HD" next to a camera icon. Menus keep the full name. */
  const short = (name: string) => name.replace(/\s+(camera|microphone|mic)$/i, '')
  const refresh = () => inputs().then((x) => (lists = x))

  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  /** A value on a spring (the engine's closed form). A new target mid-glide keeps its velocity, so a
   *  sweep across the bar reads as one motion. */
  class Glide {
    current = $state(0)
    velocity = $state(0) // units per second
    moving = false
    #from = 0
    #to = 0
    #v0 = 0
    #t0 = 0
    #spring: SpringConfig
    constructor(spring: SpringConfig) {
      this.#spring = spring
    }
    #at = (now: number) => this.#from + (this.#to - this.#from) * springProgress((now - this.#t0) / 1000, this.#spring, this.#v0)
    set(to: number, instant: boolean) {
      const now = performance.now()
      const p = this.moving ? this.#at(now) : this.current
      if (instant || (!this.moving && Math.abs(to - p) < 0.5)) {
        this.moving = false
        this.current = to
        this.velocity = 0
        return
      }
      const v = this.moving ? (this.#at(now + 1) - p) * 1000 : 0
      ;[this.#from, this.#to, this.#v0, this.#t0] = [p, to, v / (to - p || 1e-6), now]
      if (this.moving) return
      this.moving = true
      const tick = (t: number) => {
        if (!this.moving) return
        const now = Math.max(t, this.#t0)
        const next = this.#at(now)
        const v = (this.#at(now + 1) - next) * 1000
        this.moving = Math.abs(this.#to - next) > 0.05 || Math.abs(v) > 5
        this.current = this.moving ? next : this.#to
        this.velocity = this.moving ? v : 0
        if (this.moving) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }
  // Every button's box is 52 px tall, 6 px inside the bar. A bubble keeps 2 px in from its sides, so
  // one beside the locked bubble stays its own drop instead of joining it into one slab.
  const BOX = { top: 6, height: 52, side: 2 }
  let pointer: { x: number; y: number } | null = null
  /** A highlight under a button that flows to the next one like a drop of liquid: it stretches
   *  behind as it speeds up, thins as it stretches, and settles with a little give. The hover one
   *  also leans toward the pointer. */
  class Pill {
    el = $state<HTMLElement | null>(null)
    x: Glide // center
    w: Glide
    y: Glide // lean
    #magnetic: boolean
    constructor(spring: SpringConfig, magnetic: boolean) {
      this.x = new Glide(spring)
      this.w = new Glide(spring)
      this.y = new Glide(spring)
      this.#magnetic = magnetic
    }
    /** Flow to `el`; it jumps there when it comes from nowhere. `layout`: the buttons moved, and at
     *  rest it follows them exactly. */
    to(el: HTMLElement | null, layout = false) {
      const from = this.el
      this.el = el
      if (!el?.isConnected) return
      const r = el.getBoundingClientRect()
      const cx = r.left - el.parentElement!.getBoundingClientRect().left + r.width / 2
      const lean = (d: number, k: number, max: number) => Math.max(-max, Math.min(max, d * k))
      const pull = this.#magnetic && pointer ? { x: lean(pointer.x - cx, 0.12, 5), y: lean(pointer.y - BOX.top - BOX.height / 2, 0.15, 2.5) } : { x: 0, y: 0 }
      const instant = !from || reduced.matches || (layout && !this.x.moving && !this.w.moving && !this.y.moving)
      this.x.set(cx + pull.x, instant)
      this.w.set(r.width - 2 * BOX.side, instant)
      this.y.set(pull.y, instant)
    }
    /** The drawn box: longer and thinner with speed, the stretch trailing behind the center, and
     *  its corners rounding off into a round head and a long tail. At rest, the button's box. */
    get box() {
      const v = this.x.velocity
      const flow = 1 - Math.exp(-Math.abs(v) / 1200) // 0 at rest, easing toward 1 with speed
      const stretch = 40 * flow
      const height = BOX.height - 9 * flow
      const head = 6 + (height / 2 - 6) * flow
      const tail = head + stretch * 0.8 * flow
      const [l, r] = v > 0 ? [tail, head] : [head, tail]
      return {
        left: this.x.current - this.w.current / 2 - (v > 0 ? stretch : 0),
        top: BOX.top + (BOX.height - height) / 2 + this.y.current,
        width: this.w.current + stretch,
        height,
        radius: `${l}px ${r}px ${r}px ${l}px / ${head}px`,
      }
    }
  }
  // Unhurried, with a little give as it settles (damping ratio 0.85, 0.6% past): a response of
  // 0.35 s for hover and 0.42 s for the chosen mode, 95% of the way in about 210 ms and 250 ms.
  const hover = new Pill({ stiffness: 322, damping: 30.5, mass: 1 }, true)
  const chosen = new Pill({ stiffness: 224, damping: 25.4, mass: 1 }, false)
  let modeEls = $state<Partial<Record<Mode, HTMLElement>>>({})
  $effect(() => {
    const el = (shell.mode && modeEls[shell.mode]) || null
    untrack(() => chosen.to(el))
  })
  // Out of a button (the drag region between groups reads as out of the window): the highlight
  // waits a moment, so crossing a separator flows on instead of popping in again.
  let linger: ReturnType<typeof setTimeout> | undefined
  const leave = () => {
    clearTimeout(linger)
    linger = setTimeout(() => hover.to(null), 90)
  }
  function over(e: PointerEvent) {
    const target = (e.target as Element).closest<HTMLElement>('.close, .mode, .pick, .gear')
    if (!target) return leave()
    clearTimeout(linger)
    hover.to(target)
  }
  function move(e: PointerEvent) {
    pointer = { x: e.clientX, y: e.clientY } // the bar fills the window
    if (hover.el) hover.to(hover.el)
  }
  // Labels glide to their new width, which moves the buttons beside them: the highlights follow.
  const relayout = new ResizeObserver(() => {
    hover.to(hover.el, true)
    chosen.to(chosen.el, true)
  })
  const follow = (el: HTMLElement) => {
    relayout.observe(el)
    return () => relayout.unobserve(el)
  }
  /** The label box takes its text's width; CSS glides it there. */
  function fit(text: HTMLElement) {
    const box = text.parentElement!
    const ro = new ResizeObserver(([e]) => (box.style.width = `${Math.ceil(e.borderBoxSize[0].inlineSize)}px`))
    ro.observe(text)
    return () => ro.disconnect()
  }
  const SWAP = { amount: 2, duration: 200 }

  // Devices come and go (USB, Continuity): refresh when the picker opens and on every plug.
  $effect(() => {
    if (shell.picking || params.has('preview')) refresh()
  })
  // Live level of the chosen microphone while the picker is on screen. Keyed by id: a list refresh
  // yields a new but equal mic, which must not reopen it.
  const micId = $derived(mic?.id)
  $effect(() => {
    level = 0
    if (!(shell.picking || params.has('preview')) || !micId) return
    invoke('recording:micMonitor', micId).catch(() => {})
    return () => invoke('recording:micMonitorStop').catch(() => {})
  })

  onMount(() => {
    const offs = [
      on('recording:micLevel', (l: { peak?: number }) => (level = meterLevel(Number(l?.peak) || 0))),
      on('camera:devices', refresh),
      on('recording:error', (message: string) => invoke('shell:fail', message)),
      on('recording:warning', (w: { message?: string }) => w?.message && invoke('shell:warn', w.message)),
      on('shell:do', run),
      on('shell:escape', () => (countdown = null)),
    ]
    return () => offs.forEach((off) => off())
  })

  /** Commands from the shell (overlays, widget, shortcuts, tray, URLs, quit prompt). */
  async function run(cmd: string, req?: StartRequest) {
    try {
      if (cmd === 'start' && req) {
        // A device unplugged since it was picked records as "none", not as an error.
        const present = (list: Device[], id?: string) => (id && list.some((d) => d.id === id) ? id : undefined)
        await refresh()
        await invoke('recording:start', { ...req, cameraId: present(lists.cameras, req.cameraId), micId: present(lists.mics, req.micId) })
      } else if (cmd === 'toggle-pause') await invoke(shell.status === 'paused' ? 'recording:resume' : 'recording:pause')
      else if (cmd !== 'start') await invoke(`recording:${cmd}`)
    } catch (e) {
      invoke('shell:fail', e instanceof Error ? e.message : String(e))
    }
  }

  function choose(m: Mode, el: HTMLElement) {
    if (m === 'device') return pickDevice(el)
    invoke('shell:pick', shell.mode === m ? null : m)
  }

  async function pickDevice(el: HTMLElement) {
    invoke('shell:pick', 'device')
    const items: MenuItem[] = lists.devices.length
      ? lists.devices.map((d) => ({ id: d.id, label: d.name }))
      : [
          { label: 'No iPhone or iPad connected', enabled: false },
          { label: 'Connect one with a cable and unlock it', enabled: false },
        ]
    const id = await popup(items, el)
    const device = lists.devices.find((d) => d.id === id)
    if (!device) return invoke('shell:pick', null)
    record(device.name, { kind: 'device', deviceId: device.id })
  }

  /** Right-click on Window: the recordable windows as a list, for one that is hidden or hard to point at. */
  async function pickWindow(el: HTMLElement) {
    const list = await windowList()
    const label = (w: WindowSource) => (w.title ? `${w.app} - ${w.title.length > 60 ? `${w.title.slice(0, 59)}…` : w.title}` : w.app)
    const id = await popup(list.length ? list.map((w) => ({ id: String(w.id), label: label(w) })) : [{ label: 'No windows to record', enabled: false }], el)
    const win = list.find((w) => String(w.id) === id)
    if (!win) return
    invoke('shell:pick', null)
    record(win.app, { kind: 'window', windowId: win.id })
  }

  /** Record a target picked from a menu: the countdown runs here, on the toolbar. */
  async function record(name: string, target: Target) {
    if (s?.countdown) {
      hover.to(null) // its button goes with the countdown
      countdown = { n: 3, name }
      const mine = countdown // canceled, or replaced by a newer countdown: this one stops
      while (countdown === mine && mine.n > 0) {
        await new Promise((r) => setTimeout(r, 1000))
        if (countdown === mine) mine.n--
      }
      if (countdown !== mine) return
      countdown = null
    }
    invoke('shell:start', startRequest(target)) // the shell keeps the target (the pen's display)
  }

  async function pickInput(kind: 'camera' | 'mic', el: HTMLElement) {
    const list = kind === 'camera' ? lists.cameras : lists.mics
    const current = kind === 'camera' ? camera : mic
    const none = kind === 'camera' ? 'No camera' : 'No microphone'
    const id = await popup(
      [
        { id: 'none', label: none, checked: !current },
        { separator: true },
        ...(list.length ? list.map((d) => ({ id: d.id, label: d.name, checked: d.id === current?.id })) : [{ label: kind === 'camera' ? 'No cameras found' : 'No microphones found', enabled: false }]),
        ...(kind === 'camera' && current ? [{ separator: true }, { id: 'preview', label: 'Show Camera Preview', checked: !!s?.showCamera }] : []),
      ],
      el,
    )
    if (!id) return
    if (id === 'preview') return setSettings({ showCamera: !s?.showCamera })
    if (id === 'none') return setSettings({ [kind]: null })
    // Just in time: the system prompt (or System Settings) appears when the user picks a device.
    if (await ensurePermission(kind === 'camera' ? 'camera' : 'microphone')) setSettings({ [kind]: id })
  }

  async function openSettings(el: HTMLElement) {
    if (!s) return
    const toggles: Array<[keyof Settings, string]> = [
      ['countdown', 'Countdown Before Recording'],
      ['showWidget', 'Show Recording Controls'],
      ['speakerNotes', 'Show Speaker Notes'],
      ['hideDesktopIcons', 'Hide Desktop Icons'],
      ['autoZoom', 'Auto Zoom'],
    ]
    const captures: MenuItem[] = await invoke('shell:captures').catch(() => [])
    const id = await popup(
      [
        ...toggles.map(([id, label]) => ({ id, label, checked: !!s[id] })),
        { separator: true },
        { label: 'Recent Captures', enabled: captures.length > 0, submenu: captures },
        { id: 'open', label: 'Open Project…' },
        { id: 'settings', label: 'Settings…' },
      ],
      el,
    )
    if (captures.some((c) => c.id === id)) invoke('shell:reopen', id)
    else if (id === 'open') invoke('shell:open-project')
    else if (id === 'settings') invoke('shell:open-settings')
    else if (id) setSettings({ [id]: !s[id as keyof Settings] })
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return
    if (countdown) countdown = null
    else if (shell.update) invoke('update:later')
    else invoke('shell:close-picker')
  }}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => dropFiles(e).catch((err: Error) => invoke('shell:warn', err.message))}
/>

{#snippet pill(b: Pill['box'], on: boolean)}
  <span class="pill" class:on style:translate="{b.left}px {b.top}px" style:width="{b.width}px" style:height="{b.height}px" style:border-radius={b.radius}></span>
{/snippet}
{#snippet label(text: string)}
  <span class="label">{#key text}<span class="text" in:blur={SWAP} {@attach fit}>{text}</span>{/key}</span>
{/snippet}

<main class="bar hud" inert={!!shell.update} onpointerover={over} onpointermove={move} onpointerleave={leave}>
  {#if countdown}
    <div class="countdown" role="status">
      <span class="n">{countdown.n}</span>
      <span>Recording {countdown.name}…</span>
      <button class="action" onclick={() => (countdown = null)}>Cancel</button>
    </div>
  {:else}
    {@const c = chosen.box}
    {@const h = hover.box}
    <!-- One veil for both: the chosen mode is the hover bubble locked in place, and where the two meet
         they merge like drops instead of adding up to a glare. -->
    <span class="veil">{@render pill(c, !!chosen.el)}{@render pill(h, !!hover.el)}</span>
    <button class="close" aria-label="Close" onclick={() => invoke('shell:close-picker')}><span class="circle"><Icon name="close" size={22} stroke={2.4} /></span></button>
    <span class="sep"></span>
    {#each MODES as m (m.id)}
      <button
        bind:this={modeEls[m.id]}
        class="mode"
        class:on={shell.mode === m.id}
        aria-pressed={shell.mode === m.id}
        onclick={(e) => choose(m.id, e.currentTarget)}
        oncontextmenu={(e) => m.id === 'window' && pickWindow(e.currentTarget)}
      >
        <span class="icon"><Icon name={m.id} width={m.w} height={m.h} /></span>
        <span class="name">{m.label}</span>
      </button>
    {/each}
    <span class="sep"></span>
    <button class="pick camera" class:off={!camera} onclick={(e) => pickInput('camera', e.currentTarget)} {@attach follow}>
      {#key !camera}<span class="glyph" in:blur={SWAP}><Icon name={camera ? 'camera' : 'camera-off'} size={21} stroke={1.75} /></span>{/key}
      {@render label(camera ? short(camera.name) : 'No camera')}
    </button>
    <button class="pick mic" class:off={!mic} onclick={(e) => pickInput('mic', e.currentTarget)} {@attach follow}>
      {#key !mic}<span class="glyph" in:blur={SWAP}><Icon name={mic ? 'mic' : 'mic-off'} width={12} height={17} stroke={1.5} /></span>{/key}
      {@render label(mic ? short(mic.name) : 'No microphone')}
      {#if mic}<span class="meter" aria-hidden="true" transition:fade={{ duration: 150 }}><span style:width="max(3px, {level * 100}%)"></span></span>{/if}
    </button>
    <button class="pick system" class:off={!s?.systemAudio} aria-pressed={!!s?.systemAudio} onclick={() => setSettings({ systemAudio: !s?.systemAudio })} {@attach follow}>
      {#key !s?.systemAudio}<span class="glyph" in:blur={SWAP}><Icon name={s?.systemAudio ? 'speaker' : 'speaker-off'} width={20} height={16} stroke={1.5} /></span>{/key}
      {@render label(s?.systemAudio ? 'Record system audio' : 'No system audio')}
    </button>
    <span class="sep"></span>
    <button class="gear" aria-label="Recording settings" onclick={(e) => openSettings(e.currentTarget)}>
      <Icon name="gear" size={18} />
      <Icon name="chevron" width={11} height={6.6} stroke={1.5} />
    </button>
  {/if}
</main>
{#if shell.update}
  <div class="update hud" role="status" transition:fade={{ duration: 150 }}>
    <span class="note">Grip {shell.update} is ready to install.</span>
    <button class="action" onclick={() => invoke('update:later')}>Later</button>
    <button class="action primary" onclick={() => invoke('update:restart')}>Restart to Update</button>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 10px; /* the end buttons' boxes; the close circle starts 20 px in, like the gear's chevron ends */
    border-radius: var(--radius-lg);
    background: var(--surface-50);
    box-shadow: var(--hairline);
    color: var(--text);
    -webkit-app-region: drag;
  }
  button {
    -webkit-app-region: no-drag;
    background: none;
    border: 0;
    padding: 0;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm); /* concentric: 6 px inside the 12 px bar */
    transition:
      background-color 120ms,
      color 120ms;
  }
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .close {
    width: 43px;
    height: 52px;
    justify-content: center;
  }
  .circle {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    transition: background-color 120ms;
  }
  .close:hover .circle {
    background: var(--accent-hover);
  }
  /* Every hover box is 52 px tall, 6 px inside the bar, and the camera, microphone, and system audio
     boxes touch: the highlight moves along one track from button to button without dropping out. */
  .sep {
    width: 0.5px;
    height: 44px;
    margin: 1px 6.25px 0;
    background: var(--edge-strong);
  }
  .close {
    margin-right: 1.5px;
  }
  .mode {
    width: 60px;
    height: 52px;
    flex-direction: column;
    justify-content: flex-start;
    padding-top: 6.75px;
    gap: 4.15px;
    color: var(--text);
  }
  /* Icons of different heights share one centered box, so the labels line up. */
  .mode .icon {
    display: grid;
    place-items: center;
    height: 24px;
  }
  .mode .name {
    font-size: 10.3px;
    line-height: 13px;
    color: var(--text-dim);
  }
  /* The hover and chosen-mode bubbles, under the buttons' content (the fixed bar is a stacking
     context). The veil draws both as solid shapes and fades their union to the hover veil's 7%
     (--surface-50-hover). */
  .veil {
    position: absolute;
    inset: 0;
    z-index: -1;
    opacity: 0.07;
    pointer-events: none;
  }
  .pill {
    position: absolute;
    left: 0;
    top: 0;
    background: #fff;
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease;
  }
  .pill.on {
    opacity: 1;
  }
  .mode.on .name {
    color: var(--text);
  }
  /* The three share the room between the separators, content centered: equal padding on both sides
     of every box, whatever the device names. */
  .pick {
    position: relative;
    flex: auto;
    height: 52px;
    justify-content: center;
    gap: 10px;
    padding: 1.5px 12px 0;
    font-size: 13.2px;
    color: var(--text);
  }
  .pick.off {
    color: var(--text-faint);
  }
  .glyph {
    display: flex;
  }
  .label {
    overflow: hidden;
    transition: width 280ms var(--ease-out);
  }
  .text {
    display: block;
    width: max-content;
    white-space: nowrap;
  }
  .camera {
    gap: 8.5px;
  }
  /* Long device names truncate here, so the toolbar always fits and nothing else shrinks. */
  .camera .text,
  .mic .text {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mic :global(svg) {
    margin-top: -2.5px;
  }
  .system :global(svg) {
    margin-top: -1px;
  }
  /* Level of the chosen microphone: a faint track under it, the level a dot at silence. */
  .meter {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 42.5px;
    height: 3px;
    border-radius: 1.5px;
    background: var(--surface-25);
  }
  .meter span {
    display: block;
    height: 3px;
    border-radius: 1.5px;
    background: var(--text-dim);
    transition: width 60ms linear;
  }
  .gear {
    height: 52px;
    padding: 0 10px;
    gap: 6.5px;
    color: var(--text-dim);
  }
  .gear :global(svg + svg) {
    margin-top: 2px;
  }
  .countdown {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-size: 14px;
  }
  .countdown .n {
    font-size: 30px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    width: 24px;
    text-align: center;
  }
  /* Over the toolbar, which shows through dimmed. */
  .update {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--radius-lg);
    background: rgb(20 20 22 / 0.78);
    box-shadow: var(--hairline);
    backdrop-filter: blur(2px);
    -webkit-app-region: drag;
  }
  .note {
    margin-right: 6px;
    font-size: 13px;
  }
  .action {
    -webkit-app-region: no-drag;
    height: 26px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font-size: 13px;
  }
  .action:hover {
    background: var(--surface-100-hover);
  }
  .action.primary {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 500;
  }
  .action.primary:hover {
    background: var(--accent-hover);
  }
</style>
