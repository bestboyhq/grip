// Each beat, rising part, and sitemap below the fold waits, then rises as it scrolls into view: up to four in one
// wave, each a step later than the one before. Returns the cleanup for an `$effect`.
export function reveal(): () => void {
	const io = new IntersectionObserver(
		(entries) => {
			let wave = 0;
			for (const { isIntersecting, target } of entries) {
				if (!isIntersecting || !(target instanceof HTMLElement)) continue;
				target.style.setProperty('--i', String(Math.min(wave++, 3)));
				target.dataset.reveal = 'go';
				io.unobserve(target);
			}
		},
		{ rootMargin: `${document.documentElement.scrollHeight}px 0px -10% 0px` },
	);
	const waiting = [...document.querySelectorAll<HTMLElement>('.beat, .rise, .sitemap')].filter(
		(element) => element.getBoundingClientRect().top > innerHeight,
	);
	for (const element of waiting) {
		element.dataset.reveal = 'wait';
		io.observe(element);
	}
	return () => {
		io.disconnect();
		for (const element of waiting) delete element.dataset.reveal;
	};
}
