/*
 * Arc devbar - bookmarklet popup for Arc XP (Fusion) sites.
 * Reads window.Fusion only. No network requests, no dependencies.
 * Clicking the bookmarklet again closes the popup (toggle).
 */
(function () {
  'use strict';

  var HOST_ID = '__arc_devbar_host';

  // ---------- config ----------
  // PageBuilder admin URLs, checked in the admin (dev environment, default experience) on 2026-11-18.
  // Placeholders: {adminHost}, {experience}, {id}, {site}, {uri}.
  // {experience} is the micro experience path segment; "_default" for the default MX (mxId 00000000).
  var PB_EXPERIENCE = '_default';
  var PB_EDITOR_URLS = {
    page: 'https://{adminHost}/pagebuilder/experiences/{experience}/editor/curate/?p={id}',
    template: 'https://{adminHost}/pagebuilder/experiences/{experience}/editor/curate/?t={id}'
  };
  // Site, type and URI are prefilled from the query string; the user still clicks "Debug URI".
  var RESOLVER_DEBUG_URL = 'https://{adminHost}/pagebuilder/experiences/{experience}/tools/debugger?_website={site}&type=resolver-debugger&uri={uri}';
  // Admin host per environment; {org} comes from the site hostname (<org>-<site>-<env>.web.arc-cdn.net).
  // Only "dev" is checked; the others follow the same pattern but are unverified.
  var ADMIN_HOSTS = {
    prod: '{org}.arcpublishing.com',
    staging: 'staging.{org}.arcpublishing.com',
    sandbox: 'sandbox.{org}.arcpublishing.com',
    dev: 'dev.{org}.arcpublishing.com'
  };

  // Toggle: second click removes the popup.
  var existing = document.getElementById(HOST_ID);
  if (existing) {
    if (existing.__devbarClose) existing.__devbarClose();
    else existing.remove();
    return;
  }

  var F = window.Fusion;
  var loc = window.location;

  // ---------- helpers ----------

  function has(v) {
    return v !== undefined && v !== null && v !== '';
  }

  function get(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function safeStringify(value, indent) {
    var seen = [];
    try {
      return JSON.stringify(value, function (k, v) {
        if (v && typeof v === 'object') {
          if (seen.indexOf(v) !== -1) return '[Circular]';
          seen.push(v);
        }
        return v;
      }, indent);
    } catch (e) {
      return '/* cannot stringify: ' + e.message + ' */';
    }
  }

  function copyText(text, btn) {
    function done(ok) {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        done(ok);
      } catch (e) {
        done(false);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function detectEnv(host) {
    host = (host || '').toLowerCase();
    if (host === 'localhost' || host.indexOf('127.0.0.1') === 0 || /\.local$/.test(host)) return 'local';
    if (/(^|[-.])sandbox([-.]|$)/.test(host)) return 'sandbox';
    if (/(^|[-.])(dev|develop|development)([-.]|$)/.test(host)) return 'dev';
    if (/(^|[-.])(staging|stage)([-.]|$)/.test(host)) return 'staging';
    return 'prod';
  }

  // Org from Arc CDN hosts: <org>-<site>-<env>.web.arc-cdn.net or <org>-<env>.cdn.arcpublishing.com
  function detectOrg(host) {
    var m = /^([a-z0-9]+)-[a-z0-9-]+\.(web\.arc-cdn\.net|cdn\.arcpublishing\.com)$/i.exec(host || '');
    return m ? m[1].toLowerCase() : null;
  }

  function fill(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return has(vars[k]) ? encodeURIComponent(vars[k]) : m; });
  }

  function withParams(params) {
    var u = new URL(loc.href);
    for (var k in params) {
      if (params[k] === null) u.searchParams.delete(k);
      else u.searchParams.set(k, params[k]);
    }
    return u.toString();
  }

  function fmtDate(v) {
    if (!has(v)) return null;
    var d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }

  // ---------- JSON tree (lazy: children render on first expand) ----------

  function preview(v) {
    if (Array.isArray(v)) return 'Array(' + v.length + ')';
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      return '{' + keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '') + '}';
    }
    return '';
  }

  function leaf(v) {
    var cls = 'v-' + (v === null ? 'null' : typeof v);
    if (typeof v === 'function') return el('span', { class: 'p', text: 'ƒ ' + (v.name || '') + '()' });
    var txt = typeof v === 'string' ? '"' + (v.length > 300 ? v.slice(0, 300) + '…' : v) + '"' : String(v);
    return el('span', { class: cls, text: txt });
  }

  function jsonNode(key, value, open) {
    var isObj = value !== null && typeof value === 'object';
    var label = el('span', { class: 'k', text: key === null ? '' : key + ': ' });
    if (!isObj) return el('div', { class: 'row' }, [label, leaf(value)]);

    var d = el('details', { class: 'node' });
    var sum = el('summary', null, [label, el('span', { class: 'p', text: preview(value) })]);
    d.appendChild(sum);
    var rendered = false;
    function render() {
      if (rendered) return;
      rendered = true;
      var box = el('div', { class: 'kids' });
      var keys = Object.keys(value);
      var LIMIT = 500;
      keys.slice(0, LIMIT).forEach(function (k) { box.appendChild(jsonNode(k, value[k], false)); });
      if (keys.length > LIMIT) box.appendChild(el('div', { class: 'muted', text: '… ' + (keys.length - LIMIT) + ' more' }));
      d.appendChild(box);
    }
    d.addEventListener('toggle', function () { if (d.open) render(); });
    if (open) { d.open = true; render(); }
    return d;
  }

  // ---------- Fusion.tree walk ----------

  function walkTree(node, depth, out) {
    if (!node || typeof node !== 'object' || depth > 50) return;
    // On Fusion 7.x the node id lives in props.id; node.id is kept as a fallback.
    var p = node.props || {};
    if (has(node.type) || has(node.id) || has(p.id)) {
      out.push({
        depth: depth,
        // Layout sections have no type, only a numeric id.
        type: node.type || p.type || 'section',
        id: has(p.id) ? p.id : node.id,
        collection: node.collection || p.collection,
        name: p.name || get(p, 'customFields.name') || get(p, 'displayProperties.name') || null
      });
    }
    var kids = node.children;
    if (Array.isArray(kids)) kids.forEach(function (c) { walkTree(c, depth + 1, out); });
  }

  // ---------- UI ----------

  var host = el('div', { id: HOST_ID });
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.panel{font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d2433;background:#fff;',
    'width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;',
    'border:1px solid #c9d1e0;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.22);overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1d2433;color:#fff}',
    '.hd b{font-size:13px;flex:1}',
    '.env{font-size:11px;padding:1px 6px;border-radius:9px;font-weight:600;text-transform:uppercase}',
    '.env-prod{background:#d93025;color:#fff}.env-dev{background:#1e8e3e;color:#fff}',
    '.env-sandbox{background:#f9ab00;color:#1d2433}.env-staging{background:#8430ce;color:#fff}.env-local{background:#5f6368;color:#fff}',
    '.x{all:unset;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;color:#fff}',
    '.x:hover{color:#ffb4ab}',
    '.bd{overflow:auto;padding:4px 10px 10px}',
    'section{border-top:1px solid #e3e8f0;padding:8px 0}',
    'section:first-child{border-top:0}',
    'h3{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5b6b85;display:flex;align-items:center;gap:6px}',
    'h3 .sp{flex:1}',
    'table{border-collapse:collapse;width:100%}',
    'td{padding:2px 0;vertical-align:top}',
    'td.l{color:#5b6b85;width:120px;padding-right:8px;white-space:nowrap}',
    'td.v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-all}',
    '.muted{color:#8a96ab}',
    'button.b{all:unset;cursor:pointer;font-size:11px;padding:2px 8px;border:1px solid #c9d1e0;border-radius:4px;color:#1d2433;background:#f4f6fa;text-transform:none;letter-spacing:0}',
    'button.b:hover{background:#e3e8f0}',
    'a{color:#1a5fd0;text-decoration:none;word-break:break-all}a:hover{text-decoration:underline}',
    'ul.links{margin:0;padding:0;list-style:none}ul.links li{padding:2px 0}',
    '.tree{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}',
    '.tree details>summary{cursor:pointer;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tree details>summary::-webkit-details-marker{display:none}',
    '.tree details>summary:before{content:"▸";display:inline-block;width:12px;color:#8a96ab}',
    '.tree details[open]>summary:before{content:"▾"}',
    '.tree .kids{padding-left:12px;border-left:1px dotted #d5dbe6;margin-left:4px}',
    '.tree .row{padding-left:12px;word-break:break-all}',
    '.k{color:#8430ce}.p{color:#8a96ab}',
    '.v-string{color:#1e7d32}.v-number{color:#1a5fd0}.v-boolean{color:#c5221f}.v-null{color:#8a96ab}',
    'details.sec>summary{cursor:pointer;color:#1a5fd0}',
    '.feat{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.feat .t{color:#1d2433}.feat .i{color:#8a96ab}.feat.f .t{color:#8430ce;font-weight:600}',
    '.hero{display:flex;align-items:center;gap:8px;margin:2px 0 4px}',
    '.kind{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:4px;color:#fff;background:#5f6368}',
    '.kind-page{background:#1a5fd0}.kind-template{background:#8430ce}',
    '.pbid{flex:1;font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}',
    '.herolinks{margin-bottom:6px}',
    '.warn{background:#fff4e5;border:1px solid #f9ab00;border-radius:6px;padding:8px;margin-top:6px}',
    '@media (prefers-color-scheme:dark){',
    '.panel{background:#1b1f27;color:#e3e8f0;border-color:#3a4252}',
    'section{border-color:#2c3340}td.l,h3{color:#9aa7bd}',
    'button.b{background:#2c3340;color:#e3e8f0;border-color:#3a4252}button.b:hover{background:#3a4252}',
    'a{color:#8ab4f8}.k{color:#d7aefb}.v-string{color:#81c995}.v-number{color:#8ab4f8}.v-boolean{color:#f28b82}',
    '.feat .t{color:#e3e8f0}.feat.f .t{color:#d7aefb}',
    '.warn{background:#3a2e14;border-color:#a87400}',
    '}'
  ].join('');

  function section(title, body, extra) {
    return el('section', null, [el('h3', null, [el('span', { text: title }), el('span', { class: 'sp' })].concat(extra || [])), body]);
  }

  function kvTable(rows) {
    var t = el('table');
    rows.forEach(function (r) {
      var val = r[1];
      var valNode;
      if (!has(val)) valNode = el('span', { class: 'muted', text: '-' });
      else if (val.nodeType) valNode = val;
      else valNode = document.createTextNode(typeof val === 'object' ? safeStringify(val) : String(val));
      t.appendChild(el('tr', null, [el('td', { class: 'l', text: r[0] }), el('td', { class: 'v' }, [valNode])]));
    });
    return t;
  }

  function link(label, href) {
    return el('li', null, [el('span', { class: 'muted', text: label + ': ' }), el('a', { href: href, target: '_blank', rel: 'noopener', text: href })]);
  }

  var env = detectEnv(loc.hostname);
  var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Arc devbar' });
  var closeBtn = el('button', { class: 'x', title: 'Close (Esc)', 'aria-label': 'Close', text: '×' });
  panel.appendChild(el('div', { class: 'hd' }, [
    el('b', { text: 'Arc devbar' }),
    F ? el('span', { class: 'env env-' + env, text: env }) : null,
    closeBtn
  ]));
  var body = el('div', { class: 'bd' });
  panel.appendChild(body);

  if (!F || typeof F !== 'object') {
    body.appendChild(el('div', { class: 'warn' }, [
      el('b', { text: 'window.Fusion not found.' }),
      el('div', { text: 'This page does not look like an Arc XP (Fusion) page, or Fusion has not loaded yet. ' +
        'Pages served by PageBuilder Fusion expose window.Fusion in an inline script.' })
    ]));
  } else {
    var gc = F.globalContent;
    var gcc = F.globalContentConfig;
    var deployment = has(F.deployment) ? F.deployment : null;
    var arcSite = F.arcSite;
    var org = detectOrg(loc.hostname);

    // --- page ---
    var fenv = F.environment && typeof F.environment === 'object' ? F.environment : {};

    // Fusion.template is "page/<id>" for a page and "template/<id>" for a template matched by a resolver.
    var tm = /^(page|template)\/(.+)$/.exec(String(F.template || ''));
    var pbKind = tm ? tm[1] : null;
    var pbId = tm ? tm[2] : null;
    var adminHost = org && ADMIN_HOSTS[env] ? fill(ADMIN_HOSTS[env], { org: org }) : null;
    var editUrl = pbKind && adminHost ? fill(PB_EDITOR_URLS[pbKind], { adminHost: adminHost, experience: PB_EXPERIENCE, id: pbId }) : null;
    var pageType = get(F, 'metas.page-type.value');

    var hero = el('div', { class: 'hero' }, [
      el('span', { class: 'kind kind-' + (pbKind || 'unknown'), text: pbKind || 'unknown' }),
      el('span', { class: 'pbid', text: pbId || String(F.template || '-') }),
      pbId ? (function () {
        var b = el('button', { class: 'b', text: 'Copy id' });
        b.addEventListener('click', function () { copyText(pbId, b); });
        return b;
      })() : null
    ]);
    var heroLinks = el('div', { class: 'herolinks' }, [
      editUrl ? el('a', { href: editUrl, target: '_blank', rel: 'noopener', text: 'Open in PageBuilder' }) : null,
      editUrl ? el('span', { class: 'muted', text: ' (admin login)' }) : null,
      has(pageType) ? el('span', { class: 'muted', text: (editUrl ? '  ·  ' : '') + 'page-type: ' + pageType }) : null
    ]);

    body.appendChild(section('Page', el('div', null, [hero, heroLinks, kvTable([
      ['deployment', deployment],
      ['arcSite', arcSite],
      ['outputType', F.outputType],
      ['environment', env + ' (' + loc.hostname + ')' + (has(fenv.ENVIRONMENT) ? ' / ' + fenv.ENVIRONMENT : '')],
      ['engine', has(fenv.FUSION_RELEASE) ? 'Fusion ' + fenv.FUSION_RELEASE : null],
      ['mxId', F.mxId],
      ['template', F.template],
      ['layout', F.layout],
      ['lastModified', fmtDate(F.lastModified)],
      ['contextPath', F.contextPath],
      ['spa', has(F.spa) ? String(F.spa) : null]
    ])])));

    // --- resolver ---
    // The resolver name is not exposed anywhere public (Fusion, HTML, response headers); Arc shows it
    // only in the admin Resolver Debugger. Here: what identifies it + a link to the debugger.
    // Path only: query params like ?d= are not part of resolver matching.
    var debugUrl = adminHost ? fill(RESOLVER_DEBUG_URL, { adminHost: adminHost, experience: PB_EXPERIENCE, site: arcSite, uri: loc.pathname }) : null;
    var debugLink = debugUrl ? el('div', { class: 'herolinks' }, [
      el('a', { href: debugUrl, target: '_blank', rel: 'noopener', text: 'Resolver debugger' }),
      el('span', { class: 'muted', text: ' (admin login; then click "Debug URI")' })
    ]) : null;
    if (pbKind === 'template') {
      var resolverRows = [
        ['template id', pbId],
        ['content source', gcc && gcc.source],
        ['query', gcc && gcc.query ? safeStringify(gcc.query) : null]
      ];
      body.appendChild(section('Resolver', el('div', null, [
        debugLink,
        el('div', { class: 'muted', text: 'Resolver name is not exposed on the page; the debugger shows it. Note: the rendered template can differ from the resolver default (content2pageMapping). Identified by:' }),
        kvTable(resolverRows)
      ])));
    } else if (pbKind === 'page') {
      body.appendChild(section('Resolver', el('div', null, [
        el('div', { class: 'muted', text: 'None: this URL is a PageBuilder page, not a resolver-matched template.' }),
        debugLink
      ])));
    }

    // --- globalContent ---
    if (gc && typeof gc === 'object' && Object.keys(gc).length) {
      var gcRows = [
        ['_id', gc._id],
        ['type', gc.type],
        ['canonical_url', has(gc.canonical_url) ? el('a', { href: gc.canonical_url, target: '_blank', rel: 'noopener', text: gc.canonical_url }) : null]
      ];
      if (has(get(gc, 'headlines.basic'))) gcRows.push(['headline', get(gc, 'headlines.basic')]);
      if (has(gc.last_updated_date)) gcRows.push(['last_updated', gc.last_updated_date]);
      var copyBtn = el('button', { class: 'b', text: 'Copy JSON' });
      copyBtn.addEventListener('click', function () { copyText(safeStringify(gc, 2), copyBtn); });
      var gcTree = el('details', { class: 'sec' }, [el('summary', { text: 'Tree (' + Object.keys(gc).length + ' keys)' })]);
      var treeBox = el('div', { class: 'tree' });
      gcTree.appendChild(treeBox);
      gcTree.addEventListener('toggle', function () {
        if (gcTree.open && !treeBox.firstChild) {
          Object.keys(gc).forEach(function (k) { treeBox.appendChild(jsonNode(k, gc[k], false)); });
        }
      });
      body.appendChild(section('globalContent', el('div', null, [kvTable(gcRows), gcTree]), [copyBtn]));
    } else {
      body.appendChild(section('globalContent', el('div', { class: 'muted', text: gc && typeof gc === 'object' ? 'empty {} (page without a global content source)' : has(gc) ? String(gc) : 'none on this page' })));
    }

    // --- globalContentConfig ---
    if (gcc && typeof gcc === 'object' && Object.keys(gcc).length) {
      var q = gcc.query;
      body.appendChild(section('globalContentConfig', kvTable([
        ['source', gcc.source],
        ['query', q && typeof q === 'object' ? el('div', { class: 'tree' }, Object.keys(q).map(function (k) { return jsonNode(k, q[k], false); })) : q]
      ])));
    } else {
      body.appendChild(section('globalContentConfig', el('div', { class: 'muted', text: 'none' })));
    }

    // --- features from Fusion.tree ---
    var nodes = [];
    walkTree(F.tree, 0, nodes);
    var feats = nodes.filter(function (n) { return n.collection === 'features'; });
    var featBox = el('details', { class: 'sec' }, [el('summary', {
      text: nodes.length ? feats.length + ' features, ' + nodes.length + ' nodes total - show' : 'Fusion.tree is empty or missing'
    })]);
    if (nodes.length) {
      var list = el('div');
      nodes.forEach(function (n) {
        var isF = n.collection === 'features';
        list.appendChild(el('div', {
          class: 'feat' + (isF ? ' f' : ''),
          title: [n.collection, n.type, n.id].filter(has).join(' / '),
          style: 'padding-left:' + (n.depth * 10) + 'px'
        }, [
          el('span', { class: 't', text: String(n.type || '?') }),
          has(n.id) ? el('span', { class: 'i', text: '  #' + n.id }) : null,
          has(n.name) ? el('span', { class: 'i', text: '  "' + n.name + '"' }) : null
        ]));
      });
      featBox.appendChild(list);
    }
    var copyFeats = el('button', { class: 'b', text: 'Copy list' });
    copyFeats.addEventListener('click', function () {
      copyText(feats.map(function (n) { return n.type + '\t' + n.id; }).join('\n'), copyFeats);
    });
    body.appendChild(section('Features (Fusion.tree)', featBox, feats.length ? [copyFeats] : null));

    // --- contentCache: content sources fetched by features during SSR ---
    // Shape: { <source>: { <query JSON>: { data, expires, lastModified } } }. Global content is not in it.
    var cache = F.contentCache && typeof F.contentCache === 'object' ? F.contentCache : {};
    var cacheSources = Object.keys(cache);
    var cacheCalls = 0;
    cacheSources.forEach(function (s) { cacheCalls += Object.keys(cache[s] || {}).length; });
    var cacheBox = el('details', { class: 'sec' }, [el('summary', {
      text: cacheSources.length ? cacheSources.length + ' sources, ' + cacheCalls + ' calls - show' : 'contentCache is empty or missing'
    })]);
    if (cacheSources.length) {
      var cacheList = el('div', { class: 'tree' });
      cacheSources.forEach(function (s) {
        var entries = cache[s] || {};
        var d = el('details', { class: 'node' }, [el('summary', null, [
          el('span', { class: 'k', text: s }),
          el('span', { class: 'p', text: '  ' + Object.keys(entries).length + ' call(s)' })
        ])]);
        var kids = el('div', { class: 'kids' });
        Object.keys(entries).forEach(function (qk) {
          var q;
          try { q = JSON.parse(qk); } catch (e) { q = qk; }
          var entry = entries[qk] || {};
          var label = typeof q === 'object' ? safeStringify(q) : String(q);
          kids.appendChild(jsonNode(label, {
            query: q,
            expires: fmtDate(entry.expires),
            lastModified: fmtDate(entry.lastModified),
            data: entry.data
          }, false));
        });
        d.appendChild(kids);
        cacheList.appendChild(d);
      });
      cacheBox.appendChild(cacheList);
    }
    body.appendChild(section('Content sources (contentCache)', cacheBox));

    // --- quick links ---
    var links = el('ul', { class: 'links' });
    if (has(deployment)) links.appendChild(link('?d=' + deployment, withParams({ d: deployment })));
    links.appendChild(link('AMP', withParams({ outputType: 'amp' })));
    if (gcc && has(gcc.source) && gcc.query) {
      var fetchUrl = loc.origin + (F.contextPath || '/pf') + '/api/v3/content/fetch/' + encodeURIComponent(gcc.source) +
        '?query=' + encodeURIComponent(safeStringify(gcc.query)) +
        (has(deployment) ? '&d=' + encodeURIComponent(deployment) : '') +
        (has(arcSite) ? '&_website=' + encodeURIComponent(arcSite) : '');
      links.appendChild(link('content source (fetch)', fetchUrl));
    }
    if (gc && has(gc._id) && org) {
      links.appendChild(link('Content API (token needed)',
        'https://api.' + org + '.arcpublishing.com/content/v4/?_id=' + encodeURIComponent(gc._id) +
        (has(arcSite) ? '&website=' + encodeURIComponent(arcSite) : '')));
    }
    body.appendChild(section('Quick links', links));

    // --- other Fusion keys ---
    var known = ['deployment', 'arcSite', 'outputType', 'template', 'layout', 'lastModified', 'contextPath', 'spa', 'globalContent', 'globalContentConfig', 'tree', 'contentCache', 'mxId'];
    var other = Object.keys(F).filter(function (k) { return known.indexOf(k) === -1; });
    if (other.length) {
      var otherBox = el('details', { class: 'sec' }, [el('summary', { text: 'Other Fusion keys: ' + other.join(', ') })]);
      var otherTree = el('div', { class: 'tree' });
      otherBox.appendChild(otherTree);
      otherBox.addEventListener('toggle', function () {
        if (otherBox.open && !otherTree.firstChild) other.forEach(function (k) { otherTree.appendChild(jsonNode(k, F[k], false)); });
      });
      body.appendChild(section('window.Fusion', otherBox));
    }
  }

  var styleEl = el('style', { text: css });
  root.appendChild(styleEl);
  root.appendChild(panel);

  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') close();
  }
  function close() {
    document.removeEventListener('keydown', onKey, true);
    host.remove();
  }
  host.__devbarClose = close;
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  (document.body || document.documentElement).appendChild(host);
})();
