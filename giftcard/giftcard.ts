import { chromium } from 'playwright';
import type { Page, Locator } from 'playwright';
import { launchChrome } from './launch_chrome';

async function findAndFill(page: Page, selectors: string[], value: string) {
  async function Fill(locator: any) {
    const strategies = [
      async (loc: any) => { await loc.type(value, { delay: 20 }); },
    ];

    for (const strat of strategies) {
      try {
        await strat(locator);
        const actual = await locator.inputValue();
        if (actual === value || actual.includes(value)) {
          return true;
        } 
        console.warn(`value mismatch after fill. Expected "${value}", got "${actual}"`);
      } catch (err) {
        const msg = err && ((err as any).message || String(err)) || 'unknown error';
        console.error(`Fill failed — ${msg}`);
      }
    }
    return false;
  }

  async function Find(
    root: Page,
    selector: string,
    options?: {
    timeout?: number;
  }
): Promise<Locator | null> {
  const timeout = options?.timeout ?? 1000;

  try {
    const locator = root.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  } catch {
    console.error(`Not found in root for selector: ${selector}`);
  }
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
  const timeout = options?.timeout ?? 2000;
  const waitAfterClick = options?.waitAfterClick ?? true;

  async function locateFirst(root: Page, selector: string): Promise<Locator | null> {
    try {
      const locator = root.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      return locator;
    } catch {
      console.error(`locateFirst: not found in root for selector: ${selector}`);
    }
    return null;
  }

  for (const sel of selectors) {
    const locator = await locateFirst(page, sel);
    if (!locator) {
      console.warn(`clickFirst: selector not found - ${sel}`);
      continue;
    }

    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout });

      if (waitAfterClick) {
        try {
          await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }),
            locator.waitFor({ state: 'detached', timeout: 2000 }),
          ]);
        } catch {
          console.warn(`clickFirst: no navigation or detachment after clicking "${sel}"`);
        }
      }
      return true;
    } catch (err) {
      console.error(`clickFirst: failed to click selector "${sel}" — ${(err as Error).message}`);
    }
  }
  return false;
}

function parseNumFromString(s: string | null) {
      if (!s) return null;
      const cleaned = s.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
      const n = parseFloat(cleaned);
      return Number.isNaN(n) ? null : n;
} 

function parseDateToIso(s: string | null): string | null {
  if (!s) return null;
  const txt = s.trim().replace(/\s+/g, ' ');
  const direct = new Date(txt);
  if (!isNaN(direct.getTime())) return direct.toISOString();

  const m = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    const second = m[6] ? parseInt(m[6], 10) : 0;
    const utc = Date.UTC(year, month - 1, day, hour, minute, second);
    return new Date(utc).toISOString();
  }

  const alt = txt.replace(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/, '$1/$2/$3');
  const d2 = new Date(alt);
  if (!isNaN(d2.getTime())) return d2.toISOString();

  return null;
}

async function cleanedCellText(locator: any) {
  try {
    return await locator.evaluate((el: HTMLElement) => {
      const hdrs = el.querySelectorAll('.table-responsive-stack-thead');
      let text = el.textContent || '';
      hdrs.forEach(h => { if (h.textContent) text = text.replace(h.textContent, ''); });
      return text.replace(/\s+/g, ' ').trim();
    }) as string || null;
  } catch (e) { return null; }
}

interface Transaction {
  // Original parsed ISO date (kept for compatibility)
  date: string | null;
  // Optional fields aligned with GraphQL `transaction` schema
  transactionId?: string | null;
  transactionTime?: string | null;
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
  purchases: number;
  transactions: Transaction[];
}

const SELECTORS = {
  card: ['#cardNumber', 'input[name*=card]', 'input[placeholder*=Card]'],
  pin: ['#cardPIN', '#pin', 'input[name*=pin]', 'input[placeholder*=PIN]'],
  submit: ['button[type=submit]', 'input[type=submit]', 'button:has-text("Check balance")']
};

const RECAPTCHA_IFRAME = 'iframe[title="reCAPTCHA"]';

const SUBMIT_SELECTORS = [
  'button[type=submit]',
  'input[type=submit]',
  'button:has-text("Check balance")',
  'button',
];

async function launchBrowser(headless: boolean): Promise<{ browser: any, context: any, launchedPid: number | null }> {
  let browser: any = null;
  let context: any = null;
  let launchedPid: number | null = null;
    if (!headless) {
      try {
        const exePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // adjust as needed
        const userDataDir = process.env.PW_USER_DATA || 'C:\\pw-chrome-profile'; // adjust as needed
        try {
          launchedPid = launchChrome(exePath, userDataDir, 9222);
          if (launchedPid) console.log(`Launched Chrome (pid=${launchedPid}), waiting for CDP...`);
        } catch (e) {
          console.error('Error invoking launchChrome:', e);
        }
      } catch (e) {
        console.error('Error preparing to launch Chrome:', e);
      }

      const start = Date.now();
      const timeout = 10000;
      while (Date.now() - start < timeout) {
        try {
          browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
    context = existingContexts && existingContexts.length ? existingContexts[0] : await browser.newContext();
    console.log('Connected to existing browser via CDP (http)');
    return { browser, context, launchedPid };
}

async function fillInputs(page: Page, cardNumber: string, pin: string): Promise<boolean> {
  const filledCard = await findAndFill(page, SELECTORS.card, cardNumber);
  const filledPin = await findAndFill(page, SELECTORS.pin, pin);
  return !!filledCard && !!filledPin;
}

async function highlightRecaptcha(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      if (!document.getElementById('__gc_recaptcha_highlight')) {
        const style = document.createElement('style');
        style.id = '__gc_recaptcha_highlight';
        style.textContent = `
          .__gc_recaptcha_highlight { position: relative !important; box-shadow: 0 0 0 4px rgba(255,165,0,0.95) !important; outline: 4px solid rgba(255,165,0,0.9) !important; z-index: 9999999 !important; transition: box-shadow 0.3s ease; }
          .__gc_recaptcha_pulse { animation: __gc_pulse 1.5s infinite; }
          @keyframes __gc_pulse { 0% { box-shadow: 0 0 0 0 rgba(255,165,0,0.9); } 70% { box-shadow: 0 0 0 8px rgba(255,165,0,0); } 100% { box-shadow: 0 0 0 0 rgba(255,165,0,0); } }
          .__gc_recaptcha_label { position: absolute; top: -28px; left: 0; background: rgba(255,165,0,0.95); color: #000; padding: 4px 8px; font-weight: 600; border-radius: 4px; z-index: 10000000; font-family: sans-serif; font-size: 12px; }
        `;
        document.head.appendChild(style);
      }

      const nodes = Array.from(document.querySelectorAll('iframe[title="reCAPTCHA"]')) as HTMLElement[];
      nodes.forEach((el) => {
        el.classList.add('__gc_recaptcha_highlight', '__gc_recaptcha_pulse');
        if (!el.querySelector('.__gc_recaptcha_label')) {
          const label = document.createElement('div');
          label.className = '__gc_recaptcha_label';
          label.textContent = 'reCAPTCHA — please solve manually';
          const cs = getComputedStyle(el);
          if (cs.position === 'static' || !cs.position) el.style.position = 'relative';
          el.appendChild(label);
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      });
    });
  } catch (e) {
    console.warn('highlightRecaptcha error:', e);
  }
}

async function solveRecaptchaAndSubmit(page: Page): Promise<void> {
  try {
    const hasRecaptcha = await page.$(RECAPTCHA_IFRAME);

    if (hasRecaptcha) {
      console.log('Detected reCAPTCHA on page. Please solve it manually in the browser.');
      await page.bringToFront();
      await highlightRecaptcha(page);
      const timeout = 30 * 1000; 

      const interval = 1000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const ready = await page.$('table.gift-card-summary__tableContent, #transaction-history, .card-balance, .balance, .balance-amount');
        if (ready) 
          break;
        try {
          const solved = await page.evaluate(() => {
            const ta = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
            const token = ta?.value && ta.value.length > 20 ? ta.value : (window as any).grecaptcha?.getResponse?.();
            return !!token;
          });
          if (solved) break;
        } catch {
          console.warn('Error checking reCAPTCHA solved status');
        }
        await new Promise(r => setTimeout(r, interval));
      }
    }
    await clickFirst(page, SUBMIT_SELECTORS);
  } catch (e) {
    console.error('Error in solveRecaptchaAndSubmit:', e);
  }
}

async function extractBalance(page: Page): Promise<{ balance: number | null, expiryDate: string | null }> {
  try {
    const table = page.locator('table.gift-card-summary__tableContent');
    if ((await table.count()) === 0) return { balance: null, expiryDate: null };

    const balanceCell = table.locator('tr:has(th:has-text("Balance:")) td').first();
    const expiryCell = table.locator('tr:has(th:has-text("Expiry Date:")) td').first();

    const balanceText = (await balanceCell.textContent())?.trim() || null;
    const expiryText = (await expiryCell.textContent())?.trim() || null;

    const balance = balanceText ? parseNumFromString(balanceText) : null;
    return { balance, expiryDate: expiryText };
  } catch (e) {
    console.error('extractBalance error:', e);
    return { balance: null, expiryDate: null };
  }
}

async function extractTransactions(page: Page): Promise<Transaction[]> {
  const rows = page.locator('#transaction-history tbody tr');
  const count = await rows.count();
  if (!count) return [];

  const headerCells = await page.$$eval('#transaction-history thead th', ths => ths.map(th => th.textContent?.trim() || ''));
  const colMap = {
    date: headerCells.indexOf('Date'),
    description: headerCells.indexOf('Description'),
    amount: headerCells.indexOf('Amount'),
    balance: headerCells.indexOf('Balance')
  };

  const transactions: Transaction[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const dateText = await cleanedCellText(row.locator('td').nth(colMap.date));
    const descText = await cleanedCellText(row.locator('td').nth(colMap.description));
    const amountText = await cleanedCellText(row.locator('td').nth(colMap.amount));
    const balanceText = await cleanedCellText(row.locator('td').nth(colMap.balance));

    transactions.push({
      date: parseDateToIso(dateText),
      description: descText,
      amount: parseNumFromString(amountText),
      balance: parseNumFromString(balanceText),
      currency: 'AUD'
    });
  }

  return transactions;
}

export async function GetResult(cardNumber: string, pin: string, headless = false) {
  const url = 'https://www.giftcards.com.au/CheckBalance';
  let browser: any = null;
  let launchedPid: number | null = null;
  let connectedOverCDP = false;
  try {
    const { browser: b, context, launchedPid: pid } = await launchBrowser(headless);
    browser = b;
    launchedPid = pid;
    connectedOverCDP = true;
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const filled = await fillInputs(page, cardNumber, pin);
    if (!filled) return null;

    await solveRecaptchaAndSubmit(page);

    await page.waitForURL('**CheckBalance/TransactionHistory**', { timeout: 2000 });

    const { balance, expiryDate } = await extractBalance(page);
    const transactions = await extractTransactions(page);
    const result: GiftCardResult = {
      balance,
      currency: 'AUD',
      cardNumber: cardNumber.replace(/\D/g, '') || null,
      expiryDate,
      purchases: transactions.length,
      transactions
    };
    return result;
  } catch (e) {
    console.error('The Gift Card number or PIN is incorrect.', e);
  } finally {
    try {
      if (browser) {
          if (connectedOverCDP) {
            if ((browser as any).disconnect) {
              await (browser as any).disconnect(); 
            }
            if (launchedPid) {
                const cp = require('child_process');
                cp.execSync(`taskkill /PID ${launchedPid} /T /F`);
            }
          }
      }
    } catch (e) {
      console.error('Error during browser cleanup:', e);
    }
  }
}

async function main() {
  const argv: string[] = process.argv.slice(2);
  if (argv.length < 2) {
    console.log('Usage: ts-node giftcard.ts <cardNumber> <pin>');
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
    return;
  }
  const card = argv[0];
  const pin = argv[1];
  const headless = false;

  try {
    const details = await GetResult(card, pin, headless);
    if (!details) {
      console.error(JSON.stringify({ error: 'no details returned' }));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(details, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exitCode = 1;
    return;
  }
}

if (require.main === module) main();
