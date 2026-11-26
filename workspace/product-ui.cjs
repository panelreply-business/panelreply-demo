'use strict';

// These are fixed server-owned strings. Request fields, saved business names,
// query parameters and caller-provided labels never become template markup.
const PRODUCT_UI = Object.freeze({
  callback: Object.freeze({
    label: 'PanelReply Callback', home: '/', caption: 'CALLBACK WORKSPACE',
    pages: Object.freeze(['login', 'inbox', 'preview']),
    welcome: 'Review each callback request.',
    story: 'Review customer requests and keep callback details with your business answers.',
    intro: 'Sign in to review requests, callback details and your business answers.',
    sidebar: 'Review customer requests and callback details. No calls, texts, or appointments are sent.',
    environment: 'Private preview · No outbound calls or messages',
  }),
  spreadsheet: Object.freeze({
    label: 'PanelReply Spreadsheets', home: '/panels', caption: 'SPREADSHEET WORKSPACE',
    pages: Object.freeze(['login', 'panels']),
    welcome: 'Review labels. Export your parts.',
    story: 'Review component labels, save projects and export CSV or XLSX files.',
    intro: 'Sign in to review source images, saved projects and spreadsheet exports.',
    sidebar: 'Review parts and source images. Save corrections before exporting your spreadsheet.',
    environment: 'Private spreadsheet workspace',
  }),
});
const PAGE_TITLES = Object.freeze({ login: 'Sign in', inbox: 'Request inbox', preview: 'Customer preview', panels: 'Panel scanning' });

function renderProductHtml(html, product) {
  if (typeof html !== 'string') throw new TypeError('Product HTML must be a string.');
  if (!product || product.id === 'combined') return html;
  if (!Object.hasOwn(PRODUCT_UI, product.id)) throw new Error('Unknown product UI.');
  const selected = PRODUCT_UI[product.id];
  const body = /<body\b[^>]*\bdata-workspace-page="([a-z]+)"[^>]*>/.exec(html);
  if (!body || !selected.pages.includes(body[1])) throw new Error('This page does not belong to the selected product.');
  const page = body[1];
  let combinedRegionOpen = false;
  for (const marker of html.match(/<!-- \/?product:combined -->/g) || []) {
    const opening = marker === '<!-- product:combined -->';
    if (opening === combinedRegionOpen) throw new Error('Unbalanced product navigation region.');
    combinedRegionOpen = opening;
  }
  if (combinedRegionOpen) throw new Error('Unbalanced product navigation region.');
  let result = html.replace(/<!-- product:combined -->[\s\S]*?<!-- \/product:combined -->/g, '');
  if (/<!-- \/?product:combined -->/.test(result)) throw new Error('Unbalanced product navigation region.');
  const replacements = {
    title: `<title>${PAGE_TITLES[page]} · ${selected.label}</title>`,
    'brand-name': selected.label,
    caption: selected.caption,
    'sidebar-copy': `<p>${selected.sidebar}</p>`,
    'welcome-title': `<h1 id="welcome-title">${selected.welcome}</h1>`,
    'login-story': `<p>${selected.story}</p>`,
    'login-intro': `<p class="muted">${selected.intro}</p>`,
    'login-environment': selected.environment,
  };
  for (const name of ['title', 'brand-name', 'caption']) {
    if (!result.includes(`<!-- product:${name} -->`)) throw new Error('Missing product template region.');
  }
  for (const [name, replacement] of Object.entries(replacements)) {
    const pattern = new RegExp(`<!-- product:${name} -->[\\s\\S]*?<!-- \\/product:${name} -->`, 'g');
    result = result.replace(pattern, () => replacement);
  }
  if (/<!-- \/?product:/.test(result)) throw new Error('Unknown or unbalanced product template region.');
  result = result.replace(/<body\b/, `<body data-product-id="${product.id}" data-product-home="${selected.home}"`);
  result = result.replace(/<a\b(?=[^>]*\bdata-product-home\b)[^>]*>/g, tag => tag
    .replace(/\bhref="[^"]*"/, `href="${selected.home}"`)
    .replace(/\baria-label="[^"]*"/, `aria-label="${selected.label} ${product.id === 'callback' ? 'inbox' : 'projects'}"`));
  if (page === 'login') result = result.replace('aria-label="PanelReply sign in"', `aria-label="${selected.label} sign in"`);
  return result;
}

module.exports = { renderProductHtml };
