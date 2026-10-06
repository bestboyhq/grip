<!-- Color well (opens the native macOS color panel), a hex field, and optional swatches.
     Values are #rrggbb. onchange(v, merge): one `merge` key per color-panel session, for one undo step. -->
<script lang="ts" module>
  /** '#abc' | 'abc' | '#aabbcc' -> '#aabbcc', anything else -> null. */
  export function normalizeHex(s: string): string | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
    if (!m) return null
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return '#' + h.toLowerCase()
  }
</script>

<script lang="ts">
  let {
    label,
    value,
    swatches = [],
    disabled = false,
    active = true,
    onchange,
  }: {
    label: string
    value: string
    swatches?: string[]
    disabled?: boolean
    /** false: `value` is only a starting point (the color is not in use yet), so no swatch is marked. */
    active?: boolean
    onchange: (v: string, merge?: string) => void
  } = $props()
  const id = $props.id()
  let session = 0
  const hex = $derived(normalizeHex(value) ?? '#000000')
</script>

<div class="picker" class:disabled>
  <div class="row">
    <label for="{id}-hex">{label}</label>
    <span class="well" style:background={hex}>
      <input type="color" value={hex} {disabled} aria-label="{label}: open color panel" oninput={(e) => onchange(e.currentTarget.value, `${id}:${session}`)} onchange={() => session++} />
    </span>
    <span class="hex"><span aria-hidden="true">#</span><input
      id="{id}-hex"
      {disabled}
      value={hex.slice(1)}
      maxlength="7"
      spellcheck="false"
      autocomplete="off"
      onchange={(e) => {
        const v = normalizeHex(e.currentTarget.value)
        if (v) onchange(v)
        e.currentTarget.value = (v ?? hex).slice(1)
      }}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    /></span>
  </div>
  {#if swatches.length}
    <div class="swatches" role="radiogroup" aria-label="{label} presets">
      {#each swatches as c (c)}
        <input type="radio" name="{id}-swatch" {disabled} checked={active && c.toLowerCase() === hex} style:background={c} aria-label={c} onchange={() => onchange(c.toLowerCase())} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 8px; }
  .picker.disabled { opacity: 0.4; }
  .row { display: flex; align-items: center; gap: 6px; min-height: 30px; }
  label { flex: none; width: var(--label-w, 92px); color: var(--text-dim); font-size: 12px; }
  .well { position: relative; flex: none; width: 26px; height: 26px; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 0.5px var(--edge-strong); }
  .well:has(input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .well input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; border: 0; padding: 0; }
  .hex { flex: 1; min-width: 0; display: flex; align-items: center; height: var(--control-h); padding-left: 8px; border-radius: var(--radius-sm); background: var(--surface-100); box-shadow: var(--hairline); color: var(--text-faint); font: 12.5px var(--mono); }
  .hex:has(input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .hex input { flex: 1; min-width: 0; height: 100%; padding: 0 8px 0 2px; border: 0; background: none; color: var(--text); font: inherit; text-transform: lowercase; }
  .hex input:focus-visible { outline: none; }
  .swatches { display: flex; flex-wrap: wrap; gap: 7px; padding: 2px 0 4px calc(var(--label-w, 92px) + 6px); }
  /* Native radios: one tab stop, arrow keys move the choice. Keyboard focus rings the inside, selection
     the outside, so the two never merge. */
  .swatches input {
    --selected: 0 0 transparent; --focused: 0 0 transparent;
    appearance: none; width: 20px; height: 20px; margin: 0; border-radius: 50%;
    box-shadow: var(--focused), inset 0 0 0 0.5px var(--edge-strong), var(--selected);
    transition: transform 120ms var(--ease-out), box-shadow 120ms;
  }
  .swatches input:hover { transform: scale(1.12); }
  .swatches input:checked { --selected: 0 0 0 2px var(--surface-50), 0 0 0 3.5px var(--text); }
  .swatches input:focus-visible { outline: none; --focused: inset 0 0 0 2px var(--text), inset 0 0 0 3.5px rgb(0 0 0 / 0.5); }
</style>
