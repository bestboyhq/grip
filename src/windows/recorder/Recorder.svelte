<!-- Recording toolbar, bottom center of the active display: close, Display / Window / Area / Device,
     camera, microphone with a live level, system audio, settings. A downloaded update veils it until
     the user restarts or puts it off (Later, Esc) for that version.
     It is also the session controller (electron/shell/recorder.ts): it runs the shell's commands
     against the capture engine and reports the engine's errors and warnings to the shell. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { dropFiles, invoke, on } from '../../lib/ipc.ts'
  import Icon from './Icon.svelte'
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
  let later = $state('') // the update version put off: the toolbar is back until a newer one
  const update = $derived(shell.update !== later ? shell.update : '')

  const s = $derived(shell.settings)
  const camera = $derived(lists.cameras.find((c) => c.id === s?.camera))
  const mic = $derived(lists.mics.find((m) => m.id === s?.mic))
  /** "FaceTime HD Camera" reads "FaceTime HD" next to a camera icon. Menus keep the full name. */
  const short = (name: string) => name.replace(/\s+(camera|microphone|mic)$/i, '')
  const refresh = () => inputs().then((x) => (lists = x))

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
    ]
    const id = await popup(
      [...toggles.map(([id, label]) => ({ id, label, checked: !!s[id] })), { separator: true }, { id: 'open', label: 'Open Project…' }, { id: 'settings', label: 'Settings…' }],
      el,
    )
    if (id === 'open') invoke('shell:open-project')
    else if (id === 'settings') invoke('shell:open-settings')
    else if (id) setSettings({ [id]: !s[id as keyof Settings] })
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return
    if (countdown) countdown = null
    else if (update) later = update
    else invoke('shell:close-picker')
  }}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => dropFiles(e).catch((err: Error) => invoke('shell:warn', err.message))}
/>

<main class="bar hud" inert={!!update}>
  {#if countdown}
    <div class="countdown" role="status">
      <span class="n">{countdown.n}</span>
      <span>Recording {countdown.name}…</span>
      <button class="action" onclick={() => (countdown = null)}>Cancel</button>
    </div>
  {:else}
    <button class="close" aria-label="Close" onclick={() => invoke('shell:close-picker')}><Icon name="close" size={22} stroke={2.4} /></button>
    <span class="sep"></span>
    {#each MODES as m (m.id)}
      <button
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
    <button class="pick camera" class:off={!camera} onclick={(e) => pickInput('camera', e.currentTarget)}>
      <Icon name={camera ? 'camera' : 'camera-off'} size={21} stroke={1.75} />
      <span class="label">{camera ? short(camera.name) : 'No camera'}</span>
    </button>
    <button class="pick mic" class:off={!mic} onclick={(e) => pickInput('mic', e.currentTarget)}>
      <Icon name={mic ? 'mic' : 'mic-off'} width={12} height={17} stroke={1.5} />
      <span class="label">{mic ? short(mic.name) : 'No microphone'}</span>
      {#if mic}<span class="meter" aria-hidden="true"><span style:width="max(3px, {level * 100}%)"></span></span>{/if}
    </button>
    <button class="pick system" class:off={!s?.systemAudio} aria-pressed={!!s?.systemAudio} onclick={() => setSettings({ systemAudio: !s?.systemAudio })}>
      <Icon name={s?.systemAudio ? 'speaker' : 'speaker-off'} width={20} height={16} stroke={1.5} />
      <span class="label">{s?.systemAudio ? 'Record system audio' : 'No system audio'}</span>
    </button>
    <span class="sep"></span>
    <button class="gear" aria-label="Recording settings" onclick={(e) => openSettings(e.currentTarget)}>
      <Icon name="gear" size={18} />
      <Icon name="chevron" width={11} height={6.6} stroke={1.5} />
    </button>
  {/if}
</main>
{#if update}
  <div class="update hud" role="status" transition:fade={{ duration: 150 }}>
    <span class="note">Grip {update} is ready to install.</span>
    <button class="action" onclick={() => (later = update)}>Later</button>
    <button class="action primary" onclick={() => invoke('update:restart')}>Restart to Update</button>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 10px 0 20px; /* the gear's chevron ends 20 px from the edge, like the close button starts */
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
    width: 22px;
    height: 22px;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .close:hover {
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
    margin: 0 12px 0 0.5px;
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
  .mode:hover,
  .pick:hover,
  .gear:hover {
    background: var(--surface-50-hover);
  }
  .mode:active,
  .mode.on {
    background: var(--surface-50-selected);
    box-shadow: var(--hairline);
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
  .label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .camera {
    gap: 8.5px;
  }
  /* Long device names truncate here, so the toolbar always fits and nothing else shrinks. */
  .camera .label,
  .mic .label {
    max-width: 100px;
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
    padding-right: 10px; /* centered in the bar, whose padding is 20 left, 10 right */
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
