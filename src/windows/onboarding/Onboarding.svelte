<!-- Onboarding and settings (#/onboarding?page=welcome|permissions|settings[&need=<permission>]).
     Welcome, then permissions: each with a one-line reason, live status, a request button that
     shows the system prompt the first time and System Settings after that, and a way back from a
     revoked permission (`need`). Settings reuses the permission list and adds recording options. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { invoke } from '../../lib/ipc.ts'
  import Icon, { type IconName } from '../recorder/Icon.svelte'
  import { ensurePermission, setSettings, shell, type Permission, type PermissionStatus, type Settings } from '../recorder/shell.svelte.ts'
  import appIcon from '../../../build/icon.png'

  let { params }: { params: URLSearchParams } = $props()

  const ROWS: Array<{ id: Permission; title: string; reason: string; icon: IconName; required?: boolean }> = [
    { id: 'screen', title: 'Screen Recording', reason: 'Records your screen and the sound your Mac plays.', icon: 'screen', required: true },
    { id: 'accessibility', title: 'Accessibility', reason: 'Shows your keystrokes, and fits the window you record to size.', icon: 'accessibility' },
    { id: 'inputMonitoring', title: 'Input Monitoring', reason: 'Lets Grip read the keys you press while you record.', icon: 'keyboard' },
    { id: 'microphone', title: 'Microphone', reason: 'Records your voice.', icon: 'mic' },
    { id: 'camera', title: 'Camera', reason: 'Records you in a bubble next to your screen.', icon: 'camera' },
  ]
  const NEED: Record<Permission, string> = {
    screen: 'Screen recording is turned off for Grip, so it can’t record. Turn it back on below.',
    accessibility: 'Accessibility is turned off for Grip, so your keystrokes won’t show. Turn it back on below.',
    inputMonitoring: 'Input Monitoring is turned off for Grip, so your keystrokes won’t show. Turn it back on below.',
    microphone: 'The microphone is turned off for Grip. Turn it back on below.',
    camera: 'The camera is turned off for Grip. Turn it back on below.',
  }
  const TOGGLES: Array<[keyof Settings, string, string]> = [
    ['countdown', 'Countdown', '3, 2, 1 before the recording starts.'],
    ['showWidget', 'Recording controls', 'A small timer with pause, restart, finish, and delete.'],
    ['showCamera', 'Camera preview', 'Your camera in a bubble while you record.'],
    ['speakerNotes', 'Speaker notes', 'A prompter only you can see while you record.'],
    ['hideDesktopIcons', 'Hide desktop icons', 'Keeps a busy desktop out of your recordings.'],
  ]
  const SHORTCUTS = [
    ['New recording, or finish', '⌥⌘↩'],
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
    {#each ROWS.filter((r) => status?.[r.id]) as row (row.id)}
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
  </ul>
{/snippet}

<main class="window">
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
      <span>{#if !screenOk}<button class="link" onclick={() => invoke('shell:finish-onboarding')}>Skip for now</button>{/if}</span>
      <button class="button primary" disabled={!screenOk} onclick={() => invoke('shell:finish-onboarding')}>Continue</button>
    </footer>
  {:else}
    <section class="body scroll">
      <h2>Settings</h2>
      {@render needBanner()}
      <h3>Permissions</h3>
      {@render permissionList()}
      <h3>Recording</h3>
      <ul class="rows">
        {#each TOGGLES as [key, title, reason] (key)}
          <li>
            <div class="text">
              <div class="title">{title}</div>
              <div class="reason">{reason}</div>
            </div>
            <input type="checkbox" role="switch" aria-label={title} checked={!!shell.settings?.[key]} onchange={(e) => setSettings({ [key]: e.currentTarget.checked })} />
          </li>
        {/each}
      </ul>
      <h3>Keyboard shortcuts</h3>
      <ul class="rows compact">
        {#each SHORTCUTS as [label, keys] (label)}
          <li>
            <div class="text"><div class="title">{label}</div></div>
            <kbd>{keys}</kbd>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    background: var(--surface-root);
  }
  .window {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    -webkit-app-region: drag;
  }
  button,
  input,
  .rows {
    -webkit-app-region: no-drag;
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
    color: var(--text-dim);
  }
  .body {
    flex: 1;
    padding: 52px 40px 0;
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
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .lead {
    margin: 0 0 22px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .banner {
    margin: 14px -16px 16px; /* as wide as the list under it */
    padding: 10px 16px;
    border-radius: var(--radius-lg);
    background: rgb(255 214 10 / 0.12);
    box-shadow: inset 0 0 0 0.5px rgb(255 214 10 / 0.35);
    color: var(--warning-text);
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
    background: var(--surface-50);
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
  .rows li + li {
    box-shadow: var(--hairline-t);
  }
  .rows li.need {
    box-shadow: inset 3px 0 0 var(--warning);
  }
  .rows li + li.need {
    box-shadow: inset 3px 0 0 var(--warning), var(--hairline-t);
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
    color: var(--text);
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
    color: var(--accent-text);
    font-size: 10.5px;
    font-weight: 600;
  }
  .reason {
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-dim);
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
    background: var(--surface-100-hover);
  }
  .button.primary {
    height: 32px;
    padding: 0 20px;
    background: var(--accent);
    box-shadow: none;
    color: var(--accent-ink);
  }
  .button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .button:disabled {
    opacity: 0.4;
  }
  .button:focus-visible,
  .link:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent-text);
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
    color: var(--text-dim);
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
    transition: background 150ms;
  }
  input[role='switch']::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--knob);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 150ms;
  }
  input[role='switch']:checked {
    background: var(--accent);
  }
  input[role='switch']:checked::after {
    transform: translateX(13px);
    background: var(--accent-ink);
  }
  kbd {
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font: 13px var(--font);
    letter-spacing: 1px;
  }
</style>
