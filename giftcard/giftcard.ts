import { chromium } from 'playwright';
import type { Page } from 'playwright';

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

// balance and expiry extraction will be performed directly from the page table

export async function GetResult(cardNumber: string, pin: string, headless = false, keepOpen = false) {
  const url = 'https://www.giftcards.com.au/CheckBalance';
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

    // if (!context) {
    //   // try to find a local Chrome/Edge executable to make the browser more realistic
    //   // Prefer local Chrome executable first, then Edge; allow override via env vars
    //   const possiblePaths = [
    //     process.env.CHROME_PATH,
    //     'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    //     'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    //     process.env.EDGE_PATH,
    //     'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    //     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    //   ].filter(Boolean) as string[];
    //   let exePath: string | undefined;
    //   for (const p of possiblePaths) {
    //     try { const fs = require('fs'); if (fs.existsSync(p)) { exePath = p; break; } } catch (e) {}
    //   }

    //   const launchArgs = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'];

    //     const userDataDir = process.env.PW_USER_DATA || 'C:\\pw-chrome-profile';
    //   if (exePath && !headless) {
    //     // use a persistent context with the real browser executable and a stable user-data-dir
    //     // this preserves cookies/login so running the script directly can use the same session
    //     context = await chromium.launchPersistentContext(userDataDir, {
    //       headless,
    //       executablePath: exePath,
    //       args: launchArgs,
    //       userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    //       viewport: { width: 1280, height: 800 },
    //       locale: 'en-US',
    //       timezoneId: 'Australia/Sydney',
    //       extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' }
    //     });
    //     createdLocalContext = true;
    //   } else {
    //     browser = await chromium.launch({ headless, args: launchArgs, executablePath: exePath });
    //     context = await browser.newContext({
    //       userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    //       viewport: { width: 1280, height: 800 },
    //       locale: 'en-US',
    //       timezoneId: 'Australia/Sydney',
    //       extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' }
    //     });
    //     createdLocalContext = true;
    //   }
    // } else {
    //   console.log('Using existing CDP-connected browser/context; skipping launch.');
    // }

    // // stronger anti-detection init script
    // await context.addInitScript(() => {
    //   try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch (e) {}
    //   try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch (e) {}
    //   try { Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4] }); } catch (e) {}
    //   try { // @ts-ignore
    //     window.chrome = window.chrome || { runtime: {} };
    //   } catch (e) {}
    //   try {
    //     // spoof some hardware properties
    //     // @ts-ignore
    //     Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    //   } catch (e) {}
    //   try {
    //     // @ts-ignore
    //     Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    //   } catch (e) {}
    //   try {
    //     // permissions
    //     const originalQuery = (navigator as any).permissions && (navigator as any).permissions.query;
    //     if (originalQuery) {
    //       // @ts-ignore
    //       navigator.permissions.query = (params) => (
    //         params && params.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : originalQuery(params)
    //       );
    //     }
    //   } catch (e) {}
    //   try {
    //     // @ts-ignore
    //     Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '4g', downlink: 10, rtt: 50 }) });
    //   } catch (e) {}
    // });

    
    page = await context.newPage();
    if (createdLocalContext) {
      try { console.log('Waiting 5s for local browser to initialize...'); } catch (e) {}
      await new Promise(r => setTimeout(r, 5000));
    }
    let gotoResponse: any = null;
    try {
      try {
        gotoResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        console.error('Navigation error (goto):', e && (e as Error).message || e);
      }
      // save diagnostic artifacts for inspection
      // navigation completed; no debug artifacts will be written
    } catch (e) {
      console.error('Navigation error:', e && (e as Error).message || e);
      return null;
    }

    const cardSelectors = ['#cardNumber', 'input[name*=card]', 'input[placeholder*=Card]', 'input[placeholder*=card]'];
    const pinSelectors = ['#cardPIN', '#pin', 'input[name*=pin]', 'input[placeholder*=PIN]', 'input[placeholder*=Pin]'];

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

    // If page has a reCAPTCHA, prompt the user to solve it manually in the opened browser.
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
      await clickFirst(page, ['button[type=submit]', 'input[type=submit]', 'button:has-text("Check balance")', 'button']);
    } catch (e) {
      console.error('Error clicking submit:', e && (e as Error).message || e);
    }

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }),
        page.waitForSelector('.card-balance, .balance, .balance-amount', { timeout: 3000 }).catch(() => null),
      ]);
    } catch (e) {
      // non-fatal
    }

    // try to extract balance and expiry date from the gift card summary table
    let balanceNum: number | null = null;
    let balanceStr: string | null = null;
    let expiryDateStr: string | null = null;
    try {
      const table = page.locator('table.gift-card-summary__tableContent');
      if ((await table.count()) > 0) {
        const balanceCell = table.locator('tr:has(th:has-text("Balance:")) td').first();
        const expiryCell = table.locator('tr:has(th:has-text("Expiry Date:")) td').first();
        try { balanceStr = (await balanceCell.textContent())?.trim() || null; } catch (e) { balanceStr = null; }
        try { expiryDateStr = (await expiryCell.textContent())?.trim() || null; } catch (e) { expiryDateStr = null; }
      }
    } catch (e) {
      balanceStr = null; expiryDateStr = null;
    }

    if (balanceStr) {
      try {
        const cleaned = balanceStr.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
        const n = parseFloat(cleaned);
        balanceNum = Number.isNaN(n) ? null : n;
      } catch (e) { balanceNum = null; }
    }

    // parse transaction history table into transactions array
    let transactions: Array<any> = [];
    try {
      const rows = page.locator('#transaction-history tbody tr');
      const rowCount = await rows.count();
      for (let i = 0; i < rowCount; i++) {
        try {
          const row = rows.nth(i);
          const dateText = await row.locator('td').nth(0).evaluate((el: HTMLElement) => {
            const hdrs = el.querySelectorAll('.table-responsive-stack-thead');
            let text = el.textContent || '';
            hdrs.forEach(h => { if (h.textContent) text = text.replace(h.textContent, ''); });
            return text.replace(/\s+/g, ' ').trim();
          }) as string || null;

          const descText = await row.locator('td').nth(1).evaluate((el: HTMLElement) => {
            const hdrs = el.querySelectorAll('.table-responsive-stack-thead');
            let text = el.textContent || '';
            hdrs.forEach(h => { if (h.textContent) text = text.replace(h.textContent, ''); });
            return text.replace(/\s+/g, ' ').trim();
          }) as string || null;
          // convert dateText (dd/mm/yyyy) to ISO string
          let dateIso: string | null = null;
          if (dateText) {
            const m = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (m) {
              const d = Number(m[1]);
              const mo = Number(m[2]);
              const y = Number(m[3]);
              const dt = new Date(y, mo - 1, d);
              if (!Number.isNaN(dt.getTime())) dateIso = dt.toISOString();
            } else {
              const parsed = Date.parse(dateText);
              if (!Number.isNaN(parsed)) dateIso = new Date(parsed).toISOString();
            }
          }
          const amountText = (await row.locator('td').nth(3).textContent())?.trim() || null;
          const balText = (await row.locator('td').nth(4).textContent())?.trim() || null;
          let amountNum: number | null = null;
          let balNum: number | null = null;
          try { amountNum = parseFloat((amountText || '').replace(/[^0-9.\-]/g, '')); } catch (e) { amountNum = null; }
          try { balNum = parseFloat((balText || '').replace(/[^0-9.\-]/g, '')); } catch (e) { balNum = null; }
          transactions.push({
            date: dateIso || dateText,
            description: descText,
            amount: amountNum,
            balance: balNum,
            currency: (amountText && /AUD|\$/i.test(amountText)) ? 'AUD' : 'AUD'
          });
        } catch (e) {}
      }
    } catch (e) {
      transactions = [];
    }

    const digits = (cardNumber || '').replace(/\D/g, '') || null;
    return {
      balance: balanceNum,
      currency: balanceStr && /AUD/i.test(balanceStr) ? 'AUD' : (balanceStr && /\$/i.test(balanceStr) ? 'AUD' : 'AUD'),
      cardNumber: digits,
      expiryDate: expiryDateStr,
      purchases: transactions.length,
      transactions: transactions
    };
  } finally {
    // close page/context/browser unless user requested to keep open
    try {
      if (page) {
        try { if (!page.isClosed()) await page.close(); } catch (e) {}
      }
      if (!keepOpen) {
        try {
          if (context) await context.close();
        } catch (e) {}
        try {
          if (browser && (browser.close)) await browser.close();
        } catch (e) {}
      } else {
        try { if (context) console.log('Leaving browser/context open for inspection'); } catch (e) {}
      }
    } catch (e) {}
  }
}

async function main() {
  const argv: string[] = process.argv.slice(2);
  if (argv.length < 2) {
    console.log('Usage: ts-node giftcard.ts <cardNumber> <pin> [--mode=headed]');
    console.log('No action taken. Press Enter to exit.');
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
    return;
  }
  const card = argv[0];
  const pin = argv[1];
  const modeArg = argv.find((a: string) => a.startsWith('--mode='));
  const headless = modeArg ? modeArg.split('=')[1] === 'headless' : false;
  const keepOpen = argv.includes('--keep-open');

  try {
    const details = await GetResult(card, pin, headless, keepOpen);
    if (!details) {
      console.error(JSON.stringify({ error: 'no details returned' }));
      console.log('Keeping browser open for inspection. Press Enter to exit.');
      await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
      return;
    }
    console.log(JSON.stringify(details, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    console.log('Error occurred. Keeping browser open for inspection. Press Enter to exit.');
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
    return;
  }
}

if (require.main === module) main();
