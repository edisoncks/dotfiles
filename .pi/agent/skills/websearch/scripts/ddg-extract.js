/*
 * ddg-extract.js — extractor + page-state classifier for lite.duckduckgo.com
 *
 * Passed to `obscura fetch ... --eval "$(cat ddg-extract.js)"`.
 * Must evaluate to a single JSON string.
 *
 * Deliberately ROW-BASED: `table tr` is scanned once, and only the first
 * `a.result-link` in each row is taken. Sponsored blocks contain a second
 * anchor labelled "more info", which an anchor-based extractor emits as a
 * phantom result and then misaligns every following entry. Iterating rows
 * dedupes that structurally. See ../references/ddg-lite-dom.md.
 */
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const results = [];
  let cur = null;

  document.querySelectorAll('table tr').forEach((tr) => {
    const a = tr.querySelector('a.result-link');

    if (a) {
      const label = clean(a.textContent);
      // Sponsored blocks carry an extra "more info" anchor in the same row.
      if (/^more info$/i.test(label)) return;

      const raw = a.getAttribute('href') || '';
      let url = raw.startsWith('//') ? 'https:' + raw : raw;
      try {
        const u = new URL(url, location.href);
        const uddg = u.searchParams.get('uddg');
        if (uddg) url = uddg;
      } catch (e) { /* keep the raw href */ }

      let host = '';
      try { host = new URL(url, location.href).hostname; } catch (e) {}

      const sponsored = tr.classList.contains('result-sponsored') ||
        /(^|\.)duckduckgo\.com$/.test(host) && /\/y\.js/.test(url);

      const linkText = tr.querySelector('td span.link-text');

      cur = {
        title: label,
        url: url,
        domain: linkText ? clean(linkText.textContent) : host,
        snippet: '',
        sponsored: !!sponsored,
      };
      // The snippet sometimes shares the anchor's own row.
      const ownSnippet = tr.querySelector('td.result-snippet');
      if (ownSnippet) cur.snippet = clean(ownSnippet.textContent);
      results.push(cur);
      return;
    }

    if (!cur) return;
    const sn = tr.querySelector('td.result-snippet');
    if (sn) cur.snippet = clean(sn.textContent);
    const lt = tr.querySelector('td span.link-text');
    if (lt && !cur.domain) cur.domain = clean(lt.textContent);
  });

  const body = clean(document.body.innerText);
  const title = clean(document.title);
  const hasForm = !!document.querySelector('form[action="/lite/"] input[name="q"]');
  const noResults = /no results found/i.test(body);
  const challengeText = /bots use duckduckgo|complete the following challenge|select all squares containing/i.test(body);

  let state;
  if (challengeText || (title === 'DuckDuckGo' && !hasForm)) {
    // Verified signature: title is exactly "DuckDuckGo", the search form is
    // gone, body asks for a human. Clears by itself in roughly 30 seconds.
    state = 'challenge';
  } else if (results.length > 0) {
    state = 'ok';
  } else if (noResults) {
    // Positive signal required: a broken parser must NOT look like "no results".
    state = 'empty';
  } else {
    state = 'unknown';
  }

  const qs = new URLSearchParams(location.search);
  const s = parseInt(qs.get('s') || '0', 10) || 0;

  return JSON.stringify({
    query: (document.querySelector('input[name="q"]') || {}).value || qs.get('q') || '',
    page: Math.floor(s / 10),
    state: state,
    count: results.length,
    excerpt: (state === 'ok' || state === 'empty') ? '' : body.slice(0, 400),
    results: results,
  });
})()
