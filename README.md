# Arc devbar

A bookmarklet that opens a small debug popup on any Arc XP (PageBuilder Fusion) page.
It only reads `window.Fusion`: no network requests, no dependencies, nothing is changed on the page.

## What it shows

- **Page:** deployment, arcSite, outputType, environment (dev / sandbox / staging / prod / local by hostname,
  plus `Fusion.environment.ENVIRONMENT`), engine version (`FUSION_RELEASE`), template, layout, lastModified.
- **Page / template:** big badge with the kind (`page` or `template`, from `Fusion.template`) and its id,
  "Copy id", a link to the PageBuilder editor and `page-type` from `Fusion.metas`.
- **Resolver:** Fusion does not expose the resolver name. The popup links to the Resolver Debugger with the
  current path prefilled, and for a template shows template id + global content source + query.
  The rendered template can differ from the resolver's default template (content2pageMapping).
- **Content sources (contentCache):** every content source a feature fetched during server render,
  with query, expires, lastModified and data (collapsed). Global content is not in this cache.
- **globalContent:** `_id`, `type`, `canonical_url`, headline, last update; a collapsible tree and a "Copy JSON" button.
- **globalContentConfig:** source and query.
- **Features:** every node from `Fusion.tree` (layout, sections, chains, features) with id and PageBuilder name;
  "Copy list" copies `type<TAB>id` of all features.
- **Quick links:** the same page with `?d=<deployment>`, with `?outputType=amp`,
  the content source via `/pf/api/v3/content/fetch/...`, and the Content API by `_id` (needs a token).
- **Other Fusion keys:** everything else in `window.Fusion`, as a lazy tree.

Close with `Esc`, the `×` button, or by clicking the bookmark again.
The popup lives in its own shadow DOM, so site styles do not leak in.

## Build

```
node build.js
```

Produces:
- `dist/bookmarklet.txt` - the `javascript:...` URL;
- `dist/install.html` - open locally and drag the button to the bookmarks bar;
- `dist/devbar.min.js` - the same code unencoded (handy for pasting into DevTools).

Source: `src/devbar.js`. The build only strips comments and indentation and checks syntax; no minifier.

## Config

At the top of `src/devbar.js`:
- `PB_EDITOR_URLS` - PageBuilder editor: `/pagebuilder/experiences/{experience}/editor/curate/?p={id}` for a page,
  `?t={id}` for a template. Checked in the admin. The `&v=` (version) parameter the admin adds itself is not needed.
- `RESOLVER_DEBUG_URL` - `/pagebuilder/experiences/{experience}/tools/debugger?_website={site}&type=resolver-debugger&uri={path}`.
  Checked: site, type and URI are prefilled; you still click "Debug URI". The debugger shows the resolver
  (name, priority, pattern, default page/template, content source) and the template that was actually rendered.
  The resolver name is not exposed on the public page (Fusion, HTML, response headers).
- `PB_EXPERIENCE` - micro experience path segment, `_default` for the default MX. Other MXs are not handled yet.
- `ADMIN_HOSTS` - admin host per environment; `{org}` is taken from `<org>-<site>-<env>.web.arc-cdn.net`.
  Only `dev.{org}.arcpublishing.com` is checked so far.

Opening a template in the editor may show a "Draft out of date" dialog (Keep draft / Use shared).
Both buttons change the draft; close the tab if you only wanted to look.

## Notes

- The tree is rendered lazily, so large `globalContent` objects do not slow the page down.
- On Fusion 7.x node ids live in `props.id`; layout sections have no `type` and are shown as `section`.
- A site with a strict Content Security Policy may block bookmarklets. Then paste `dist/devbar.min.js` into the DevTools console.
- `?outputType=amp` falls back to `default` if the bundle has no AMP output type; the popup shows the real outputType.
