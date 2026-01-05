import { chromium } from 'playwright';
import type { Page } from 'playwright';

// Minimal Node globals for TypeScript when Node types are not present
declare const process: any;
declare const require: any;
declare const module: any;

export async function findAndFill(page: Page, selectors: string[], value: string) {
	async function tryFillWithStrategies(locator: any) {
		const strategies = [
			async (loc: any) => { await loc.fill(value); },
			async (loc: any) => { await loc.click({ force: true }); await loc.fill(value); },
			async (loc: any) => { await loc.type(value, { delay: 20 }); },
			async (loc: any) => {
				await loc.evaluate((el: HTMLInputElement, v: string) => {
					el.value = v;
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
				}, value);
			},
		];

		for (const strat of strategies) {
			try {
				await strat(locator);
				return true;
			} catch (err) {
				// try next strategy
			}
		}
		return false;
	}

	async function locateFirstInPageOrFrames(root: any, sel: string) {
		try {
			const locator = root.locator(sel);
			if ((await locator.count()) > 0) return locator.first();
		} catch (e) {}
		try {
			const frames = await root.frames();
			for (const frame of frames) {
				try {
					const locator = frame.locator(sel);
					if ((await locator.count()) > 0) return locator.first();
				} catch (ef) {}
			}
		} catch (e) {}
		return null;
	}

	for (const sel of selectors) {
		const locator = await locateFirstInPageOrFrames(page, sel);
		if (locator) {
			if (await tryFillWithStrategies(locator)) return true;
		}
	}
	return false;
}

export async function clickFirst(page: Page, selectors: string[]) {
	async function locateFirstInPageOrFrames(root: any, sel: string) {
		try {
			const locator = root.locator(sel);
			if ((await locator.count()) > 0) return locator.first();
		} catch (e) {}
		try {
			const frames = await root.frames();
			for (const frame of frames) {
				try {
					const locator = frame.locator(sel);
					if ((await locator.count()) > 0) return locator.first();
				} catch (ef) {}
			}
		} catch (e) {}
		return null;
	}

	for (const sel of selectors) {
		const locator = await locateFirstInPageOrFrames(page, sel);
		if (locator) {
			try { await locator.click({ force: true }); return true; } catch (e) {}
		}
	}
	return false;
}


export async function GetResult(cardNumber: string, pin: string, headless = false) {
	const url = 'https://thegoodguysgiftcards.viisolutions.com.au/';
	let browser: any = null;
	let context: any = null;
	let createdLocalContext = false;
	let page: any = null;
	try {
		// try to connect to an existing Edge/Chrome started with --remote-debugging-port=9222
		try {
			try {
				browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
				const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
				context = existingContexts && existingContexts.length ? existingContexts[0] : await browser.newContext();
				console.log('Connected to existing browser via CDP (http)');
			} catch (err) {
				console.log('Direct CDP http connect failed, trying /json/version for websocket URL...', err && (err as Error).message || err);
				try {
					const http = require('http');
					const wsUrl: string = await new Promise((resolve, reject) => {
						const req = http.get('http://127.0.0.1:9222/json/version', (res: any) => {
							let data = '';
							res.on('data', (chunk: any) => data += chunk);
							res.on('end', () => {
								try {
									const j = JSON.parse(data);
									if (j && j.webSocketDebuggerUrl) resolve(j.webSocketDebuggerUrl);
									else reject(new Error('no webSocketDebuggerUrl in /json/version'));
								} catch (e) { reject(e); }
							});
						});
						req.on('error', reject);
						req.setTimeout && req.setTimeout(5000, () => { req.abort(); reject(new Error('timeout')); });
					});
					if (wsUrl) {
						browser = await chromium.connectOverCDP(wsUrl);
						const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
						context = existingContexts && existingContexts.length ? existingContexts[0] : await browser.newContext();
						console.log('Connected to existing browser via CDP (websocket)');
					}
				} catch (err2) {
					console.log('Failed to connect via websocket URL fallback:', err2 && (err2 as Error).message || err2);
				}
			}
		} catch (e) {
			// fall back to launching/creating context below
		}

		// page = context ? await context.newPage() : null;
		// if (!page) {
		// 	// launch a local browser context
		// 	browser = await chromium.launch({ channel: 'msedge', headless });
		// 	context = await browser.newContext({
		// 		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
		// 	});
		// 	createdLocalContext = true;
		// 	page = await context.newPage();
		// }

		// // anti-detection init
		// try {
		// 	await context.addInitScript(() => {
		// 		try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch (e) {}
		// 		try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch (e) {}
		// 		try { Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4] }); } catch (e) {}
		// 		try { // @ts-ignore
		// 			window.chrome = window.chrome || { runtime: {} };
		// 		} catch (e) {}
		// 	});
		// } catch (e) {}

		// if (createdLocalContext) {
		// 	try { console.log('Waiting 2s for local browser to initialize...'); } catch (e) {}
		// 	await new Promise(r => setTimeout(r, 2000));
		// }

		// try {
		// 	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		// } catch (e) {
		// 	console.error('Navigation error (goto):', e && (e as Error).message || e);
		// }

		const cardSelectors = ['#CardNumber', '#cardNumber', 'input[name*=card]', 'input[placeholder*=Card]', 'input[placeholder*=card]'];
		const pinSelectors = ['#CardPIN', '#pin', 'input[name*=pin]', 'input[placeholder*=PIN]', 'input[placeholder*=Pin]'];

		try {
			const filledCard = await findAndFill(page, cardSelectors, cardNumber);
			const filledPin = await findAndFill(page, pinSelectors, pin);
			if (!filledCard || !filledPin) {
				console.warn('Could not find card or PIN inputs.');
				return null;
			}
		} catch (e) {
			console.error('Error filling inputs:', e && (e as Error).message || e);
			return null;
		}

		try {
			const hasRecaptcha = await page.$('.g-recaptcha, iframe[src*="recaptcha"]');
			if (hasRecaptcha) {
				console.log('Detected reCAPTCHA. Please complete it in the opened browser window.');
				await page.bringToFront();

				const solvedToken = await (async () => {
					const timeout = 5 * 60 * 1000; // 5 minutes
					const interval = 1000;
					const start = Date.now();
					while (Date.now() - start < timeout) {
						try {
							const token = await page.evaluate(() => {
								const ta = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
								if (ta && ta.value && ta.value.length > 20) return ta.value;
								try {
									// @ts-ignore
									if ((window as any).grecaptcha && typeof (window as any).grecaptcha.getResponse === 'function') {
										const r = (window as any).grecaptcha.getResponse();
										if (r && r.length > 20) return r;
									}
								} catch (e) {}
								return null;
							});
							if (token) return token;
						} catch (e) {}
						await new Promise(r => setTimeout(r, interval));
					}
					return null;
				})();

				if (!solvedToken) console.log('Timeout waiting for reCAPTCHA; will submit the form anyway.');
				else console.log('reCAPTCHA solved; submitting form...');
			}
		} catch (e) {
			console.error('Error handling reCAPTCHA detection:', e && (e as Error).message || e);
		}

		try {
			await clickFirst(page, ['button[type=submit]', 'input[type=submit]', 'button:has-text("Check balance")', 'button', 'a.button']);
		} catch (e) {
			console.error('Error clicking submit:', e && (e as Error).message || e);
		}

		try {
			await Promise.race([
				page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }),
				page.waitForSelector('.card-balance, .balance, .balance-amount, .result, .giftcard-balance', { timeout: 3000 }).catch(() => null),
			]).catch(() => null);
		} catch (e) {}

		let balanceStr: string | null = null;
		let balanceNum: number | null = null;
		try {
			const candidates = ['.card-balance', '.balance', '.balance-amount', '.result', '.giftcard-balance'];
			for (const sel of candidates) {
				try {
					const loc = page.locator(sel);
					if ((await loc.count()) > 0) {
						balanceStr = (await loc.first().textContent())?.trim() || null;
						if (balanceStr) break;
					}
				} catch (e) {}
			}
			if (!balanceStr) {
				const html = await page.content();
				const m = html.match(/(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/i);
				if (m) balanceStr = m[0];
			}
			if (balanceStr) {
				const cleaned = balanceStr.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
				const n = parseFloat(cleaned);
				balanceNum = Number.isNaN(n) ? null : n;
			}
		} catch (e) { balanceStr = null; balanceNum = null; }

		const digits = (cardNumber || '').replace(/\D/g, '') || null;
		return {
			balance: balanceNum,
			currency: 'AUD',
			cardNumber: digits,
			expiryDate: null,
			purchases: 0,
			transactions: []
		};
	} finally {
		try {
			if (page) {
				try { if (!page.isClosed()) await page.close(); } catch (e) {}
			}
			try { if (context) await context.close(); } catch (e) {}
			try { if (browser && browser.close) await browser.close(); } catch (e) {}
		} catch (e) {}
	}
}

async function main() {
	const argv: string[] = process.argv.slice(2);
	if (argv.length < 2) {
		console.log('Usage: ts-node goodguy.ts <cardNumber> <pin> [--mode=headed]');
		console.log('No action taken. Press Enter to exit.');
		await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
		return;
	}
	const card = argv[0];
	const pin = argv[1];
	const modeArg = argv.find(a => a.startsWith('--mode='));
	const headless = modeArg ? modeArg.split('=')[1] === 'headless' : false;

	try {
		const details = await GetResult(card, pin, headless);
		if (!details) {
			console.error(JSON.stringify({ error: 'no details returned' }));
			console.log('Press Enter to exit.');
			await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
			return;
		}
		console.log(JSON.stringify(details, null, 2));
	} catch (err) {
		console.error(JSON.stringify({ error: String(err) }));
		console.log('Error occurred. Press Enter to exit.');
		await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
		return;
	}
}

if (require.main === module) main();

