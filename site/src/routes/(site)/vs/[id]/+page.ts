import { error } from '@sveltejs/kit';
import { recorder, VERSUS } from '#lib/versus.ts';
import type { EntryGenerator, PageLoad } from './$types';

// One page a recorder of the benchmark, Grip aside, built ahead of time.
export const entries: EntryGenerator = () => VERSUS.map(({ id }) => ({ id }));

export const load: PageLoad = ({ params }) => {
	const versus = VERSUS.find(({ id }) => id === params.id);
	const them = recorder(params.id);
	if (!versus || !them) error(404, 'No such comparison');
	return { versus, them };
};
