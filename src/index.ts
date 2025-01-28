/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.json`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	MY_BUCKET: R2Bucket;
	AUTH_SECRET: string;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
					'Access-Control-Allow-Headers': 'Authorization, Content-Type',
					'Access-Control-Max-Age': '86400',
				},
			});
		}
		if (request.method === 'PUT') {
			// Note that you could require authentication for all requests
			// by moving this code to the top of the fetch function.
			const auth = request.headers.get('Authorization');
			const expectedAuth = `Bearer ${env.AUTH_SECRET}`;

			if (!auth || auth !== expectedAuth) {
				return new Response('Unauthorized', { status: 401 });
			}

			const url = new URL(request.url);
			const key = url.pathname.slice(1);
			await env.MY_BUCKET.put(key, request.body);
			return new Response(`Object ${key} uploaded successfully!`);
		}
		const url = new URL(request.url);
		const key = url.pathname.slice(1);
		const object = await env.MY_BUCKET.get(key);
		if (!object) {
			return new Response('Not found', { status: 404 });
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		return new Response(object.body, {
			headers: {
				...headers,
				'Access-Control-Allow-Origin': '*',
			},
		});
	},
} satisfies ExportedHandler<Env>;
