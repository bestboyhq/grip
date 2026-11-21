import { error } from '@sveltejs/kit';
import { QUESTIONS } from '#lib/questions.ts';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => QUESTIONS.map(({ slug }) => ({ slug }));

export const load: PageLoad = ({ params }) => {
	const question = QUESTIONS.find(({ slug }) => slug === params.slug);
	if (!question) error(404, 'No such guide');
	return { question };
};
