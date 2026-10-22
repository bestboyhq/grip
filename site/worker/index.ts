import { LOGDASH_SITE } from '../src/lib/logdash.ts';

export type Env = Readonly<{ ASSETS: Readonly<{ fetch(request: Request): Promise<Response> }> }>;

const CANONICAL_HOST = 'bestboy.dev';
const IMMUTABLE_PREFIX = '/grip/_app/immutable/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const PAGE = 'public, max-age=0, stale-while-revalidate=86400';
const LOGDASH_SCRIPT = '/grip/_ld/script.js';
const LOGDASH_EVENTS = '/grip/_ld/events';
const MEDIA_PREFIX = '/grip/media/';
const MAX_EVENTS_BYTES = 32768;
const EDGE_HOUR: RequestInit & { cf: object } = {
	cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600 } },
};

async function logdashScript(): Promise<Response> {
	const upstream = await fetch('https://logdash.io/sdk/web.js', EDGE_HOUR);
	if (!upstream.ok) return new Response(null, { status: 502 });
	return new Response(upstream.body, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
}

function refuse(status: number, error: string): Response {
	return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function onGrip(event: unknown): boolean {
	return (
		typeof event === 'object' &&
		event !== null &&
		'path' in event &&
		typeof event.path === 'string' &&
		event.path.startsWith('/grip')
	);
}

function gripBatch(text: string): boolean {
	try {
		const body: unknown = JSON.parse(text);
		return (
			typeof body === 'object' &&
			body !== null &&
			'siteId' in body &&
			body.siteId === LOGDASH_SITE &&
			'events' in body &&
			Array.isArray(body.events) &&
			body.events.length > 0 &&
			body.events.length <= 20 &&
			body.events.every(onGrip)
		);
	} catch {
		return false;
	}
}

async function logdashEvents(request: Request): Promise<Response> {
	if (!request.headers.get('Content-Type')?.startsWith('application/json'))
		return refuse(415, 'Send JSON.');
	const bytes = await request.arrayBuffer();
	if (bytes.byteLength > MAX_EVENTS_BYTES) return refuse(413, 'The request is too large.');
	const text = new TextDecoder().decode(bytes);
	if (!gripBatch(text)) return refuse(400, 'Send 1 to 20 events from a Grip page.');
	const headers = new Headers({ 'Content-Type': 'application/json' });
	for (const [name, value] of [
		['Origin', request.headers.get('Origin')],
		['User-Agent', request.headers.get('User-Agent')],
		['X-Logdash-Client-IP', request.headers.get('CF-Connecting-IP')],
	] as const)
		if (value) headers.set(name, value);
	const upstream = await fetch('https://api.logdash.io/web_events', {
		method: 'POST',
		headers,
		body: text,
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain',
			'Cache-Control': 'no-store',
		},
	});
}

function cacheControl(pathname: string): string | null {
	if (pathname.startsWith(IMMUTABLE_PREFIX)) return IMMUTABLE;
	const file = pathname.slice(pathname.lastIndexOf('/') + 1);
	return file === '__data.json' || !file.includes('.') ? PAGE : null;
}

function withPolicy(response: Response, url: URL): Response {
	const headers = new Headers(response.headers);
	headers.delete('Set-Cookie');
	if (url.hostname !== CANONICAL_HOST) headers.set('X-Robots-Tag', 'noindex');
	const policy = cacheControl(url.pathname);
	if (policy && (response.ok || response.status === 304)) headers.set('Cache-Control', policy);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

// Safari plays a video only from a server that answers byte ranges, and the assets binding answers every request
// with the whole file, so a clip's one range is cut from it here.
// ponytail: reads the whole clip per range request, fine for the sub-megabyte clips; past that, serve them from R2.
async function ranged(request: Request, response: Response): Promise<Response> {
	if (response.status !== 200) return response;
	const headers = new Headers(response.headers);
	headers.set('Accept-Ranges', 'bytes');
	const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.get('Range') ?? '');
	if (!range || (!range[1] && !range[2])) return new Response(response.body, { headers });
	const body = await response.arrayBuffer();
	const size = body.byteLength;
	const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
	const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	if (start > end) {
		headers.set('Content-Range', `bytes */${size}`);
		headers.delete('Content-Length');
		return new Response(null, { status: 416, headers });
	}
	headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
	headers.set('Content-Length', String(end - start + 1));
	return new Response(body.slice(start, end + 1), { status: 206, headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === LOGDASH_SCRIPT) return logdashScript();
		if (url.pathname === LOGDASH_EVENTS) return logdashEvents(request);
		if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
			const target = new URL(url);
			target.pathname = url.pathname.replace(/\/+$/u, '') || '/';
			return withPolicy(
				new Response(null, { status: 301, headers: { Location: target.href } }),
				url,
			);
		}
		const response = await env.ASSETS.fetch(request);
		return withPolicy(
			url.pathname.startsWith(MEDIA_PREFIX) ? await ranged(request, response) : response,
			url,
		);
	},
};
