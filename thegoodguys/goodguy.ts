import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

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
				// try next
			}
		}
		return false;
	}

	for (const sel of selectors) {
		try {
			const locator = page.locator(sel);
			if ((await locator.count()) > 0) {
				if (await tryFillWithStrategies(locator.first())) return true;
			}
		} catch (e) {}

		try {
			const frames = await page.frames();
			for (const frame of frames) {
				try {
					const locator = frame.locator(sel);
					if ((await locator.count()) > 0) {
						if (await tryFillWithStrategies(locator.first())) return true;
					}
				} catch (ef) {}
			}
		} catch (e) {}
	}
	return false;
}

export async function clickFirst(page: Page, selectors: string[]) {
	for (const sel of selectors) {
		try {
			const locator = page.locator(sel);
			const count = await locator.count();
			if (count > 0) {
				await locator.first().click({ force: true });
				return true;
			}
		} catch (e) {}

		try {
			const frames = await page.frames();
			for (const frame of frames) {
				try {
					const locator = frame.locator(sel);
					const count = await locator.count();
					if (count > 0) {
						await locator.first().click({ force: true });
						return true;
					}
				} catch (ef) {}
			}
		} catch (e) {}
	}
	return false;
}

function extractBalanceFromHtml(html: string) {
	const currencyRegex = /(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/i;
	const m = html.match(currencyRegex);
	return m ? m[0] : null;
}

export async function GetResult(cardNumber: string, pin: string, headless = false) {
	const url = 'https://thegoodguysgiftcards.viisolutions.com.au/';
	let browser: Browser | null = null;
	try {
		browser = await chromium.launch({ channel: 'msedge', headless });
		const context = await browser.newContext({
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
		});
		const page = await context.newPage();
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded' });
		} catch (e) {
			console.error('Navigation error:', e && (e as Error).message || e);
			return null;
		}

		const cardSelectors = ['#CardNumber', '#cardNumber', 'input[name*=card]', 'input[placeholder*=Card]', 'input[placeholder*=card]'];
		const pinSelectors = ['#CardPIN', '#pin', 'input[name*=pin]', 'input[placeholder*=PIN]', 'input[placeholder*=Pin]'];

		try {
			const filledCard = await findAndFill(page, cardSelectors, cardNumber);
			const filledPin = await findAndFill(page, pinSelectors, pin);
			if (!filledCard || !filledPin) {
				console.warn('Could not find card or PIN inputs.');
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
					const timeout = 5 * 60 * 1000;
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
				page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
				page.waitForSelector('.card-balance, .balance, .balance-amount, .result, .giftcard-balance', { timeout: 15000 }).catch(() => null),
			]);
		} catch (e) {}

		const html = await page.content();
		const balanceStr = extractBalanceFromHtml(html);
		let balanceNum: number | null = null;
		if (balanceStr) {
			try {
				const cleaned = balanceStr.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
				const n = parseFloat(cleaned);
				balanceNum = Number.isNaN(n) ? null : n;
			} catch (e) { balanceNum = null; }
		}

		const digits = (cardNumber || '').replace(/\D/g, '') || null;
		return {
			balance: balanceNum,
			currency: balanceStr && /AUD/i.test(balanceStr) ? 'AUD' : (balanceStr && /\$/i.test(balanceStr) ? 'AUD' : 'AUD'),
			raw: balanceStr,
			cardNumber: digits,
			url,
		};
	} finally {
		if (browser) {
			try { await browser.close(); } catch (e) {}
		}
	}
}

async function main() {
	const argv: string[] = process.argv.slice(2);
	if (argv.length < 1) {
		console.log('Usage: ts-node goodguy.ts <cardNumber> <pin?> [--mode=headless|headed]');
		process.exit(1);
	}
	const card = argv[0];
	const pin = argv[1] || '';
	const modeArg = argv.find(a => a.startsWith('--mode='));
	const headless = modeArg ? modeArg.split('=')[1] === 'headless' : false;

	try {
		const details = await GetResult(card, pin, headless);
		if (!details) { console.error(JSON.stringify({ error: 'no details returned' })); process.exit(1); }
		console.log(JSON.stringify(details, null, 2));
	} catch (err) {
		console.error(JSON.stringify({ error: String(err) }));
		process.exit(1);
	}
}

if (require.main === module) main();

