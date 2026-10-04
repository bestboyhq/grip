<!-- Labelled slider on a native range input (keyboard, screen readers, and macOS accessibility for free).
     onchange(v, merge): `merge` is the same for every value of one drag or one held key, so callers can
     pass it to edit() and get one undo step per gesture. Double-click or the reset button restores `initial`. -->
<script lang="ts">
  import Icon from './Icon.svelte'
  import { tooltip } from './tooltip.ts'

  let {
    label,
    value,
    min = 0,
    max = 1,
    step = 0.01,
    initial,
    format = (v: number) => String(Math.round(v)),
    disabled = false,
    onchange,
  }: {
    label: string
    value: number
    min?: number
    max?: number
    step?: number
    initial?: number
    format?: (v: number) => string
    disabled?: boolean
    onchange: (v: number, merge?: string) => void
  } = $props()

  const id = $props.id()
  let gesture = 0
  const pct = $derived(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)))
  const modified = $derived(initial !== undefined && Math.abs(value - initial) > step / 2)
  const reset = () => initial !== undefined && onchange(initial)
</script>

<div class="row" class:disabled>
  <label for={id}>{label}</label>
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {value}
    {disabled}
    aria-valuetext={format(value)}
    style:--p="{pct}%"
    onpointerdown={() => gesture++}
    onkeyup={() => gesture++}
    oninput={(e) => onchange(Number(e.currentTarget.value), `${id}:${gesture}`)}
    ondblclick={reset}
  />
  <button class="reset" class:shown={modified} tabindex={modified ? 0 : -1} aria-hidden={!modified} {disabled} onclick={reset} {@attach tooltip(`Reset ${label.toLowerCase()}`)}>
    <Icon name="reset" size={13} />
  </button>
  <output for={id}>{format(value)}</output>
</div>

<style>
  .row { display: flex; align-items: center; gap: 6px; min-height: 28px; }
  .row.disabled { opacity: 0.4; }
  label { flex: none; width: var(--label-w, 92px); color: var(--text-dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  input { flex: 1; min-width: 0; height: 18px; margin: 0; background: transparent; appearance: none; -webkit-appearance: none; }
  input:focus-visible { outline: none; }
  input::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--accent) var(--p), var(--bg-active) var(--p)); }
  input::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #f5f5f7;
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.45); transition: transform 120ms var(--ease-out);
  }
  input:active::-webkit-slider-thumb { transform: scale(1.1); }
  input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--focus-ring); }
  .reset { flex: none; display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--text-faint); opacity: 0; pointer-events: none; }
  .reset.shown { pointer-events: auto; }
  .row:hover .reset.shown, .reset.shown:focus-visible { opacity: 1; }
  .reset:hover { color: var(--text); background: var(--bg-hover); }
  output { flex: none; width: 38px; text-align: right; font-size: 12px; color: var(--text); font-variant-numeric: tabular-nums; }
</style>
