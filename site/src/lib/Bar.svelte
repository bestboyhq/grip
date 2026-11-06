<script lang="ts">
	import { asset } from '$app/paths';
	import type { TransitionConfig } from 'svelte/transition';
	import Arrow from './Arrow.svelte';
	import GitHubIcon from './GitHubIcon.svelte';
	import {
		APPS,
		BESTBOY_URL,
		DOWNLOAD_URL,
		GITHUB_URL,
		isExternal,
		MENUS,
		type Link,
		type Menu,
	} from './links';
	import {
		CLICK_GRACE_MS,
		drop,
		type Drop,
		easeOut,
		LEAVE_MS,
		MOVE_MS,
		REST_MS,
		still,
	} from './menu';

	let open = $state<string | null>(null);
	let moving = $state(false);
	let dir = 1;
	let openedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let menus = $state<HTMLElement>();
	let brand = $state<HTMLElement>();
	let sheet = $state<HTMLElement>();
	let size = $state<{ w: number; h: number; from: number }>();
	const triggers: Record<string, HTMLButtonElement | undefined> = $state({});
	const panes: Record<string, HTMLElement | undefined> = $state({});

	const order = (id: string): number => MENUS.findIndex((menu) => menu.id === id);
	const inside = (node: Node): boolean => Boolean(menus?.contains(node) || brand?.contains(node));

	function show(id: string): void {
		clearTimeout(timer);
		if (open === id) return;
		// The switcher hangs from the brand, so only Product and Resources share one panel that slides between them.
		moving = open !== null && open !== APPS.id && id !== APPS.id;
		if (open) dir = order(id) > order(open) ? 1 : -1;
		openedAt = performance.now();
		open = id;
	}

	function close(): void {
		clearTimeout(timer);
		moving = false;
		open = null;
	}

	function rest(id: string, event: PointerEvent): void {
		if (event.pointerType !== 'mouse') return;
		clearTimeout(timer);
		if (open) show(id);
		else timer = setTimeout(() => show(id), REST_MS);
	}

	function leave(event: PointerEvent): void {
		if (event.pointerType !== 'mouse') return;
		clearTimeout(timer);
		if (open) timer = setTimeout(close, LEAVE_MS);
	}

	function back(event: PointerEvent): void {
		if (event.pointerType === 'mouse' && open) clearTimeout(timer);
	}

	function toggle(id: string): void {
		if (open === id && performance.now() - openedAt > CLICK_GRACE_MS) close();
		else show(id);
	}

	const links = (id: string): HTMLElement[] => [
		...(panes[id]?.querySelectorAll<HTMLElement>('a[href]') ?? []),
	];

	function nameKey(id: string, event: KeyboardEvent): void {
		const first = links(id)[0];
		if (event.key !== 'Tab' || event.shiftKey || open !== id || !first) return;
		event.preventDefault();
		first.focus();
	}

	function linkKey(id: string, event: KeyboardEvent): void {
		if (event.key !== 'Tab') return;
		const all = links(id);
		if (event.target !== (event.shiftKey ? all[0] : all.at(-1))) return;
		const name = triggers[id];
		const next = event.shiftKey
			? name
			: name?.closest('li')?.nextElementSibling?.querySelector<HTMLElement>('a, button');
		if (!next) return;
		event.preventDefault();
		next.focus();
	}

	function focused(event: FocusEvent): void {
		const at = event.target;
		if (!open || !(at instanceof Node)) return;
		if (at !== triggers[open] && !panes[open]?.contains(at)) close();
	}

	function blurred(event: FocusEvent): void {
		const to = event.relatedTarget;
		if (to instanceof Node && !inside(to)) close();
	}

	$effect(() => {
		const id = open;
		if (!id) return;
		const press = (event: PointerEvent): void => {
			if (!(event.target instanceof Node) || !inside(event.target)) close();
		};
		const key = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			close();
			triggers[id]?.focus();
		};
		window.addEventListener('pointerdown', press);
		window.addEventListener('keydown', key);
		return () => {
			window.removeEventListener('pointerdown', press);
			window.removeEventListener('keydown', key);
		};
	});

	$effect(() => {
		const pane = open ? panes[open] : undefined;
		const name = open ? triggers[open] : undefined;
		if (!pane || !name) return;
		if (open === APPS.id) {
			const at = name.getBoundingClientRect();
			pane.style.setProperty('--from', `${name.offsetLeft + name.offsetWidth / 2 - pane.offsetLeft}px`);
			pane.style.setProperty('--name-x', `${at.left + at.width / 2}px`);
			return;
		}
		size = {
			w: pane.offsetWidth,
			h: pane.offsetHeight,
			from: pane.offsetLeft + pane.offsetWidth - (name.offsetLeft + name.offsetWidth / 2),
		};
	});

	const fall = (_node: Element): Drop => (moving ? { duration: 0 } : drop());

	function slide(
		_node: Element,
		_params: unknown,
		{ direction }: { direction: 'in' | 'out' | 'both' },
	): TransitionConfig {
		if (!moving || still()) return { duration: 0 };
		const x = (direction === 'in' ? dir : -dir) * 20;
		const inert = direction === 'out' ? '; pointer-events: none' : '';
		return {
			duration: MOVE_MS,
			easing: easeOut,
			css: (t, u) => `opacity: ${t}; translate: ${u * x}px 0; filter: blur(${u * 2}px)${inert}`,
		};
	}

	const fold = (): void => sheet?.hidePopover();

	const reloads = (link: Link): true | undefined =>
		link.reload || isExternal(link) ? true : undefined;
</script>

{#snippet chevron()}
	<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
{/snippet}

{#snippet item(id: string, link: Link, plain = false)}
	<a
		class={['item', { plain }]}
		href={link.href}
		data-sveltekit-reload={reloads(link)}
		aria-current={link.current ? 'true' : undefined}
		onclick={close}
		onkeydown={(event) => linkKey(id, event)}
	>
		{#if link.icon}
			<img class="app-icon" src={link.icon} width="32" height="32" alt="" />
		{/if}
		<span class="item-text">
			<span class="item-title">
				{link.title}
				{#if link.tag}<span class="tag">{link.tag}</span>{/if}
			</span>
			{#if link.line && !plain}<span class="item-line">{link.line}</span>{/if}
		</span>
		{#if link.current}
			<svg class="here" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
		{/if}
	</a>
{/snippet}

{#snippet contents(menu: Menu)}
	<div class="slide" in:slide out:slide>
		<div class="card">
			{#each menu.columns as column, index (index)}
				<div class={['column', { plain: column.plain }]}>
					{#if column.label}<p class="label">{column.label}</p>{/if}
					<ul>
						{#each column.links as link (link.href)}
							<li>{@render item(menu.id, link, column.plain)}</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
		{#if menu.strip}
			<p class="strip">
				<span>
					<b>{menu.strip.lead}</b>
					{menu.strip.text}
				</span>
				<a
					href={menu.strip.link.href}
					data-sveltekit-reload
					onclick={close}
					onkeydown={(event) => linkKey(menu.id, event)}
				>
					{menu.strip.link.title}
					<Arrow class="ahead" />
				</a>
			</p>
		{/if}
	</div>
{/snippet}

<header class="topbar" data-place="bar">
	<div
		class={['row', { moving }]}
		style:--menu-w={size ? `${size.w}px` : undefined}
		style:--menu-h={size ? `${size.h}px` : undefined}
		style:--menu-from={size ? `${size.from}px` : undefined}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="brand"
			bind:this={brand}
			onpointerenter={back}
			onpointerleave={leave}
			onfocusin={focused}
			onfocusout={blurred}
		>
			<a class="mark" href={BESTBOY_URL} data-sveltekit-reload>
				<img class="app-icon" src={asset('icons/bestboy.webp')} width="22" height="22" alt="Bestboy" />
				<span class="org" aria-hidden="true">Bestboy</span>
			</a>
			<span class="slash" aria-hidden="true">/</span>
			<button
				bind:this={triggers[APPS.id]}
				class="mark switch"
				type="button"
				aria-expanded={open === APPS.id}
				aria-controls="bar-{APPS.id}"
				aria-label="Grip, switch app"
				onpointerenter={(event) => rest(APPS.id, event)}
				onclick={() => toggle(APPS.id)}
				onkeydown={(event) => nameKey(APPS.id, event)}
			>
				<img class="app-icon" src={asset('icons/grip.webp')} width="22" height="22" alt="" />
				Grip{@render chevron()}
			</button>
			{#if open === APPS.id}
				<div bind:this={panes[APPS.id]} id="bar-{APPS.id}" class="pane apps" transition:fall>
					{@render contents(APPS)}
				</div>
			{/if}
		</div>

		<nav class="nav" aria-label="Grip">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="menus"
				bind:this={menus}
				onpointerenter={back}
				onpointerleave={leave}
				onfocusin={focused}
				onfocusout={blurred}
			>
				<ul class="links">
					{#each MENUS as menu (menu.id)}
						<li>
							<button
								bind:this={triggers[menu.id]}
								class="link"
								type="button"
								aria-expanded={open === menu.id}
								aria-controls="bar-{menu.id}"
								onpointerenter={(event) => rest(menu.id, event)}
								onclick={() => toggle(menu.id)}
								onkeydown={(event) => nameKey(menu.id, event)}
							>
								{menu.title}{@render chevron()}
							</button>
							{#if open === menu.id}
								<div bind:this={panes[menu.id]} id="bar-{menu.id}" class="pane" transition:fall>
									{@render contents(menu)}
								</div>
							{/if}
						</li>
					{/each}
					<li>
						<a class="link" href={GITHUB_URL}><GitHubIcon size={15} />Source</a>
					</li>
				</ul>
				{#if open && open !== APPS.id}
					<div class="shell" aria-hidden="true" transition:fall></div>
				{/if}
			</div>
			<span class="divider" aria-hidden="true"></span>
			<a class="button primary small" href={DOWNLOAD_URL}>Download</a>
			<button class="burger" type="button" popovertarget="bar-sheet" aria-label="Menu">
				<i></i>
				<i></i>
			</button>
			<div id="bar-sheet" class="sheet" popover bind:this={sheet}>
				{#each MENUS as menu (menu.id)}
					{#each menu.columns as column (column.label)}
						<div class="sheet-group">
							<p class="label">{column.label}</p>
							<ul>
								{#each column.links as link (link.href)}
									<li>
										<a
											class="row-link"
											href={link.href}
											data-sveltekit-reload={reloads(link)}
											onclick={fold}
										>
											{#if link.icon}
												<img class="app-icon" src={link.icon} width="24" height="24" alt="" />
											{/if}
											<span class="item-title">
												{link.title}
												{#if link.tag}<span class="tag">{link.tag}</span>{/if}
											</span>
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/each}
				<div class="sheet-group">
					<a class="row-link" href={GITHUB_URL} onclick={fold}><GitHubIcon size={15} />Source</a>
				</div>
			</div>
		</nav>
	</div>
</header>

<style>
	.topbar {
		position: sticky;
		z-index: 20;
		top: 0;
		background: color-mix(in srgb, var(--surface-root) 82%, transparent);
		backdrop-filter: blur(12px) saturate(1.4);
	}

	.topbar::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -4px;
		width: 100vw;
		height: 9px;
		margin-left: -50vw;
		background: var(--crosses);
		background-repeat: no-repeat;
		pointer-events: none;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		max-width: var(--col);
		height: var(--bar-h);
		margin: 0 auto;
		padding: env(safe-area-inset-top) max(var(--pad), env(safe-area-inset-right)) 0
			max(var(--pad), env(safe-area-inset-left));
		border-inline: 1px solid transparent;
	}

	/* The rails through the bar, one element each, like the page's. */
	.row::before,
	.row::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 -1px;
		width: 1px;
		background: var(--frame);
		pointer-events: none;
	}

	.row::after {
		left: auto;
		right: -1px;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.mark {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--fg-default);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
		white-space: nowrap;
	}

	.mark img {
		--s: 22px;
	}

	.slash {
		color: var(--fg-faint);
	}

	/* The app switcher: the current app's name, its chevron turning over, on a plate concentric with the icon
	   (the icon's corner is 22.5% of its 22px, 5px in from the plate's edge). */
	.switch {
		height: 32px;
		margin-inline: -5px -8px;
		padding: 0 8px 0 5px;
		border: 0;
		border-radius: 10px;
		background: none;
		font-family: inherit;
		cursor: pointer;
	}

	.switch .chev {
		margin: 0 0 0 -3px;
	}

	.switch:active,
	.switch[aria-expanded='true'] {
		background: var(--surface-hover);
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	ul {
		list-style: none;
	}

	.links {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--fg-secondary);
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		-webkit-user-select: none;
		user-select: none;
	}

	.link:active,
	.link[aria-expanded='true'] {
		background: var(--surface-hover);
		color: var(--fg-default);
	}

	.link :global(svg) {
		flex: none;
	}

	.chev {
		width: 12px;
		height: 12px;
		margin-right: -2px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.7;
		transition: rotate 200ms var(--ease);
	}

	[aria-expanded='true'] .chev {
		rotate: 180deg;
	}

	.divider {
		width: 1px;
		height: 16px;
		background: var(--border-default);
	}

	@property --menu-w {
		syntax: '<length>';
		inherits: true;
		initial-value: 0px;
	}

	@property --menu-h {
		syntax: '<length>';
		inherits: true;
		initial-value: 0px;
	}

	.row.moving {
		transition:
			--menu-w 200ms var(--ease),
			--menu-h 200ms var(--ease);
	}

	.shell,
	.pane {
		position: absolute;
		top: calc(100% + 6px);
		right: max(var(--pad), env(safe-area-inset-right));
		transform-origin: calc(100% - var(--menu-from, 50%)) 0;
	}

	.shell {
		width: var(--menu-w);
		height: var(--menu-h);
		border-radius: 16px;
		background: var(--surface-root);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 1px 1px rgb(0 0 0 / 0.12),
			0 16px 40px -8px rgb(0 0 0 / 0.32);
	}

	.shell::before {
		content: '';
		position: absolute;
		inset: -22px 0 100%;
	}

	.pane {
		z-index: 1;
		width: max-content;
		clip-path: inset(0 0 max(0px, 100% - var(--menu-h)) max(0px, 100% - var(--menu-w)) round 16px);
	}

	/* The switcher's panel hangs from the brand, its left edge on the column's content edge, and is its own shell. */
	.pane.apps {
		right: auto;
		left: max(var(--pad), env(safe-area-inset-left));
		transform-origin: var(--from, 50%) 0;
		clip-path: none;
		border-radius: 16px;
		background: var(--surface-root);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 1px 1px rgb(0 0 0 / 0.12),
			0 16px 40px -8px rgb(0 0 0 / 0.32);
	}

	.pane.apps::before {
		content: '';
		position: absolute;
		inset: -22px 0 100%;
	}

	/* With no label over it, the list sits as far from the card's top as from its sides. */
	.pane.apps .column {
		padding: 10px;
	}

	.slide {
		padding: 6px;
	}

	.card {
		display: flex;
		border-radius: 10px;
		background: var(--surface-elevated);
		box-shadow: 0 0 0 1px var(--ring-faint);
	}

	.column {
		width: 300px;
		padding: 14px 10px 10px;
	}

	.column.plain {
		width: 200px;
	}

	.column + .column {
		border-left: 1px solid var(--ring-faint);
	}

	.label {
		padding: 0 10px 6px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.column:has(.app-icon) {
		width: 392px;
	}

	.item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 10px;
		border-radius: 8px;
		color: var(--fg-default);
		text-decoration: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.item.plain {
		padding-block: 7px;
	}

	.item.plain .item-title {
		color: var(--fg-secondary);
	}

	.item:active {
		background: var(--surface-hover);
	}

	.item .app-icon {
		--s: 32px;
		flex: none;
	}

	.item-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.item-title {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 14px;
		font-weight: 500;
		line-height: 18px;
	}

	.tag {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 400;
	}

	.here {
		flex: none;
		align-self: center;
		width: 16px;
		height: 16px;
		margin-left: auto;
		fill: none;
		stroke: var(--fg-secondary);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.item-line {
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 19px;
		text-wrap: pretty;
	}

	.strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 12px 12px 6px 14px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 20px;
	}

	.strip b {
		margin-right: 4px;
		color: var(--fg-default);
		font-weight: 500;
	}

	.strip a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--fg-secondary);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.strip :global(.ahead) {
		width: 11px;
		height: 11px;
	}

	.burger {
		display: none;
		place-items: center;
		align-content: center;
		gap: 5px;
		width: 36px;
		height: 36px;
		margin-right: -8px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--fg-default);
		cursor: pointer;
	}

	.burger i {
		display: block;
		width: 16px;
		height: 1.5px;
		border-radius: 1px;
		background: currentColor;
		transition:
			translate 180ms var(--ease),
			rotate 180ms var(--ease);
	}

	.nav:has(.sheet:popover-open) .burger i:first-child {
		translate: 0 3.25px;
		rotate: 45deg;
	}

	.nav:has(.sheet:popover-open) .burger i:last-child {
		translate: 0 -3.25px;
		rotate: -45deg;
	}

	.burger:active {
		background: var(--surface-hover);
	}

	.sheet {
		position: fixed;
		inset: calc(var(--bar-h) + 8px) max(8px, env(safe-area-inset-right)) auto
			max(8px, env(safe-area-inset-left));
		width: auto;
		max-height: calc(100dvh - var(--bar-h) - 16px);
		margin: 0;
		padding: 6px;
		overflow: auto;
		overscroll-behavior: contain;
		border: 0;
		border-radius: 16px;
		background: var(--surface-elevated);
		color: var(--fg-default);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 24px 48px -16px rgb(0 0 0 / 0.32);
		opacity: 0;
		scale: 0.935;
		transform-origin: calc(
				100% - max(var(--pad), env(safe-area-inset-right)) - 10px +
					max(8px, env(safe-area-inset-right))
			)
			0;
		transition:
			opacity 150ms var(--ease),
			scale 150ms var(--ease),
			display 150ms allow-discrete,
			overlay 150ms allow-discrete;
	}

	.sheet:popover-open {
		opacity: 1;
		scale: 1;
		transition-duration: 200ms;
	}

	@starting-style {
		.sheet:popover-open {
			opacity: 0;
			scale: 0.935;
		}
	}

	.sheet-group {
		padding: 4px 0;
	}

	.sheet-group + .sheet-group {
		border-top: 1px solid var(--border-default);
	}

	.sheet-group .label {
		padding: 8px 12px 2px;
	}

	.row-link {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 12px;
		border-radius: 10px;
		color: var(--fg-default);
		font-size: 15px;
		text-decoration: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.row-link:active {
		background: var(--surface-hover);
	}

	.row-link .app-icon {
		--s: 24px;
		flex: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.link:hover {
			color: var(--fg-default);
		}

		.switch:hover {
			background: var(--surface-hover);
		}

		.item:hover {
			background: var(--surface-hover);
		}

		.item.plain:hover .item-title {
			color: var(--fg-default);
		}

		.strip a:hover {
			color: var(--fg-default);
		}

		.strip a:hover :global(.ahead) {
			translate: 2px 0;
		}
	}

	@media (max-width: 1023px) {
		.row {
			border-inline: 0;
		}

		.row::before,
		.row::after {
			content: none;
		}
	}

	@media (max-width: 859px) {
		.menus,
		.divider {
			display: none;
		}

		.burger {
			display: grid;
		}

		/* On a phone the switcher opens as a sheet, like the menu button's. */
		.pane.apps {
			position: fixed;
			inset: calc(var(--bar-h) + 8px) max(8px, env(safe-area-inset-right)) auto
				max(8px, env(safe-area-inset-left));
			width: auto;
			transform-origin: calc(var(--name-x, 50%) - max(8px, env(safe-area-inset-left))) 0;
		}

		.pane.apps .column {
			flex: 1;
		}

		.pane.apps .strip {
			flex-wrap: wrap;
			gap: 4px 24px;
		}
	}

	@media (max-width: 559px) {
		.org {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.mark,
		.burger {
			position: relative;
		}

		.mark::after,
		.burger::after {
			content: '';
			position: absolute;
			inset: min(0px, 50% - 22px);
		}

		.mark:active {
			opacity: 0.7;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet,
		.chev,
		.burger i {
			transition: none;
		}
	}
</style>
