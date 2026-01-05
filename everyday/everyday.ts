import { firefox, Browser, Page } from 'playwright';


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
          try { await new Promise(r => setTimeout(r, 150)); } catch (ee) {}
        }
      }
      try {
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

export async function GetResult(cardNumber: string, pin: string, headless: boolean) {
  const url = 'https://www.everyday.com.au/gift-cards/check-balance';
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await firefox.launch({ headless, firefoxUserPrefs: { 'network.http.http2.enabled': false } });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

  const cardSelectors = [
    '#giftCardNumber',
    '#cardNumber',
    'input[name="cardNumber"]',
    'input[name*="card"]',
    'input[placeholder*="Card"]',
    'input[placeholder*="card"]',
  ];

    const pinSelectors = [
      '#access-code',
      '#access_code',
      '#accesscode',
      '#accessCode',
    ];

    const filledCard = await findAndFill(page, cardSelectors, cardNumber);
    const filledPin = await findAndFill(page, pinSelectors, pin);

    if (!filledCard || !filledPin) {
      console.warn('Could not find card number and/or PIN inputs automatically.');
      return null;
    }

    const buttonSelectors = [
    'button:has-text("Check balance")',
    'button:has-text("Check Balance")',
  ];

    const clicked = await clickFirst(page, buttonSelectors);
    if (!clicked) {
      console.warn('Could not find a check balance button to click.');
      return null;
    }

    // helper functions reused by both DOM-extraction and HTML-fallback
    function parseCurrencyToNumber(s: any) {
      if (s === null || s === undefined) return NaN;
      try {
        const str = String(s);
        const parenNeg = /\([^)]*\)/.test(str) && !/\-/.test(str);
        const cleaned = str.replace(/[^0-9.\-]/g, '').replace(/,/g, '');
        let n = parseFloat(cleaned);
        if (isNaN(n)) return NaN;
        if (parenNeg) n = -n;
        return n;
      } catch (e) { return NaN; }
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
      let balNum = parseCurrencyToNumber(balStr);
      if (Number.isNaN(balNum)) return obj;
      const tx = obj.transactions.slice();
      tx[0].balance = formatCurrency(balNum, balStr);
      for (let i = 1; i < tx.length; i++) {
        const prevAmount = parseCurrencyToNumber(tx[i - 1].amount);
        if (Number.isNaN(prevAmount)) {
          tx[i].balance = null;
        } else {
          balNum = balNum + prevAmount;
          tx[i].balance = formatCurrency(balNum, balStr);
        }
      }
      obj.transactions = tx;
      return obj;
    }

    function transformResult(obj: any) {
      if (!obj) return null;
      const balNum = parseCurrencyToNumber(obj.balance);

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
        } catch (e) {
          return null;
        }
      }

      const txs = Array.isArray(obj.transactions) ? obj.transactions.map((t: any) => ({
        date: t && t.date ? parseDateToIso(String(t.date)) : null,
        description: t && t.description ? String(t.description) : null,
        amount: t && t.amount ? parseCurrencyToNumber(t.amount) : null,
        balance: t && t.balance ? parseCurrencyToNumber(t.balance) : null,
        currency: 'AUD',
      })) : [];

      let cardStr: string | null = null;
      try {
        const digits = String(cardNumber || '').replace(/\D/g, '');
        cardStr = digits.length ? digits : null;
      } catch (e) { cardStr = null; }

      const purchasesCount = Array.isArray(txs) ? txs.length : (typeof obj.purchases === 'number' ? Math.floor(obj.purchases) : null);
      const expiry = obj.expiryDate ? parseDateToIso(obj.expiryDate) : null;

      return {
        balance: Number.isNaN(balNum) ? null : balNum,
        currency: 'AUD',
        cardNumber: cardStr,
        expiryDate: expiry,
        purchases: purchasesCount,
        transactions: txs,
      };
    }

    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      let balance: string | null = null;
      let purchases: string | null = null;
      let cardNumber: string | null = null;
      let expiryDate: string | null = null;
      let transactions: Array<{date: string | null, description: string | null, amount: string | null}> = [];
      const start = Date.now();
      while (Date.now() - start < 20000) {
        await page.waitForTimeout(500);
        const html = await page.content();
        // inline currency extraction (replacing removed extractBalanceFromHtml)
        const _currencyRegex = /(?:AUD|\$)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/gi;
        const _matches = html.match(_currencyRegex);
        balance = _matches ? _matches[0] : null;

        if (!cardNumber) {
          const cm = html.match(/\b\d{15,19}\b/);
          if (cm) cardNumber = cm[0].trim();
          if (!cardNumber) {
            const ariaCard = html.match(/aria-label=["'][^"']*gift\s*card(?:\s*number)?[^"']*(\d{15,19})/i);
            if (ariaCard) cardNumber = ariaCard[1].trim();
          }
        }

        if (!expiryDate) {
          // try bolded expiry, aria-label, or inline text (No expiry | mm/yy | full date)
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

        // transactions: looser, less brittle patterns
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
        } catch (e) {
          transactions = [];
        }

        if (balance || purchases || cardNumber || expiryDate || transactions.length) break;
      }
      
      const raw = attachBalances({ balance, cardNumber, expiryDate, purchases, transactions });
      return transformResult(raw);
    } catch (err) {
      throw new Error('Failed to extract gift card details: ' + String(err));
    }
  } finally {
    if (browser) {
      try { 
        await browser.close();
      } catch (e) { }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.log('Usage: ts-node everyday.ts <cardNumber> <pin> [--mode=headless|headed]');
    process.exit(1);
  }
  const card = argv[0];
  const pin = argv[1];
  const modeArg = argv.find(a => a.startsWith('--mode='));
  const headless = modeArg ? modeArg.split('=')[1] === 'headless' : false;
  try {
    const details = await GetResult(card, pin, headless);
    if (!details) {
      console.error(JSON.stringify({ error: 'no details returned' }));
      process.exit(1);
    }
    console.log(JSON.stringify(details, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}

if (require.main === module) main();
