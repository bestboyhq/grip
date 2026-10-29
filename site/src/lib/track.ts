// What the page reports to Logdash: every press of a link, button, or question, each part of the page as it comes
// into view, and how far down the page was read. Logdash itself counts page views, exits, and errors.
import { DOWNLOAD_URL } from '#lib/links.ts';

type Props = Record<string, string | number | boolean | undefined>;

// Logdash's script is deferred, so the page can start before it runs; a browser it does not count (an automated one)
// never gets it, and the event is dropped.
function track(name: string, props: Props): void {
	if (window.logdash) return window.logdash.track(name, props);
	document
		.querySelector('script[data-site]')
		?.addEventListener('load', () => window.logdash?.track(name, props), { once: true });
}

// The part of the page an element sits in: the bar, the hero, a section by its id, or the footer.
function partOf(element: Element): string {
	const part = element.closest<HTMLElement>('[data-place], section[id]');
	return part?.dataset.place || part?.id || 'page';
}

// What a control says, as a screen reader reads it.
function labelOf(element: Element): string {
	const label = element.getAttribute('aria-label');
	if (label) return label;
	const copy = element.cloneNode(true) as Element;
	for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
	return (copy.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

// Listens in the capture phase, before the control's own handler runs, so a toggle reports the state it was in.
// A middle click opens a link in a new tab, so it counts for links.
export function press(event: MouseEvent): void {
	if (!(event.target instanceof Element) || (event.type === 'auxclick' && event.button !== 1)) return;
	const control = event.target.closest('a[href], button, summary');
	if (!control) return;
	const place = partOf(control);
	const href = control.getAttribute('href');
	if (href === DOWNLOAD_URL)
		return track('grip_web_download_started', { app: 'grip', menu: `grip-${place}` });
	if (href) return track('grip_web_link_clicked', { place, label: labelOf(control), href });
	if (event.type === 'auxclick') return;
	if (control.tagName === 'SUMMARY') {
		if (!(control.parentElement as HTMLDetailsElement).open)
			track('grip_web_question_opened', { question: labelOf(control) });
		return;
	}
	track('grip_web_button_clicked', {
		place,
		label: labelOf(control),
		pressed: control.getAttribute('aria-pressed') ?? undefined,
		expanded: control.getAttribute('aria-expanded') ?? undefined,
	});
}

// Each part reports once per page, when it scrolls into the top three quarters of the window. The depth reports each
// quarter of the page scrolled to, so a page that fits the window reports none.
export function watch(): () => void {
	const parts = new IntersectionObserver(
		(entries) => {
			for (const entry of entries.filter((entry) => entry.isIntersecting)) {
				parts.unobserve(entry.target);
				track('grip_web_section_viewed', { section: partOf(entry.target) });
			}
		},
		{ rootMargin: '0px 0px -25% 0px' },
	);
	for (const part of document.querySelectorAll('main [data-place], main section[id], footer')) parts.observe(part);
	let depth = 0;
	const scrolled = (): void => {
		const read = (scrollY + innerHeight + 1) / document.documentElement.scrollHeight;
		while (depth < 100 && read >= (depth + 25) / 100) {
			depth += 25;
			track('grip_web_page_scrolled', { depth });
		}
	};
	addEventListener('scroll', scrolled, { passive: true });
	return () => {
		parts.disconnect();
		removeEventListener('scroll', scrolled);
	};
}
