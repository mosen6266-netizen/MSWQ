/* MSWQ online personal-flow switcher.
   The original exported reader remains untouched in R2; only the online response
   gets a navigation strip linked to the public homepage's published ordering. */
(() => {
  'use strict';

  const strip = document.getElementById('mswqPersonalSwitch');
  if (!strip || !location.pathname.startsWith('/view/')) return;
  const originalTabs = document.getElementById('flowTabs');
  const currentSlug = decodeURIComponent(location.pathname.slice('/view/'.length));
  let lastSignature = '';
  let inflight = null;

  async function sync() {
    if (inflight) return inflight;
    inflight = (async () => {
      const response = await fetch('/api/public', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('个人流程目录暂时无法读取');
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('个人流程目录格式不正确');

      // /api/public is the same ordered list the homepage uses:
      // sort_order ASC, updated_at DESC. Do not sort alphabetically here.
      const flows = data.items.filter(item =>
        item && item.kind === 'personal' &&
        item.status === 'published' &&
        typeof item.slug === 'string' && item.slug &&
        typeof item.title === 'string'
      );
      if (!flows.length) return;
      const signature = JSON.stringify(flows.map(item => [item.id, item.slug, item.title]));
      if (signature === lastSignature) return;

      const fragment = document.createDocumentFragment();
      for (const item of flows) {
        const link = document.createElement('a');
        link.className = 'mswq-personal-link';
        link.href = '/view/' + encodeURIComponent(item.slug);
        link.textContent = item.title || '未命名个人流程';
        link.title = item.title || '个人流程';
        if (item.slug === currentSlug) link.setAttribute('aria-current', 'page');
        fragment.appendChild(link);
      }
      strip.replaceChildren(fragment);
      strip.hidden = false;

      // Each published standalone reader normally contains just one offline tab.
      // Hide only that duplicated local tab. Preserve multi-flow merged exports.
      if (originalTabs) {
        const localCount = originalTabs.querySelectorAll('[data-flow-index],a.reader-flow-tab').length;
        originalTabs.classList.toggle('mswq-personal-hide-local', localCount <= 1);
      }
      lastSignature = signature;
    })().catch(error => {
      // Keep the original exported reader fully usable when the API is down.
      console.warn('MSWQ personal flow switcher:', error.message);
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  void sync();
  window.addEventListener('focus', () => { if (!document.hidden) void sync(); });
  window.addEventListener('pageshow', () => { if (!document.hidden) void sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  window.setInterval(() => { if (!document.hidden) void sync(); }, 30000);
})();