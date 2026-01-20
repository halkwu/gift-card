import { chromium, Browser, BrowserContext, Locator, Page } from 'playwright';
import { randomBytes } from 'crypto';

interface Transaction {
  // raw extraction may use `date`; normalized output uses `transactionTime`
  transactionTime?: string | null;
  date?: string | null;
  description: string | null;
  amount: number | null;
  balance: number | null;
  currency: string;
}

interface GiftCardResult {
  balance: number | null;
  currency: string;
  cardNumber: string | null;
  expiryDate: string | null;
  purchases: number | null;
  transactions: Transaction[];
}

const SELECTORS = {
  card: ['#giftCardNumber', '#cardNumber', 'input[name="cardNumber"]', 'input[name*="card"]', 'input[placeholder*="Card"]', 'input[placeholder*="card"]'],
  pin: ['#access-code', '#access_code', '#accesscode', '#accessCode'],
  submit: ['button:has-text("Check balance")', 'button:has-text("Check Balance")']
};

async function findAndFill(page: Page, selectors: string[], value: string) {
  async function Fill(locator: any) {
    const strategies = [
      async (loc: any) => { await loc.fill(value); },
    ];

    for (const strat of strategies) {
      try {
        await strat(locator);
        const actual = await locator.inputValue().catch(() => null);
        if (actual === value || (typeof actual === 'string' && actual.includes(value))) return true;
      } catch (err) {
        console.error('Fill strategy error:', err);
      }
    }
    return false;
  }

  async function Find(root: Page, selector: string): Promise<Locator | null> {
    try {
      const locator = root.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 300 });
      return locator;
    } catch {}
    try {
      for (const f of (root as any).frames ? (root as any).frames() : []) {
        try {
          const locator = f.locator(selector).first();
          if (await locator.count() > 0) return locator;
        } catch {}
      }
    } catch {}
    return null;
  }

  for (const sel of selectors) {
    const locator = await Find(page, sel);
    if (locator) {
      if (await Fill(locator)) return true;
    }
  }
  return false;
}

async function clickFirst(
  page: Page,
  selectors: string[],
  options?: { timeout?: number; waitAfterClick?: boolean }
): Promise<boolean> {
  const timeout = options?.timeout ?? 800;
  const waitAfterClick = options?.waitAfterClick ?? true;

  async function locateFirst(root: Page, selector: string): Promise<Locator | null> {
    try {
      const locator = root.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      return locator;
    } catch {
      console.error(`Locator not found for selector: ${selector}`);
    }
    return null;
  }

  for (const sel of selectors) {
    const locator = await locateFirst(page, sel);
    if (!locator) continue;
    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout }).catch(() => null);

      if (waitAfterClick) {
        try {
          await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 1000 }).catch(() => null),
            locator.waitFor({ state: 'detached', timeout: 1000 }).catch(() => null),
          ]);
        } catch {
          console.error('Error during wait after click');
        }
      }
      return true;
    } catch (err) {
      console.error('Click error:', err);
    }
  }
  return false;
}

function parseNumFromString(s: string | null) {
  if (!s) return null;
  const parenNeg = /\([^)]*\)/.test(s) && !/\-/.test(s);
  const cleaned = String(s).replace(/[^0-9.\-]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return parenNeg ? -n : n;
}

function parseDateToIso(s: any): string | null {
  if (!s) return null;
  try {
    const str = String(s).trim();
    if (/no expiry/i.test(str)) return 'No expiry';
    const mmYY = str.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
    if (mmYY) {
      let month = parseInt(mmYY[1], 10);
      let year = parseInt(mmYY[2], 10);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      const d = new Date(Date.UTC(year, month - 1, 1));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

function formatCurrency(n: number, sample?: string) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  const useAUD = sample && /AUD/i.test(sample);
  const symbol = useAUD ? 'AUD ' : (sample ? (sample.match(/^[^0-9\s]*/)||[''])[0] : '$');
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return (n < 0 ? '-' : '') + symbol + formatted;
}

function attachBalances(obj: any) {
  if (!obj || !Array.isArray(obj.transactions) || obj.transactions.length === 0) return obj;
  const balStr = obj.balance || null;
  let balNum = parseNumFromString(balStr as string | null);
  if (balNum === null) return obj;
  const tx = obj.transactions.slice();
  tx[0].balance = formatCurrency(balNum, balStr);
  for (let i = 1; i < tx.length; i++) {
    const prevAmount = parseNumFromString(tx[i - 1].amount as unknown as string);
    if (prevAmount === null) {
      tx[i].balance = null;
    } else {
      balNum = (balNum as number) + prevAmount;
      tx[i].balance = formatCurrency(balNum as number, balStr);
    }
  }
  obj.transactions = tx;
  return obj;
}

// --- Shared browser/session management ---
let browserInstance: Browser | null = null;
const sessionStore = new Map<string, { context: BrowserContext; page: Page; verified?: boolean; cardNumber?: string | null }>();

async function ensureBrowser(headless = true): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless });
    process.on('exit', async () => {
      try { await browserInstance?.close(); } catch (_) {}
    });
  }
  return browserInstance;
}

function transformResult(obj: any): GiftCardResult | null {
  if (!obj) return null;
  const balNum = parseNumFromString(obj.balance || null);
  const txs = Array.isArray(obj.transactions) ? obj.transactions.map((t: any) => ({
    transactionTime: t && (t.transactionTime || t.date) ? parseDateToIso(String(t.transactionTime || t.date)) : null,
    description: t && t.description ? String(t.description) : null,
    amount: t && t.amount ? parseNumFromString(String(t.amount)) : null,
    balance: t && t.balance ? parseNumFromString(String(t.balance)) : null,
    currency: 'AUD'
  })) : [];

  let cardStr: string | null = null;
  try { cardStr = obj.cardNumber != null ? String(obj.cardNumber) : null; } catch { cardStr = null; }

  const purchasesCount = Array.isArray(txs) ? txs.length : (typeof obj.purchases === 'number' ? Math.floor(obj.purchases) : null);
  const expiry = obj.expiryDate ? parseDateToIso(obj.expiryDate) : null;
  const result: GiftCardResult = {
    balance: balNum === null ? null : balNum,
    currency: 'AUD',
    cardNumber: cardStr,
    expiryDate: expiry,
    purchases: purchasesCount,
    transactions: txs,
  };
  return result;
}

async function extractRawFromPage(page: Page): Promise<any> {
  let balance: string | null = null;
  let purchases: string | null = null;
  let cardNum: string | null = null;
  let expiryDate: string | null = null;
  let transactions: Array<any> = [];
  const start = Date.now();
  while (Date.now() - start < 20000) {
    await page.waitForTimeout(500);
    const html = await page.content();
    const _currencyRegex = /(?:AUD|\$)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/gi;
    const _matches = html.match(_currencyRegex);
    balance = _matches ? _matches[0] : null;

    if (!cardNum) {
      const cm = html.match(/\b\d{15,19}\b/);
      if (cm) cardNum = cm[0].trim();
      if (!cardNum) {
        const ariaCard = html.match(/aria-label=["'][^"']*gift\s*card(?:\s*number)?[^"']*(\d{15,19})/i);
        if (ariaCard) cardNum = ariaCard[1].trim();
      }
    }

    if (!expiryDate) {
      const bHtmlMatch = html.match(/<b[^>]*>(No expiry|Expires?|Expiry[:\s]*[^\<]+|\d{1,2}[\/\-]\d{2,4})<\/b>/i);
      if (bHtmlMatch) expiryDate = bHtmlMatch[1].trim();
      if (!expiryDate) {
        const anyExp = html.match(/(?:No expiry|Expires?:\s*\d{1,2}\/\d{2,4}|Expiry(?: date)?:\s*[^<\n\r]+)/i);
        if (anyExp) expiryDate = anyExp[0].replace(/Expiry date:?|Expiry:?|Expires?:?|is:?/ig, '').trim();
      }
      if (!expiryDate) {
        const ariaExp = html.match(/aria-label=["'][^"']*expiry date[^"']*(?:is|:)?\s*([^"']+)["']/i);
        if (ariaExp) expiryDate = ariaExp[1].trim();
      }
      if (expiryDate && /no expiry/i.test(expiryDate)) expiryDate = 'No expiry';
    }

    if (!purchases) {
      const pm = html.match(/Total purchases to date[:\s]*((?:AUD|\$)?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
                || html.match(/<span[^>]*class=["'][^"']*purchasesSectionValue[^"']*["'][^>]*>([^<]+)<\/span>/i);
      if (pm) purchases = pm[1] ? pm[1].trim() : pm[0].trim();
    }

    transactions = [];
    try {
      const dateRegex = /<[^>]*class=["'][^"']*transactionDate[^"']*["'][^>]*>\s*([^<]+)\s*<\/[^>]+>/gi;
      const itemRegex = /<[^>]*class=["'][^"']*transactionItem[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*core-body[^"']*["'][^>]*>\s*([^<]+)\s*<\/span>[\s\S]*?<span[^>]*class=["'][^"']*core-title[^"']*["'][^>]*>\s*([^<]+)\s*<\/span>/gmi;
      const dates: Array<{date: string, idx: number}> = [];
      let m: RegExpExecArray | null;
      while ((m = dateRegex.exec(html)) !== null) dates.push({ date: m[1].trim(), idx: m.index });
      const items: Array<{desc: string, amount: string, idx: number}> = [];
      while ((m = itemRegex.exec(html)) !== null) items.push({ desc: m[1].trim(), amount: m[2].trim(), idx: m.index });
      for (const it of items) {
        const d = dates.filter(dd => dd.idx < it.idx).pop();
        transactions.push({ date: d ? d.date : null, description: it.desc, amount: it.amount });
      }
    } catch (e) { console.error('Transaction extraction error:', e); }

    if (balance || purchases || cardNum || expiryDate || transactions.length) break;
  }

  return { balance, cardNumber: cardNum, expiryDate, purchases, transactions };
}

export async function requestSession(cardNumber?: string, pin?: string, headless = false): Promise<{ identifier: string | null; storageState?: any; response?: string }> {
  const browser = await ensureBrowser(headless);
	const context = await browser.newContext();
	const page = await context.newPage();
  try {
    const url = 'https://www.everyday.com.au/gift-cards/check-balance';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    const filledCard = cardNumber ? await findAndFill(page, SELECTORS.card, cardNumber) : false;
    const filledPin = pin ? await findAndFill(page, SELECTORS.pin, pin) : false;
    if ((cardNumber && !filledCard) || (pin && !filledPin)) {
      await context.close().catch(() => {});
      return { identifier: null, storageState: null, response: 'fail' };
    }

    await clickFirst(page, SELECTORS.submit).catch(() => {});
    const navigated = await page.waitForURL('**/gift-cards/check-balance-result**', { timeout: 8000 }).then(() => true).catch(() => false);

    if (!navigated) {
      // If the page didn't navigate to the expected result URL, treat as failure.
      await context.close().catch(() => {});
      return { identifier: null, storageState: null, response: 'fail' };
    }

    const storageState = await context.storageState().catch(() => null);
    const identifier = randomBytes(4).toString('hex');
    sessionStore.set(identifier, { context, page, verified: true, cardNumber: cardNumber ?? null });
    return { identifier, storageState, response: 'success' };
  } catch (e) {
    await context.close().catch(() => {});
    return { identifier: null, storageState: null, response: 'fail' };
  }
}

export async function queryWithSession(storageIdentifier: any): Promise<GiftCardResult | null> {
  if (!storageIdentifier) return null;

		let identifier: string | undefined;
		if (typeof storageIdentifier === 'string') {
			identifier = storageIdentifier;
		} else if (typeof storageIdentifier === 'object' && storageIdentifier !== null && typeof storageIdentifier.identifier === 'string') {
			identifier = storageIdentifier.identifier;
		} else {
			return null;
		}

		if (!identifier || !sessionStore.has(identifier)) return null;
		const stored = sessionStore.get(identifier) as any;
		if (!stored || stored.verified !== true) return null;
    const page = stored.page;
      await page.bringToFront?.().catch(() => {});
    try {
      const raw = await extractRawFromPage(page);
      const rawWithBalances = attachBalances(raw);
      try { rawWithBalances.cardNumber = stored.cardNumber ?? rawWithBalances.cardNumber; } catch {}
      const result = transformResult(rawWithBalances);
      await stored.context.close().catch(() => {});
      try { sessionStore.delete(identifier); } catch (_) {}
      return result;
    } catch (e) {
      return null;
    }
  }

// async function main() {
//   const argv: string[] = process.argv.slice(2);
//   if (argv.length < 2) {
//     console.log('Usage: ts-node everyday.ts <cardNumber> <pin> [--mode=headless|headed]');
//     await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
//     return;
//   }
//   const card = argv[0];
//   const pin = argv[1];
//   const modeArg = argv.find(a => a.startsWith('--mode='));
//   const headless = modeArg ? modeArg.split('=')[1] === 'headless' : false;

//   try {
//     const details = await GetResult(card, pin, headless);
//     if (!details) {
//       console.error(JSON.stringify({ error: 'no details returned' }));
//       process.exitCode = 1;
//       return;
//     }
//     console.log(JSON.stringify(details, null, 2));
//   } catch (err) {
//     console.error(JSON.stringify({ error: String(err) }));
//     process.exitCode = 1;
//     return;
//   }
// }

// if (require.main === module) main();
