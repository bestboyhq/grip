<!-- The 3-2-1 before a recording: each number drops in on a spring while the one before falls out
     under it, and the circle beats as it lands. Whoever shows it pops it in and bursts it away with
     `pop` and `burst`: the area picker over the region, Settings in its preview. Reduced motion keeps
     the fades only. -->
<script lang="ts" module>
  import { springDuration, springProgress, type SpringConfig } from '../../engine/motion/spring.ts'

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const DROP: SpringConfig = { stiffness: 380, damping: 22, mass: 1 } // ~12% overshoot: the number lands
  const POP: SpringConfig = { stiffness: 420, damping: 24, mass: 1 }
  const easeOut = (u: number) => 1 - (1 - u) ** 3
  /** A spring as a transition: `css` gets its progress (past 1 while it overshoots) and linear time. */
  const sprung = (c: SpringConfig, css: (p: number, t: number) => string) => (_: Element) => {
    const d = springDuration(c)
    return { duration: d * 1000, css: (t: number) => css(springProgress(t * d, c), t) }
  }
  export const pop = sprung(POP, (p, t) => (calm ? `opacity: ${t}` : `opacity: ${Math.min(1, t * 3)}; transform: scale(${0.82 + 0.18 * p})`))
  const drop = sprung(DROP, (p, t) =>
    calm ? `opacity: ${t}` : `opacity: ${Math.min(1, t * 4)}; transform: translateY(${-60 * (1 - p)}%) scale(${1 + 0.45 * (1 - p)}); filter: blur(${Math.max(0, 8 * (1 - p))}px)`,
  )
  // Outros run t from 1 to 0; easing the elapsed part gives them a fast start.
  const fall = (_: Element) => ({
    duration: 280,
    css: (t: number) => {
      const e = easeOut(1 - t)
      return calm ? `opacity: ${t}` : `opacity: ${1 - e}; transform: translateY(${55 * e}%) scale(${1 - 0.3 * e}); filter: blur(${6 * e}px)`
    },
  })
  /** Recording starts: the circle bursts. Cancelled (`fade`): it just fades. */
  export const burst = (_: Element, { fade = false } = {}) => ({
    duration: fade ? 150 : 260,
    css: (t: number) => {
      const e = easeOut(1 - t)
      return calm || fade ? `opacity: ${t}` : `opacity: ${1 - e}; transform: scale(${1 + 0.2 * e}); filter: blur(${4 * e}px)`
    },
  })
</script>

<script lang="ts">
  let { count }: { count: number } = $props()

  /** The circle beats as each number after the first lands. */
  function beat(el: HTMLElement) {
    if (count < 3 && !calm)
      el.animate([{ scale: 1, easing: 'cubic-bezier(0.2, 0, 0, 1)' }, { scale: 1.06, offset: 0.3, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' }, { scale: 1 }], 450)
  }
</script>

<div class="count" role="status" aria-live="assertive" {@attach beat}>
  {#key count}<span class="digit" class:one={count === 1} in:drop|global out:fall>{count}</span>{/key}
</div>

<style>
  .count {
    display: grid;
    width: 132px;
    height: 132px;
    overflow: hidden; /* numbers fly in and out through its edge */
    border-radius: 50%;
    background: rgb(20 20 22 / 0.78);
    box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.2);
    color: #fff;
    font-size: 68px;
    font-weight: 600; /* proportional figures: each centers on its own width */
  }
  .digit {
    grid-area: 1 / 1; /* the falling number and the landing one overlap */
    place-self: center;
    translate: 0 -1px; /* figures sit low in their line box: this centers the ink */
  }
  .digit.one {
    translate: -2px -1px; /* its flag pulls its box left of the stem the eye centers on */
  }
</style>
