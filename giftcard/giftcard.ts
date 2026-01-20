import { randomBytes } from "crypto";
import { chromium, Page, BrowserContext, Browser, Locator } from "playwright";
import { launchChrome } from './launch_chrome';
const cp = require('child_process');

// --- Shared browser/session management ---
let browserInstance: Browser | null = null;
// Ensure only one browser launch/connect is in-flight at a time
let launchingPromise: Promise<{ browser: any; context: any; launchedPid: number | null; reusedPage?: Page | null } | { browser: null; context: null; launchedPid: number | null; reusedPage: null }> | null = null;
let launchedPidGlobal: number | null = null;
// Shared context to host multiple pages (tabs) within the same browser process.
let sharedContext: BrowserContext | null = null;
const sessionStore = new Map<string, { browser?: any; context: BrowserContext; page: Page; storageState?: any; verified?: boolean; cardNumber?: string | null; launchedPid?: number | null }>();

// Close a single session by object or by key. Deletes sessionStore entry when key is provided/found.
export async function closeSession(sessionOrKey?: any, opts?: { preserveBrowser?: boolean }): Promise<void> {
  const preserveBrowser = opts?.preserveBrowser === true;
    try {
        if (!sessionOrKey) return;
        let s: any = null;
        let keyToDelete: string | null = null;
        if (typeof sessionOrKey === 'string') {
            keyToDelete = sessionOrKey;
            s = sessionStore.get(sessionOrKey);
        } else {
            s = sessionOrKey;
        }
        if (!s) return;

        // Attempt to clear local/session storage and cookies before closing.
        try {
            const page = s.page as Page | undefined;
            const context = s.context as BrowserContext | undefined;
            if (page) {
                try {
                    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
                } catch (_) {}
            }

            if (context && typeof (context as any).clearCookies === 'function') {
                try { await (context as any).clearCookies(); } catch (_) {}
            } else if (page && typeof (page as any).context === 'function') {
                try {
                    // @ts-ignore
                    const client = await (page as any).context().newCDPSession(page);
                    await client.send('Network.clearBrowserCookies');
                    try {
                        await client.send('Storage.clearDataForOrigin', { origin: 'https://portal.australiansuper.com', storageTypes: 'all' });
                    } catch (_) {}
                } catch (_) {}
            }
        } catch (_) {}

        // Close page/context and optionally close browser and kill PID
        try { if (s.page) await s.page.close().catch(() => {}); } catch (_) {}
        try { if (s.context && s.context !== sharedContext) await s.context.close().catch(() => {}); } catch (_) {}

        try {
            // Only close the browser when caller did NOT request preservation.
            // If preserveBrowser === true we will keep the browser running even if the remaining pages are about:blank.
            const shouldCloseBrowser = !preserveBrowser;

            if (s.browser && shouldCloseBrowser) {
                if (s.browser.disconnect) await s.browser.disconnect().catch(() => {});
                else await s.browser.close().catch(() => {});
            } else if (s.browser && !shouldCloseBrowser) {
                // keep browser running; only attempt to disconnect local references
                try { if (s.browser.disconnect) await s.browser.disconnect().catch(() => {}); } catch (_) {}
            }
        } catch (_) {}
        // Do not kill the global browser process when closing individual sessions.
        // The global browser is managed separately via shutdownGlobalBrowserIfNoSessions().

        if (keyToDelete) {
            try { sessionStore.delete(keyToDelete); } catch (_) {}
        } else {
            for (const [k, v] of sessionStore.entries()) {
                if (v === s) { try { sessionStore.delete(k); } catch (_) {} ; break; }
            }
        }
    } catch (_) {}
}

async function launchBrowser(headless = false): Promise<{ browser: any; context: any; launchedPid: number | null; reusedPage?: Page | null }> {
  if (launchingPromise) {
    return launchingPromise as Promise<{ browser: any; context: any; launchedPid: number | null; reusedPage?: Page | null }>;
  }

  launchingPromise = (async () => {
    let browser: any = null;
    let context: any = null;
    let launchedPid: number | null = null;
    let reusedPage: Page | null = null;

    // Try to connect first without launching.
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    } catch (_) {
      browser = null;
    }

    if (browser) {
      try {
        const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
        // Count only non-blank pages (ignore about:blank) across contexts.
        let nonBlankPages = 0;
        for (const c of existingContexts) {
          try {
            const pages = (typeof c.pages === 'function' ? c.pages() : (c.pages || [])) as Page[];
            for (const p of pages) {
              try { const u = p.url(); if (u && u !== 'about:blank') nonBlankPages++; } catch (_) {}
            }
          } catch (_) {}
        }

        // If there are no non-blank pages, treat this browser as unused and close it.
        if (nonBlankPages === 0) {
          try { if (browser.disconnect) await browser.disconnect().catch(() => {}); else await browser.close().catch(() => {}); } catch (_) {}
          browser = null;
        } else {
          // Prefer a context that contains a non-blank page.
          context = existingContexts.find((c: any) => {
            try {
              const pages = (typeof c.pages === 'function' ? c.pages() : (c.pages || [])) as Page[];
              return pages.some((p: Page) => { try { const u = p.url(); return !!u && u !== 'about:blank'; } catch { return false; } });
            } catch { return false; }
          }) || existingContexts[0];
          try { browserInstance = browser; } catch (_) {}
          return { browser, context, launchedPid, reusedPage };
        }
      } catch (e) {
        try { if (browser.disconnect) await browser.disconnect().catch(() => {}); else await browser.close().catch(() => {}); } catch (_) {}
        browser = null;
      }
    }

    // No connected browser — launch Chrome via helper and connect over CDP.
    try {
      const exePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      const userDataDir = process.env.PW_USER_DATA || 'C:\\pw-chrome-profile';
      try {
        launchedPid = launchChrome(exePath, userDataDir, 9222);
        if (launchedPid) {
          launchedPidGlobal = launchedPid;
          console.log(`Launched Chrome (pid=${launchedPid}), waiting for CDP...`);
        }
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

    if (!browser) {
      return { browser: null, context: null, launchedPid, reusedPage: null };
    }

    try {
      const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
      if (existingContexts && existingContexts.length) {
        // Find a context that has a non-blank page; if none, close browser and abort.
        const contextWithNonBlank = existingContexts.find((c: any) => {
          try {
            const pages = (typeof c.pages === 'function' ? c.pages() : (c.pages || [])) as Page[];
            return pages.some((p: Page) => { try { const u = p.url(); return !!u && u !== 'about:blank'; } catch { return false; } });
          } catch { return false; }
        });
        if (!contextWithNonBlank) {
          try { if (browser.disconnect) await browser.disconnect().catch(() => {}); else await browser.close().catch(() => {}); } catch (_) {}
          return { browser: null, context: null, launchedPid, reusedPage: null };
        }
        context = contextWithNonBlank || existingContexts[0];
        try {
          const pages = (typeof context.pages === 'function' ? context.pages() : (context.pages || [])) as Page[];
          if (pages && pages.length) {
            const nonBlank = pages.find(p => { try { const u = p.url(); return !!u && u !== 'about:blank'; } catch { return false; } });
            const blank = pages.find(p => { try { const u = p.url(); return !u || u === 'about:blank'; } catch { return false; } });
            reusedPage = nonBlank || blank || pages[0];
          }
        } catch (_) {}
      } else {
        try { if (browser.disconnect) await browser.disconnect().catch(() => {}); else await browser.close().catch(() => {}); } catch (_) {}
        return { browser: null, context: null, launchedPid, reusedPage: null };
      }
      try { browserInstance = browser; } catch (_) {}
      return { browser, context, launchedPid, reusedPage };
    } catch (e) {
      try { if (browser.disconnect) await browser.disconnect().catch(() => {}); else await browser.close().catch(() => {}); } catch (_) {}
      return { browser: null, context: null, launchedPid, reusedPage: null };
    }
  })();

  try {
    return await launchingPromise as { browser: any; context: any; launchedPid: number | null; reusedPage?: Page | null };
  } finally {
    launchingPromise = null;
  }
}

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
          return false;
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

async function solveRecaptchaAndSubmit(page: Page): Promise<boolean> {
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
    const clicked = await clickFirst(page, SUBMIT_SELECTORS);
    if (!clicked) {
      console.warn('solveRecaptchaAndSubmit: submit click failed or no navigation detected');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error in solveRecaptchaAndSubmit:', e);
    return false;
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

export async function requestSession(cardNumber?: string, pin?: string, headless = false): Promise<{ identifier: string | null; storageState?: any; response?: string }> {
  const { browser: b, context: initialContext, launchedPid, reusedPage } = await launchBrowser(headless);
  browserInstance = b;
  if (!b) {
    // No usable browser available
    return { identifier: null, storageState: null, response: 'fail' };
  }
  // Ensure we have a shared context so every session becomes a separate tab in the same browser.
  if (!sharedContext) {
    if (initialContext) sharedContext = initialContext;
    else if (b && typeof (b as any).newContext === 'function') {
      try { sharedContext = await (b as any).newContext(); } catch { sharedContext = null; }
    }
  }

  const context = sharedContext || initialContext;
  if (!context) {
    // Can't obtain a context to open a page
    return { identifier: null, storageState: null, response: 'fail' };
  }

  // Create a fresh page (tab) inside the shared context so sessions are isolated to tabs.
  let page: Page;
  try {
    page = await context.newPage();
  } catch {
    // Fallback to reusedPage only if new page creation fails
    if (reusedPage) {
      try { page = reusedPage; } catch { return { identifier: null, storageState: null, response: 'fail' }; }
    } else {
      return { identifier: null, storageState: null, response: 'fail' };
    }
  }
  try {
    const url = 'https://www.giftcards.com.au/CheckBalance';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    const filledCard = cardNumber ? await fillInputs(page, cardNumber, pin || '') : false;
    if ((cardNumber && !filledCard)) {
      try { await closeSession({ browser: b, context, page, launchedPid }, { preserveBrowser: true }); } catch (_) {}
      return { identifier: null, storageState: null, response: 'fail' };
    }

    const submitted = await solveRecaptchaAndSubmit(page).catch(() => false);
    if (!submitted) {
      try { await closeSession({ browser: b, context, page, launchedPid }, { preserveBrowser: true }); } catch (_) {}
      return { identifier: null, storageState: null, response: 'fail' };
    }

    await page.waitForURL('**CheckBalance/TransactionHistory**', { timeout: 8000 }).catch(() => null);
    // Detect generic error page that returns a 'Sorry, an error occurred...' message
    try {
      const html = await page.content().catch(() => '');
      if (html && html.indexOf('Sorry, an error occurred while processing your request.') !== -1) {
        try { await closeSession({ browser: b, context, page, launchedPid }, { preserveBrowser: true }); } catch (_) {}
        return { identifier: null, storageState: null, response: 'fail' };
      }
    } catch (_) {}

    const storageState = await context.storageState().catch(() => null);
    const identifier = randomBytes(4).toString('hex');
    sessionStore.set(identifier, { context, page, verified: true, cardNumber: cardNumber ? cardNumber.replace(/\D/g, '') : null, browser: b, launchedPid: launchedPidGlobal });
    return { identifier, storageState, response: 'success' };
  } catch (e) {
    try { await closeSession({ browser: b, context, page, launchedPid }, { preserveBrowser: true }); } catch (_) {}
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
    if (!stored.page) return null;
    const { balance, expiryDate } = await extractBalance(stored.page);
    const txs = await extractTransactions(stored.page);

    const transactions = Array.isArray(txs) ? txs.map((t: any) => ({
      transactionTime: t.transactionTime || null,
      date: t.date || null,
      description: t.description || null,
      amount: typeof t.amount === 'number' ? t.amount : parseNumFromString(t.amount || null),
      balance: typeof t.balance === 'number' ? t.balance : parseNumFromString(t.balance || null),
      currency: t.currency || 'AUD'
    })) : [];

    const result: GiftCardResult = {
      balance: typeof balance === 'number' ? balance : parseNumFromString((balance as any) || null),
      currency: 'AUD',
      cardNumber: stored.cardNumber || null,
      expiryDate: expiryDate || null,
      purchases: Array.isArray(transactions) ? transactions.length : 0,
      transactions
    };

    try { if (result && result.cardNumber == null) result.cardNumber = stored.cardNumber ?? null; } catch (_) {}
    try { await closeSession(stored, { preserveBrowser: true }); } catch (_) {}
    try { sessionStore.delete(identifier); } catch (_) {}
    return result;
  } catch (e) {
    return null;
  }
}

export async function shutdownGlobalBrowserIfNoSessions(): Promise<void> {
  try {
    if (sessionStore.size === 0 && browserInstance) {
      try {
        if ((browserInstance as any).disconnect) await (browserInstance as any).disconnect().catch(() => {});
        else await (browserInstance as any).close().catch(() => {});
      } catch (_) {}

      try {
        if (launchedPidGlobal) {
          cp.execSync(`taskkill /PID ${launchedPidGlobal} /T /F`);
        }
      } catch (e) {
        // ignore kill errors
      }
      browserInstance = null;
      launchedPidGlobal = null;
      sharedContext = null;
      console.log('[shutdown] global browser closed');
    }
  } catch (e) {
    console.error('shutdownGlobalBrowserIfNoSessions error:', e);
  }
}
