import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { launchChrome } from './launch_chrome';

declare const process: any;
declare const require: any;
declare const module: any;

async function findAndFill(page: Page, selectors: string[], value: string) {
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

async function clickFirst(page: Page, selectors: string[]) {
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
      // Try a set of click strategies to handle flaky buttons
      const strategies = [
        async (loc: any) => { await loc.scrollIntoViewIfNeeded(); await loc.click({ force: true }); },
        async (loc: any) => { await loc.evaluate((el: HTMLElement) => (el as HTMLElement).click()); },
        async (loc: any) => { await loc.focus(); await page.keyboard.press('Enter'); },
        async (loc: any) => { await loc.click(); },
      ];
      for (const strat of strategies) {
        try {
          await strat(locator);
          return true;
        } catch (e) {
          // small delay before next strategy
          try { await new Promise(r => setTimeout(r, 150)); } catch (ee) {}
        }
      }
      // final fallback: try clicking via page-level querySelector
      try {
        const selText = selectors.join(', ');
        await page.evaluate((s) => {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el) el.click();
        }, sel);
        return true;
      } catch (e) {}
    }
  }
  return false;
}

function parseNumFromString(s: string | null) {
      if (!s) return null;
      try {
        const cleaned = s.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
        const n = parseFloat(cleaned);
        return Number.isNaN(n) ? null : n;
      } catch (e) { return null; }
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

// balance and expiry extraction will be performed directly from the page table
export async function GetResult(cardNumber: string, pin: string, headless = false) {
  const url = 'https://www.giftcards.com.au/CheckBalance';
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  let connectedOverCDP = false;
  let launchedPid: number | null = null;
  try {
    // If not running in headless mode, try to launch a local Chrome with remote-debugging enabled
    if (!headless) {
      try {
        const exePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const userDataDir = process.env.PW_USER_DATA || 'C:\\pw-chrome-profile';
        try {
          launchedPid = launchChrome(exePath, userDataDir, 9222);
          if (launchedPid) console.log(`Launched Chrome (pid=${launchedPid}), waiting for CDP...`);
          else console.log('launchChrome returned no pid; attempting to connect to CDP.');
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
          connectedOverCDP = true;
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    const existingContexts = (browser as any).contexts ? (browser as any).contexts() : [];
    context = existingContexts && existingContexts.length ? existingContexts[0] : await browser.newContext();
    console.log('Connected to existing browser via CDP (http)');

    page = await context.newPage();
    let gotoResponse: any = null;
    try {
      try {
        gotoResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        console.error('Navigation error (goto):', e && (e as Error).message || e);
      }
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

        // inject visual highlight and label for reCAPTCHA elements to help manual solving
        try {
          await page.evaluate(() => {
            try {
              if (!document.getElementById('__gc_recaptcha_highlight')) {
                const style = document.createElement('style');
                style.id = '__gc_recaptcha_highlight';
                style.textContent = '\n.__gc_recaptcha_highlight { position: relative !important; box-shadow: 0 0 0 4px rgba(255,165,0,0.95) !important; outline: 4px solid rgba(255,165,0,0.9) !important; z-index: 9999999 !important; transition: box-shadow 0.3s ease; }\n.__gc_recaptcha_pulse { animation: __gc_pulse 1.5s infinite; }\n@keyframes __gc_pulse { 0% { box-shadow: 0 0 0 0 rgba(255,165,0,0.9); } 70% { box-shadow: 0 0 0 8px rgba(255,165,0,0); } 100% { box-shadow: 0 0 0 0 rgba(255,165,0,0); } }\n.__gc_recaptcha_label { position: absolute; top: -28px; left: 0; background: rgba(255,165,0,0.95); color: #000; padding: 4px 8px; font-weight: 600; border-radius: 4px; z-index: 10000000; font-family: sans-serif; font-size: 12px; }\n';
                document.head.appendChild(style);
              }
            } catch (e) {}
            const nodes = Array.from(document.querySelectorAll('.g-recaptcha, iframe[src*="recaptcha"]'));
            nodes.forEach((el, idx) => {
              try {
                const he = el as HTMLElement;
                he.classList.add('__gc_recaptcha_highlight', '__gc_recaptcha_pulse');
                try {
                  if (!he.querySelector('.__gc_recaptcha_label')) {
                    const label = document.createElement('div');
                    label.className = '__gc_recaptcha_label';
                    label.textContent = 'reCAPTCHA — please solve';
                    // ensure the container can position the label
                    const cs = getComputedStyle(he);
                    if (cs.position === 'static' || !cs.position) he.style.position = 'relative';
                    he.appendChild(label);
                  }
                } catch (e) {}
                try { he.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); } catch (e) {}
              } catch (e) {}
            });
          });
        } catch (e) {}

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
        else 
          console.log('reCAPTCHA solved; submitting form...');
          await clickFirst(page, ['button[type=submit]', 'input[type=submit]', 'button:has-text("Check balance")', 'button']);
      }
    } catch (e) {
      console.error('Error handling reCAPTCHA detection:', e && (e as Error).message || e);
    }

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }),
        page.waitForSelector('.card-balance, .balance, .balance-amount', { timeout: 3000 }).catch(() => null),
      ]);
    } catch (e) {
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
          const dateText = await cleanedCellText(row.locator('td').nth(0));
          const descText = await cleanedCellText(row.locator('td').nth(1));
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
          const amountNum = parseNumFromString(amountText);
          const balNum = parseNumFromString(balText);
          transactions.push({
            date: dateIso || dateText,
            description: descText,
            amount: amountNum,
            balance: balNum,
            currency: 'AUD'
          });
        } catch (e) {}
      }
    } catch (e) {
      transactions = [];
    }

    const digits = (cardNumber || '').replace(/\D/g, '') || null;
    return {
      balance: balanceNum,
      currency: 'AUD',
      cardNumber: digits,
      expiryDate: expiryDateStr,
      purchases: transactions.length,
      transactions: transactions
    };
  } finally {
    try {
      if (browser) {
          if (connectedOverCDP) {
            if ((browser as any).disconnect) {
              await (browser as any).disconnect(); 
            }
            if (launchedPid) {
              try {
                const cp = require('child_process');
                cp.execSync(`taskkill /PID ${launchedPid} /T /F`);
              } catch (e) {}
            }
          }
      }
    } catch (e) {}
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
      await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
      return;
    }
    console.log(JSON.stringify(details, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once('data', () => resolve()); });
    return;
  }
}

if (require.main === module) main();
