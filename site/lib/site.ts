/* One place for names that change once they are registered: the npm package, the
   script host and the key format. "poko" and "create-poko" are taken on npm, so the
   CLI ships as "usepoko" (free on npm, and usepoko.com is free too). */
export const SITE = {
  name: 'Poko',
  cli: 'npx usepoko init',
  cdn: 'https://cdn.usepoko.com',
  keyPlaceholder: 'pk_live_…',
};

export const SNIPPET = `<script src="${SITE.cdn}/v1/poko.js" data-key="${SITE.keyPlaceholder}" async></script>`;
