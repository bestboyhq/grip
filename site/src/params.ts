// The matchers of route params. A question guide's address, so /guides/<slug> serves it beside the license guides
// of guides/[slug].
import { defineParams } from '@sveltejs/kit/params';
import { QUESTIONS } from '#lib/questions.ts';

export const params = defineParams({
	question: (slug) => QUESTIONS.find((question) => question.slug === slug)?.slug,
});
