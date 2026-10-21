/**
 * Object storage for KaziSpace, in front of the `images` R2 bucket.
 *
 * - `GET /<key>`: public, except keys under `private/` (ID scans, CVs), which
 *   need the backend's secret. The backend proxies those to authorised users.
 * - `PUT /<key>`: backend only. Stores the body with its Content-Type, or
 *   copies an existing object when `X-Copy-Source` names one.
 * - `DELETE /<key>`: backend only.
 */

export interface Env {
	MY_BUCKET: R2Bucket;
	AUTH_SECRET: string;
}

const PRIVATE_PREFIX = 'private/';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
	'Access-Control-Max-Age': '86400',
};

const encoder = new TextEncoder();

/** Constant-time comparison, so the secret can't be recovered by timing. */
const isAuthorised = (request: Request, env: Env) => {
	if (!env.AUTH_SECRET) return false;
	const presented = encoder.encode(request.headers.get('Authorization') ?? '');
	const expected = encoder.encode(`Bearer ${env.AUTH_SECRET}`);
	return presented.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(presented, expected);
};

/** Object keys are flat `[prefix/]name`; nothing that could escape or alias. */
const keyFrom = (value: string) => {
	let key: string;
	try {
		key = decodeURIComponent(value.replace(/^\/+/, ''));
	} catch {
		return null;
	}
	if (!key || key.length > 512 || key.includes('..') || key.includes('\\') || key.endsWith('/')) {
		return null;
	}
	return key;
};

const text = (body: string, status: number) => new Response(body, { status, headers: CORS_HEADERS });

const serve = async (key: string, env: Env) => {
	const object = await env.MY_BUCKET.get(key);
	if (!object) return text('Not found', 404);

	const isPrivate = key.startsWith(PRIVATE_PREFIX);
	const headers = new Headers(CORS_HEADERS);
	object.writeHttpMetadata(headers);
	headers.set('ETag', object.httpEtag);
	// Never let the browser guess a type or run what it fetched from here.
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
	headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
	if (!headers.get('Content-Type')?.startsWith('image/')) {
		headers.set('Content-Disposition', 'attachment');
	}
	headers.set('Cache-Control', isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable');

	return new Response(object.body, { headers });
};

const store = async (key: string, request: Request, env: Env) => {
	const copySource = request.headers.get('X-Copy-Source');
	if (copySource) {
		const sourceKey = keyFrom(copySource);
		const source = sourceKey ? await env.MY_BUCKET.get(sourceKey) : null;
		if (!source) return text('Copy source not found', 404);
		await env.MY_BUCKET.put(key, source.body, { httpMetadata: source.httpMetadata });
		return text(`Object ${key} copied`, 200);
	}

	await env.MY_BUCKET.put(key, request.body, {
		httpMetadata: {
			contentType: request.headers.get('Content-Type') ?? 'application/octet-stream',
		},
	});
	return text(`Object ${key} uploaded successfully!`, 200);
};

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		const key = keyFrom(new URL(request.url).pathname);
		if (!key) return text('Not found', 404);

		switch (request.method) {
			case 'GET':
			case 'HEAD':
				if (key.startsWith(PRIVATE_PREFIX) && !isAuthorised(request, env)) {
					// Indistinguishable from a missing object.
					return text('Not found', 404);
				}
				return serve(key, env);
			case 'PUT':
				if (!isAuthorised(request, env)) return text('Unauthorized', 401);
				return store(key, request, env);
			case 'DELETE':
				if (!isAuthorised(request, env)) return text('Unauthorized', 401);
				await env.MY_BUCKET.delete(key);
				return new Response(null, { status: 204, headers: CORS_HEADERS });
			default:
				return text('Method not allowed', 405);
		}
	},
} satisfies ExportedHandler<Env>;
