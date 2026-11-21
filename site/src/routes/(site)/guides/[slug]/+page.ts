import { error } from '@sveltejs/kit';
import { GUIDES } from '#lib/guides.ts';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => GUIDES.map(({ slug }) => ({ slug }));

export const load: PageLoad = ({ params }) => {
	const guide = GUIDES.find(({ slug }) => slug === params.slug);
	if (!guide) error(404, 'No such guide');
	return { guide };
};
