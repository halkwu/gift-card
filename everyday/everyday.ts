import { firefox, Browser, Page } from 'playwright';


export async function findAndFill(page: Page, selectors: string[], value: string) {
  // unified small helpers to try several strategies against a locator
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

  // search on page and inside frames for the first matching selector
  for (const sel of selectors) {
    // try main page
    try {
      const locator = page.locator(sel);
      if ((await locator.count()) > 0) {
        if (await tryFillWithStrategies(locator.first())) return true;
      }
    } catch (e) {
      // ignore and try frames
    }

    // try frames
    try {
      const frames = await page.frames();
      for (const frame of frames) {
        try {
          const locator = frame.locator(sel);
          if ((await locator.count()) > 0) {
            if (await tryFillWithStrategies(locator.first())) return true;
          }
        } catch (ef) {
          // ignore and continue
        }
      }
    } catch (e) {
      // ignore
    }
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
    } catch (e) {
    }

    // try frames
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
        } catch (ef) {
        }
      }
    } catch (e) {
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
      '#giftCardPin',
      '#cardPIN',
      '#pin',
      'input[name*="pin"]',
      'input[placeholder*="PIN"]',
      'input[placeholder*="Pin"]',
      '#access-code',
      '#access_code',
      '#accesscode',
      '#accessCode',
      '#access',
      '#code',
      'input[name*="access"]',
      'input[name*="code"]',
      'input[placeholder*="Access"]',
      'input[placeholder*="access"]',
      'input[placeholder*="Code"]',
      'input[placeholder*="code"]',
      'input[aria-label*="access"]',
      'input[aria-label*="code"]',
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
    'button[type="submit"]',
    'input[type="submit"]',
    'button',
  ];

    const clicked = await clickFirst(page, buttonSelectors);
    if (!clicked) {
      console.warn('Could not find a check balance button to click.');
      return null;
    }

    // Wait for the specific result container and extract details from it
    const resultSelector = 'div.gift-card-balance-result-component_giftCardBalnceSection__sQJ__';

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
      const useDollar = sample && /\$/.test(sample);
      const symbol = useAUD ? 'AUD ' : (useDollar ? '$' : (sample ? (sample.match(/^[^0-9\s]*/)||[''])[0] : '$'));
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

    try {
      const locator = page.locator(resultSelector).first();
      await locator.waitFor({ timeout: 7000 });
      const details = await locator.evaluate((el: HTMLElement) => {
        const text = (el.innerText || el.textContent || '').trim();
        const balanceMatch = text.match(/(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/i);
        const cardMatch = text.match(/\b\d{15,19}\b/);
        const expiryMatch = text.match(/(No expiry|No Expiry|No expiry date|Expires?:?\s*\d{1,2}\/\d{2,4}|Expiry date:?\s*.+)/i);
        // Prefer aria-label values when available (some sites include 'is' in aria-label)
        let cardFromAria: string | null = null;
        try {
          const cardAriaEl = el.querySelector('[aria-label*="Gift card number"], [aria-label*="gift card number"]');
          if (cardAriaEl) {
            const al = (cardAriaEl.getAttribute('aria-label') || '').trim();
            const cm = al.match(/\b\d{15,19}\b/);
            if (cm) cardFromAria = cm[0].trim();
          }
        } catch (e) {
          cardFromAria = null;
        }
        let expiryFromAria: string | null = null;
        try {
          const expAriaEl = el.querySelector('[aria-label*="Expiry date"], [aria-label*="expiry date"]');
          if (expAriaEl) {
            const al = (expAriaEl.getAttribute('aria-label') || '').trim();
            const m = al.match(/(?:is|:)\s*(.+)$/i);
            if (m) expiryFromAria = m[1].trim();
            else if (/no expiry/i.test(al)) expiryFromAria = 'No expiry';
          }
        } catch (e) {
          expiryFromAria = null;
        }
        // Prefer the content inside a <b> element if present (e.g. <b>No expiry</b>)
        let expiryBText: string | null = null;
        try {
          const bEl = el.querySelector('[aria-label*="Expiry date"] b') || el.querySelector('[aria-label*="expiry date"] b') || Array.from(el.querySelectorAll('div,section,span')).map(n => n.querySelector('b')).find(x => x && /expiry date/i.test((x.parentElement && x.parentElement.textContent) || '')) || null;
          if (bEl) expiryBText = (bEl.textContent || '').trim();
        } catch (e) {
          expiryBText = null;
        }
        // Try to extract 'Total purchases to date' from known child containers or span
        let purchases: string | null = null;
        try {
          const purchSpan = el.querySelector('.gift-card-balance-result_component_purchasesSectionValue__FipjX');
          if (purchSpan) {
            purchases = (purchSpan.textContent || '').trim();
          }
          if (!purchases) {
            const purchEl = el.querySelector('.gift-card-balance-result_component_balancePurchaseContainer__EP8o_');
            if (purchEl) {
              const pText = (purchEl.textContent || '').trim();
              const pMatch = pText.match(/Total purchases to date[:\s]*((?:AUD|\$)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
              purchases = pMatch ? pMatch[1].trim() : (pText.match(/(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/) || [null])[0];
            }
          }
        } catch (e) {
          purchases = null;
        }
        // normalize expiry value, prefer <b> content, then aria, then text match
        let expiryNormalized: string | null = null;
        if (expiryBText) expiryNormalized = expiryBText.replace(/Expiry date:?|Expiry:?|Expires?:?|is:?/ig, '').trim();
        else if (expiryFromAria) expiryNormalized = expiryFromAria.replace(/Expiry date:?|Expiry:?|Expires?:?|is:?/ig, '').trim();
        else if (expiryMatch) expiryNormalized = expiryMatch[0].replace(/Expiry date:?|Expiry:?|Expires?:?|is:?/ig, '').trim();
        if (expiryNormalized && /no expiry/i.test(expiryNormalized)) expiryNormalized = 'No expiry';

        // Extract transactions: group by date, then for each transaction item capture description and amount
        let transactions: Array<{date: string | null, description: string | null, amount: string | null}> = [];
        try {
          const groups = Array.from(el.querySelectorAll('.gift-card-balance-result_component_transactionGroup__LfnCW'));
          for (const g of groups) {
            const dateEl = g.querySelector('.gift-card-balance-result_component_transactionDate__p1q9q');
            const dateText = dateEl ? (dateEl.textContent || '').trim() : null;
            const items = Array.from(g.querySelectorAll('.gift-card-balance-result_component_transactionItem__wMoe3'));
            for (const it of items) {
              const descEl = it.querySelector('.core-body-lg-default') || it.querySelector('span');
              const amountEl = it.querySelector('.core-title-lg-default') || Array.from(it.querySelectorAll('span')).pop();
              const desc = descEl ? (descEl.textContent || '').trim() : null;
              const amount = amountEl ? (amountEl.textContent || '').trim() : null;
              transactions.push({ date: dateText, description: desc, amount });
            }
          }
        } catch (e) {
          transactions = [];
        }

        return {
          balance: balanceMatch ? balanceMatch[0].trim() : null,
          cardNumber: cardFromAria || (cardMatch ? cardMatch[0].trim() : null),
          expiryDate: expiryNormalized,
          purchases,
          transactions,
        };
      });

      return attachBalances(details);
    } catch (err) {
      // fallback: poll page HTML for currency pattern and try to find purchases
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
        const _currencyRegex = /(?:AUD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
        const _matches = html.match(_currencyRegex);
        balance = _matches ? _matches[0] : null;

        if (!cardNumber) {
          const cm = html.match(/\b\d{15,19}\b/);
          if (cm) cardNumber = cm[0].trim();
          // try aria-label for card number
          if (!cardNumber) {
            const ariaCard = html.match(/aria-label=["'][^"']*Gift card number[^"']*(\d{15,19})[^"']*["']/i);
            if (ariaCard) cardNumber = ariaCard[1].trim();
          }
        }

          if (!expiryDate) {
          // try to capture <b> content inside an expiry div: <div aria-label="Expiry date is No expiry">Expiry date: <b>No expiry</b></div>
          const bHtmlMatch = html.match(/<div[^>]*aria-label=["'][^"']*Expiry date[^"']*["'][^>]*>[^<]*<b>([^<]+)<\/b>/i);
          if (bHtmlMatch) {
            expiryDate = bHtmlMatch[1].trim();
          }
          // fallback to general expiry text match
          if (!expiryDate) {
            const em = html.match(/(No expiry|No Expiry|No expiry date|Expires?:?\s*\d{1,2}\/\d{2,4}|Expiry date:?\s*.+)/i);
            if (em) expiryDate = em[0].replace(/Expiry date:?|Expiry:?|Expires?:?|is:?/ig, '').trim();
          }
          // try aria-label pattern if still not found
          if (!expiryDate) {
            const ariaExp = html.match(/aria-label=["'][^"']*Expiry date[^"']*(?:is|:)\s*([^"']+)[^"']*["']/i);
            if (ariaExp) expiryDate = ariaExp[1].trim();
          }
          if (expiryDate && /no expiry/i.test(expiryDate)) expiryDate = 'No expiry';
        }

        if (!purchases) {
          const pm = html.match(/Total purchases to date[:\s]*((?:AUD|\$)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
          if (pm) purchases = pm[1].trim();
          // also try to locate the span value directly in the HTML
          if (!purchases) {
            const spanMatch = html.match(/<span[^>]*class=["'][^"']*purchasesSectionValue__FipjX[^"']*["'][^>]*>([^<]+)<\/span>/i);
            if (spanMatch) purchases = spanMatch[1].trim();
          }
        }

        // fallback: try to parse transactions from HTML when DOM extraction fails
        transactions = [];
        try {
          const dateRegex = /<span[^>]*class=["'][^"']*transactionDate__p1q9q[^"']*["'][^>]*>([^<]+)<\/span>/gi;
          const itemRegex = /<div[^>]*transactionItem__wMoe3[^>]*>.*?<span[^>]*class=["'][^"']*core-body-lg-default[^"']*["'][^>]*>([^<]+)<\/span>.*?<span[^>]*class=["'][^"']*core-title-lg-default[^"']*["'][^>]*>([^<]+)<\/span>/gsi;
          const dates: Array<{date: string, idx: number}> = [];
          let m: RegExpExecArray | null;
          while ((m = dateRegex.exec(html)) !== null) {
            dates.push({ date: m[1].trim(), idx: m.index });
          }
          const items: Array<{desc: string, amount: string, idx: number}> = [];
          while ((m = itemRegex.exec(html)) !== null) {
            items.push({ desc: m[1].trim(), amount: m[2].trim(), idx: m.index });
          }
          for (const it of items) {
            // find latest date before this item
            const d = dates.filter(dd => dd.idx < it.idx).pop();
            transactions.push({ date: d ? d.date : null, description: it.desc, amount: it.amount });
          }
        } catch (e) {
          transactions = [];
        }

        if (balance || purchases || cardNumber || expiryDate || transactions.length) break;
      }
      
      return attachBalances({ balance, cardNumber, expiryDate, purchases, transactions });
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
