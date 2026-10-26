<!-- Onboarding and settings (#/onboarding?page=welcome|permissions|shortcut|settings[&need=<permission>]).
     Welcome, then permissions: each with a one-line reason, live status, a request button that
     shows the system prompt the first time and System Settings after that, and a way back from a
     revoked permission (`need`). Then the offer of macOS's screenshot keys (⇧⌘5) for recording. Settings puts recording options and shortcuts first, then the same
     permission list with every allowed one folded into a single row. Each recording option plays on a
     small desktop beside the list while it is pointed at or focused. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { invoke, on } from '../../lib/ipc.ts'
  import Icon, { type IconName } from '../recorder/Icon.svelte'
  import { ensurePermission, setSettings, shell, type Permission, type PermissionStatus, type Settings } from '../recorder/shell.svelte.ts'
  import appIcon from '../../../build/icon.png'
  import { acceleratorOf, symbols, type Press } from '../../shared/shortcut.ts'
  import SettingPreview from './SettingPreview.svelte'

  let { params }: { params: URLSearchParams } = $props()

  const ROWS: Array<{ id: Permission; title: string; reason: string; icon: IconName; required?: boolean }> = [
    { id: 'screen', title: 'Screen Recording', reason: 'Records your screen and the sound your Mac plays.', icon: 'screen', required: true },
    { id: 'accessibility', title: 'Accessibility', reason: 'Shows your keystrokes, and fits the window you record to size.', icon: 'accessibility' },
    { id: 'microphone', title: 'Microphone', reason: 'Records your voice.', icon: 'mic' },
    { id: 'camera', title: 'Camera', reason: 'Records you in a bubble next to your screen.', icon: 'camera' },
  ]
  const NEED: Record<Permission, string> = {
    screen: 'Screen recording is turned off for Grip, so it can’t record. Turn it back on below.',
    accessibility: 'Accessibility is turned off for Grip, so your keystrokes won’t show. Turn it back on below.',
    microphone: 'The microphone is turned off for Grip. Turn it back on below.',
    camera: 'The camera is turned off for Grip. Turn it back on below.',
  }
  const TOGGLES: Array<[keyof Settings, string, string]> = [
    ['countdown', 'Countdown', '3, 2, 1 before the recording starts.'],
    ['showWidget', 'Recording controls', 'A small timer with pause, restart, finish, and delete.'],
    ['showCamera', 'Camera preview', 'Your camera in a bubble while you record.'],
    ['speakerNotes', 'Speaker notes', 'A prompter only you can see while you record.'],
    ['hideDesktopIcons', 'Hide desktop icons', 'Keeps a busy desktop out of your recordings.'],
    ['autoZoom', 'Auto zoom', 'New recordings zoom in where you click and type.'],
  ]
  let previewed = $state(0) // the recording option the preview plays: the last one pointed at or focused
  const SHORTCUTS = [
    ['Pause or resume', '⌥⇧⌘P'],
    ['Delete recording', '⌥⇧⌘⌫'],
    ['Start or stop the prompter', '⌥⌘.'],
  ]

  // The route is fixed for the window's life: read it once.
  const query = untrack(() => Object.fromEntries(params))
  let page = $state(query.page ?? 'welcome')
  const need = (query.need ?? null) as Permission | null
  // From the capture engine; rows it does not report are not shown.
  let status = $state<Partial<Record<Permission, PermissionStatus>> | null>(null)
  let asked = $state<Permission[]>([]) // requested this session
  const screenOk = $derived(status?.screen === 'granted')
  // Screen Recording turned on while this window is open: macOS applies it only after a relaunch.
  let screenWas: PermissionStatus | undefined
  const screenNew = $derived(screenOk && screenWas !== undefined && screenWas !== 'granted' && need !== 'screen') // the banner says it then
  const shown = $derived(ROWS.filter((r) => status?.[r.id]))
  // Settings folds what is allowed, with nothing more to say, into one row: only what needs the user keeps a full row.
  const folded = $derived(page === 'settings' ? shown.filter((r) => status?.[r.id] === 'granted' && !(r.id === 'screen' && screenNew)) : [])

  // Live status: permissions change in System Settings, not here.
  onMount(() => {
    const poll = () =>
      invoke('recording:permissions').then(
        (s) => ((screenWas ??= s?.screen), (status = s)),
        () => (status = {}),
      )
    poll()
    const t = setInterval(poll, 1000)
    return () => clearInterval(t)
  })

  async function request(p: Permission) {
    asked = [...asked, p]
    if (await ensurePermission(p)) status = { ...status, [p]: 'granted' }
  }

  // The record shortcut is the user's: click it, type a new one (Esc keeps the old one).
  let typingKeys = $state(false)
  let keysNote = $state('') // why the last one typed can't be used
  const recordKeys = $derived(symbols(shell.settings?.recordShortcut ?? '') ?? '')

  function listen() {
    if (typingKeys) return
    typingKeys = true
    keysNote = ''
    invoke('shell:shortcut', null) // pressing the current one records it, not opens the picker
  }
  function stopListening() {
    if (!typingKeys) return
    typingKeys = false
    keysNote = ''
    invoke('shell:shortcut', shell.settings?.recordShortcut)
  }
  function typeKeys(e: KeyboardEvent) {
    if (!typingKeys || (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey)) return // Tab moves on
    e.preventDefault()
    if (e.key === 'Escape') return stopListening()
    typed(e)
  }
  // Presses with ⌘ or ⌃ come from Grip instead of the page: Chromium keeps the ones macOS reserves from it.
  onMount(() => on('shell:typed', typed))
  async function typed(press: Press) {
    if (!typingKeys) return
    const keys = acceleratorOf(press)
    if (keys === '') return // only modifiers so far
    if (!keys) return void (keysNote = 'Use ⌘ or ⌃ with another modifier, like ⌥⌘ or ⇧⌘.')
    typingKeys = false
    use(keys)
  }
  // macOS's own screenshot and recording keys, one switch away: most people already reach for them.
  // Off goes back to Grip's default.
  const MACOS_KEYS = 'Shift+Command+5'
  const DEFAULT_KEYS = 'Alt+Command+Return'
  let taken = $state(false) // onboarding offered ⇧⌘5 and another app has it
  async function use(keys: string) {
    const ok = await invoke('shell:shortcut', keys)
    keysNote = !ok ? `Another app uses ${symbols(keys)}. Try another.` : ok === 'macos' ? `Grip takes ${symbols(keys)} over from macOS until you quit Grip.` : ''
    return ok
  }
</script>

{#snippet needBanner()}
  {#if need && status}
    {#if status[need] !== 'granted'}
      <div class="banner" role="alert">{NEED[need]}</div>
    {:else if need === 'screen'}
      <!-- Allowed, yet recording was refused: macOS applies a new grant only after a relaunch, and
           can keep a stale one after an update. -->
      <div class="banner" role="alert">
        Screen Recording is on for Grip, but macOS refused to record. <button class="link" onclick={() => invoke('shell:relaunch')}>Restart Grip</button>
        to apply it. Still refused? Turn Grip off and on again in
        <button class="link" onclick={() => invoke('recording:openPermissionSettings', 'screen')}>System Settings</button>.
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet permissionList()}
  <ul class="rows">
    {#each shown.filter((r) => !folded.includes(r)) as row (row.id)}
      {@const s = status?.[row.id]}
      <li class:need={need === row.id && s !== 'granted'}>
        <span class="tile"><Icon name={row.icon} size={20} /></span>
        <div class="text">
          <div class="title">{row.title}{#if row.required}<span class="tag">Required</span>{/if}</div>
          <div class="reason">{row.reason}</div>
          {#if row.id === 'screen' && (screenNew || (s !== 'granted' && asked.includes('screen')))}
            <div class="reason">
              {screenNew ? 'macOS applies it after a restart.' : 'Turned it on? macOS applies it after a restart.'}
              <button class="link" onclick={() => invoke('shell:relaunch')}>Restart Grip</button>
            </div>
          {/if}
        </div>
        {#if s === 'granted'}
          <span class="ok"><Icon name="check" size={15} stroke={2.2} />Allowed</span>
        {:else if s === 'restricted'}
          <span class="reason">Set by your organization</span>
        {:else if s}
          <button class="button" aria-label="{s === 'notDetermined' ? 'Allow' : 'Open System Settings for'} {row.title}" onclick={() => request(row.id)}
            >{s === 'notDetermined' ? 'Allow' : 'Open System Settings'}</button
          >
        {/if}
      </li>
    {/each}
    {#if folded.length}
      <li>
        <span class="stack">{#each folded as row (row.id)}<span><Icon name={row.icon} size={15} /></span>{/each}</span>
        <div class="text">
          <div class="title">{folded.length === shown.length ? 'All permissions allowed' : `${folded.length} more allowed`}</div>
          <div class="reason">{folded.map((r) => r.title).join(', ')}</div>
        </div>
      </li>
    {/if}
  </ul>
{/snippet}

<main class="window">
  <div class="titlebar">{#if page === 'settings'}<span class="name">Settings</span>{/if}</div>
  {#if page === 'welcome'}
    <section class="welcome">
      <img src={appIcon} alt="" width="128" height="128" />
      <h1>Welcome to Grip</h1>
      <p>Record your screen and get a polished video, with zooms, a smooth cursor, and captions done for you.</p>
      <button class="button primary" onclick={() => ((page = 'permissions'), setSettings({ welcomed: true }))}>Get Started</button>
    </section>
  {:else if page === 'permissions'}
    <section class="body">
      <h2>Allow access</h2>
      <p class="lead">Grip needs to see your screen to record it. The rest is up to you.</p>
      {@render needBanner()}
      {@render permissionList()}
    </section>
    <footer>
      <span>{#if !screenOk}<button class="link" onclick={() => (page = 'shortcut')}>Skip for now</button>{/if}</span>
      <button class="button primary" disabled={!screenOk} onclick={() => (page = 'shortcut')}>Continue</button>
    </footer>
  {:else if page === 'shortcut'}
    <!-- Most people already reach for macOS's screenshot keys: offer them once, the same switch Settings has. -->
    <section class="welcome">
      <div class="caps" aria-hidden="true"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>5</kbd></div>
      <h1>Record with ⇧⌘5</h1>
      <p>The keys you use for screenshots open Grip instead of macOS’s screenshot toolbar. macOS gets them back when you quit Grip.</p>
      <button class="button primary" onclick={async () => ((await use(MACOS_KEYS)) ? invoke('shell:finish-onboarding') : (taken = true))}>Use ⇧⌘5</button>
      {#if taken}<p class="after taken" role="alert">Another app uses ⇧⌘5.</p>{/if}
      <p class="after"><button class="link" onclick={() => invoke('shell:finish-onboarding')}>Keep {recordKeys}</button> · Change it any time in Settings</p>
    </section>
  {:else}
    <section class="body scroll">
      {@render needBanner()}
      <h3>Recording</h3>
      <div class="recording">
        <ul class="rows compact">
          {#each TOGGLES as [key, title, reason], i (key)}
            <li class:current={i === previewed} onpointerenter={() => (previewed = i)} onfocusin={() => (previewed = i)}>
              <label>
                {title}
                <input type="checkbox" role="switch" aria-describedby="why-{key}" checked={!!shell.settings?.[key]} onchange={(e) => setSettings({ [key]: e.currentTarget.checked })} />
              </label>
              <span id="why-{key}" hidden>{reason}</span>
            </li>
          {/each}
        </ul>
        <figure class="preview" aria-hidden="true">
          <SettingPreview kind={TOGGLES[previewed][0]} on={!!shell.settings?.[TOGGLES[previewed][0]]} />
          <figcaption>
            <div class="title">{TOGGLES[previewed][1]}</div>
            <div class="reason">{TOGGLES[previewed][2]}</div>
          </figcaption>
        </figure>
      </div>
      <h3>Keyboard shortcuts</h3>
      <ul class="rows compact">
        <li>
          <div class="text">
            <div class="title">New recording, or finish</div>
            <!-- macOS's own shortcuts reach this field while it listens, with Accessibility on; Grip turns off the one it takes. -->
            <div class="reason" role="status">
              {keysNote ||
                (!typingKeys ? 'Works in any app. Click it to change it.'
                : status?.accessibility === 'granted' ? 'Press the new keys. macOS’s screenshot keys, like ⇧⌘5, work too.'
                : 'Press the new keys. To use macOS’s own, like ⇧⌘5, allow Accessibility below.')}
            </div>
          </div>
          <button class="keys" class:typing={typingKeys} aria-label="New recording shortcut: {recordKeys}. Change" title="Click to change" onclick={listen} onkeydown={typeKeys} onblur={stopListening}
            >{typingKeys ? 'Type a shortcut' : recordKeys}</button
          >
        </li>
        <li>
          <label class="switch">
            <span class="text">
              <span class="title">Record with ⇧⌘5</span>
              <span class="reason">Opens Grip instead of macOS’s screenshot toolbar.</span>
            </span>
            <input type="checkbox" role="switch" checked={shell.settings?.recordShortcut === MACOS_KEYS} onchange={(e) => use(e.currentTarget.checked ? MACOS_KEYS : DEFAULT_KEYS)} />
          </label>
        </li>
        {#each SHORTCUTS as [label, keys] (label)}
          <li>
            <div class="text"><div class="title">{label}</div></div>
            <kbd>{keys}</kbd>
          </li>
        {/each}
      </ul>
      <!-- Last: onboarding is where permissions come first, and an allowed one needs nothing here. -->
      <h3>Permissions</h3>
      {@render permissionList()}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    background: var(--surface-frame);
  }
  .window {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  /* The window drags by its title bar only: macOS gives a drag region's scroll wheel to the window,
     so a page that drags everywhere never scrolls. */
  .titlebar {
    position: absolute;
    inset: 0 0 auto;
    height: 40px;
    -webkit-app-region: drag;
  }
  /* The window's name, in line with the traffic lights (macOS centers them at y 18, ending at x 72). */
  .name {
    display: block;
    padding-left: 84px;
    font-size: 13px;
    font-weight: 600;
    line-height: 36px;
  }
  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0 80px 40px;
    text-align: center;
  }
  .welcome img {
    margin-bottom: 18px;
    filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.35));
  }
  h1 {
    margin: 0 0 10px;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .welcome p {
    margin: 0 0 30px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--fg-secondary);
  }
  .caps {
    display: flex;
    gap: 10px;
    margin-bottom: 28px;
  }
  .caps kbd {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: var(--radius-lg);
    box-shadow:
      var(--hairline),
      0 3px 0 var(--color-grey-950);
    font-size: 26px;
    font-weight: 500;
    letter-spacing: 0;
  }
  .welcome .after {
    margin: 16px 0 0;
    font-size: 12px;
  }
  .welcome .taken {
    color: var(--warm);
  }
  .body {
    flex: 1;
    margin-top: 36px; /* under the title bar: it scrolls where it shows */
    padding: 16px 40px 0;
    mask-image: linear-gradient(transparent, #000 16px); /* rows scroll away under a fade, not a cut */
    min-height: 0;
    overflow-y: auto; /* a banner and hints never push Continue off the window */
  }
  .scroll {
    overflow-y: auto;
    padding-bottom: 32px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.2px;
  }
  h3 {
    margin: 26px 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  h3:first-child {
    margin-top: 0;
  }
  .lead {
    margin: 0 0 22px;
    color: var(--fg-secondary);
    font-size: 13px;
  }
  .banner {
    margin: 14px -16px 16px; /* as wide as the list under it */
    padding: 10px 16px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--warm) 12%, transparent);
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--warm) 35%, transparent);
    color: var(--warm);
    font-size: 13px;
    line-height: 1.45;
  }
  .banner .link {
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .rows {
    margin: 0 -16px; /* bleeds by the row padding: icons and text line up with the heading */
    padding: 0;
    list-style: none;
    overflow: hidden; /* the need marker follows the corners */
    border-radius: var(--radius-lg);
    background: var(--surface-root);
    box-shadow: var(--hairline);
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    padding: 12px 16px;
  }
  .rows.compact li {
    min-height: 44px;
  }
  /* Recording: short rows, and beside them a preview of the one pointed at. The row is its label. */
  .recording {
    display: grid;
    grid-template-columns: 1fr 264px;
    gap: 12px;
    margin: 0 -16px;
  }
  .recording .rows {
    margin: 0;
  }
  .recording li {
    padding: 0;
  }
  .recording li.current {
    background: var(--surface-hover);
  }
  .switch {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 14px;
  }
  .switch .reason {
    display: block;
  }
  .recording label {
    display: flex;
    flex: 1;
    align-self: stretch;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    font-size: 13px;
    font-weight: 600;
  }
  .preview {
    margin: 0;
    padding: 6px; /* concentric: the stage's corners are the card's less this */
    border-radius: var(--radius-lg);
    background: var(--surface-root);
    box-shadow: var(--hairline);
  }
  figcaption {
    padding: 10px 6px 4px;
  }
  .rows li + li {
    box-shadow: var(--hairline-t);
  }
  .rows li.need {
    box-shadow: inset 3px 0 0 var(--warm);
  }
  .rows li + li.need {
    box-shadow: inset 3px 0 0 var(--warm), var(--hairline-t);
  }
  .tile {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    color: var(--fg-default);
  }
  /* The allowed permissions, overlapping like a stack of avatars. */
  .stack {
    display: flex;
    flex: none;
    padding-left: 8px;
  }
  .stack span {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    margin-left: -8px;
    border-radius: 50%;
    background: var(--surface-100);
    box-shadow:
      0 0 0 2px var(--surface-root),
      var(--hairline);
    color: var(--fg-default);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .tag {
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    background: var(--surface-150);
    color: var(--fg-default);
    font-size: 10.5px;
    font-weight: 600;
  }
  .reason {
    margin-top: 2px;
    font-size: 12px;
    color: var(--fg-secondary);
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--success);
    font-size: 13px;
    font-weight: 500;
  }
  .button {
    flex: none;
    height: 28px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font-size: 13px;
    font-weight: 500;
  }
  .button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .button.primary {
    height: 32px;
    padding: 0 20px;
    background: var(--surface-inverse);
    box-shadow: none;
    color: var(--fg-inverse);
  }
  .button.primary:hover:not(:disabled) {
    background: var(--surface-inverse-hover);
  }
  .button:disabled {
    opacity: 0.4;
  }
  .button:focus-visible,
  .link:focus-visible,
  .keys:focus-visible,
  .keys.typing,
  input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--fg-default);
    font-size: 12px;
    text-decoration: underline; /* same color as the text around it: the underline marks it */
    text-underline-offset: 2px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 40px 28px;
  }
  footer .link {
    font-size: 13px;
    color: var(--fg-secondary);
  }
  input[role='switch'] {
    appearance: none;
    flex: none;
    position: relative;
    width: 32px;
    height: 19px;
    margin: 0;
    border-radius: 10px;
    background: var(--surface-200);
    box-shadow: var(--hairline);
  }
  input[role='switch']::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--color-white);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 180ms var(--ease-out);
  }
  input[role='switch']:checked {
    background: var(--brand);
  }
  input[role='switch']:checked::after {
    transform: translateX(13px);
    background: var(--color-white);
  }
  kbd,
  .keys {
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font: 13px var(--font);
    letter-spacing: 1px;
  }
  /* The one shortcut to change: a key cap that takes a click. */
  .keys {
    flex: none;
    border: 0;
    color: var(--fg-default);
  }
  .keys:hover {
    background: var(--surface-hover);
  }
  .keys.typing {
    color: var(--fg-secondary);
    letter-spacing: 0;
  }
</style>
