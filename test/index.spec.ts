import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Bound in vitest.config.mts.
const SECRET = 'test-secret';
const auth = { Authorization: `Bearer ${SECRET}` };
const url = (key: string) => `https://assets.test/${key}`;

const put = (key: string, body: string, contentType: string) =>
	SELF.fetch(url(key), { method: 'PUT', headers: { ...auth, 'Content-Type': contentType }, body });

describe('uploads', () => {
	it('refuses uploads without the secret', async () => {
		const response = await SELF.fetch(url('a.png'), { method: 'PUT', body: 'x' });
		expect(response.status).toBe(401);
	});

	it('refuses a wrong secret of the same length', async () => {
		const response = await SELF.fetch(url('a.png'), {
			method: 'PUT',
			headers: { Authorization: 'Bearer test-secreT' },
			body: 'x',
		});
		expect(response.status).toBe(401);
	});

	it('serves an upload with its Content-Type and safety headers', async () => {
		await put('logo.png', 'png-bytes', 'image/png');
		const response = await SELF.fetch(url('logo.png'));

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('image/png');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
		expect(response.headers.get('Content-Disposition')).toBeNull();
		expect(await response.text()).toBe('png-bytes');
	});

	it('downloads non-images instead of rendering them', async () => {
		await put('brief.pdf', '%PDF-1.7', 'application/pdf');
		const response = await SELF.fetch(url('brief.pdf'));
		expect(response.headers.get('Content-Disposition')).toBe('attachment');
		await response.arrayBuffer();
	});

	it('rejects path traversal', async () => {
		const response = await SELF.fetch(url('..%2Fsecret'), { headers: auth });
		expect(response.status).toBe(404);
		await response.arrayBuffer();
	});
});

describe('private objects', () => {
	it('hides private objects from anonymous readers', async () => {
		await put('private/id-scan.jpg', 'scan', 'image/jpeg');
		const response = await SELF.fetch(url('private/id-scan.jpg'));
		expect(response.status).toBe(404);
		await response.arrayBuffer();
	});

	it('serves private objects to the backend, uncached', async () => {
		await put('private/cv.pdf', '%PDF-1.7', 'application/pdf');
		const response = await SELF.fetch(url('private/cv.pdf'), { headers: auth });
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		await response.arrayBuffer();
	});

	it('moves an object with copy and delete', async () => {
		await put('old-cv.pdf', '%PDF-1.7', 'application/pdf');
		const copy = await SELF.fetch(url('private/old-cv.pdf'), {
			method: 'PUT',
			headers: { ...auth, 'X-Copy-Source': 'old-cv.pdf' },
		});
		expect(copy.status).toBe(200);
		await copy.arrayBuffer();
		const removed = await SELF.fetch(url('old-cv.pdf'), { method: 'DELETE', headers: auth });
		expect(removed.status).toBe(204);

		const gone = await SELF.fetch(url('old-cv.pdf'));
		expect(gone.status).toBe(404);
		await gone.arrayBuffer();
		const moved = await SELF.fetch(url('private/old-cv.pdf'), { headers: auth });
		expect(moved.headers.get('Content-Type')).toBe('application/pdf');
		await moved.arrayBuffer();
	});

	it('refuses deletes without the secret', async () => {
		const response = await SELF.fetch(url('logo.png'), { method: 'DELETE' });
		expect(response.status).toBe(401);
		await response.arrayBuffer();
	});
});
