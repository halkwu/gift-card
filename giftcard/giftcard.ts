import { chromium, Browser } from 'playwright';

async function twoCaptchaSolve(apiKey: string, siteKey: string, pageUrl: string) {
	const inUrl = `http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
	const inResp = await fetch(inUrl, { method: 'GET' }).then(r => r.json());
	if (!inResp || inResp.status !== 1) throw new Error('2captcha submit failed: ' + JSON.stringify(inResp));
	const requestId = inResp.request;
	const resUrl = `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}&json=1`;
	for (let i = 0; i < 60; i++) {
		await new Promise(r => setTimeout(r, 5000));
		const res = await fetch(resUrl, { method: 'GET' }).then(r => r.json());
		if (res.status === 1) return res.request;
		if (res.request && res.request.includes('ERROR')) throw new Error('2captcha error: ' + res.request);
	}
	throw new Error('2captcha timed out');
}

function extractBalanceFromHtml(html: string) {
	const currencyRegex = /(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
	const matches = html.match(currencyRegex);
	if (!matches) return null;
	return matches[0];
}

async function checkBalance(cardNumber: string, pin: string, opts: { mode: string; twoCaptchaKey?: string }) {
	const url = 'https://www.giftcards.com.au/CheckBalance';
	const browser: Browser = await chromium.launch({ headless: opts.mode === '2captcha' });
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(url, { waitUntil: 'domcontentloaded' });

	await page.fill('#cardNumber', cardNumber);
	await page.fill('#cardPIN', pin);

	const siteKey = await page.$eval('.g-recaptcha', el => (el as HTMLElement).getAttribute('data-sitekey')).catch(() => null);

	if (opts.mode === '2captcha') {
		if (!opts.twoCaptchaKey) throw new Error('2Captcha API key required for mode=2captcha');
		if (!siteKey) throw new Error('sitekey not found on page');
		console.log('Requesting 2Captcha token...');
		const token = await twoCaptchaSolve(opts.twoCaptchaKey, siteKey, url);
		console.log('2Captcha token received, injecting into page...');
		await page.evaluate((tk: string) => {
			let ta = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
			if (!ta) {
				ta = document.createElement('textarea');
				ta.id = 'g-recaptcha-response';
				ta.name = 'g-recaptcha-response';
				ta.style.display = 'none';
				document.body.appendChild(ta);
			}
			ta.value = tk;
		}, token);
		await page.click('button[type=submit]');
	} else {
		console.log('Manual mode: please solve the reCAPTCHA in the opened browser, then press Enter here to continue.');
		await page.bringToFront();
		await new Promise<void>((resolve) => {
			process.stdin.resume();
			process.stdin.once('data', () => {
				process.stdin.pause();
				resolve();
			});
		});
		await page.click('button[type=submit]');
	}

	try {
		await Promise.race([
			page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
			page.waitForSelector('.card-balance, .balance, .balance-amount', { timeout: 15000 }).catch(() => null),
		]);
	} catch (e) {
	}

	const html = await page.content();
	const balance = extractBalanceFromHtml(html);
	await browser.close();
	return balance;
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length < 2) {
		console.log('Usage: node giftcard.ts <cardNumber> <pin> [--mode=manual|2captcha] [--key=APIKEY]');
		process.exit(1);
	}
	const card = argv[0];
	const pin = argv[1];
	const opts: any = { mode: 'manual' };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i].startsWith('--mode=')) opts.mode = argv[i].split('=')[1];
		if (argv[i].startsWith('--key=')) opts.twoCaptchaKey = argv[i].split('=')[1];
	}

	try {
		const balance = await checkBalance(card, pin, opts);
		if (balance) console.log('Balance found:', balance);
		else console.log('Balance not found. Page content may have changed or captcha not solved.');
	} catch (err) {
		console.error('Error:', err);
	}
}

if (require.main === module) main();
