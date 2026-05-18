/* VOLTS — page interactions
 *  - Scroll progress bar
 *  - Reveal-on-scroll
 *  - Stat number count-up when in view
 *  - Bar-chart fill animations when in view
 *  - BibTeX copy
 */

(() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* --- Scroll progress --- */
  const progress = $('#progress');
  const onScroll = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
    if (progress) progress.style.width = pct + '%';
  };
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* --- Reveal-on-scroll ---
   * Strategy: IO reveals elements as they come into view, with a per-element
   * stagger. Three safety nets guarantee content never gets stuck hidden:
   *   1. Scroll handler reveals anything whose top is above the viewport bottom.
   *   2. A 1.5s timer reveals anything in or above the viewport.
   *   3. A 3s "give-up" timer reveals everything no matter what.
   * Honors prefers-reduced-motion.
   */
  const revealEls = $$('.reveal');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add('in'));
  } else {
    const revealNow = (el) => { el.classList.add('in'); };
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting || (e.boundingClientRect && e.boundingClientRect.top < window.innerHeight)) {
          revealNow(e.target);
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
    revealEls.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 25, 200) + 'ms';
      revealObs.observe(el);
    });

    const sweep = () => {
      revealEls.forEach((el) => {
        if (el.classList.contains('in')) return;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight) revealNow(el);
      });
    };
    document.addEventListener('scroll', sweep, { passive: true });
    setTimeout(sweep, 500);
    setTimeout(sweep, 1500);
    setTimeout(() => revealEls.forEach(revealNow), 3000);
  }

  /* --- Stat & domain count-ups --- */
  function countUp(el, target, duration = 1400) {
    const isFloat = String(target).includes('.');
    const start = performance.now();
    const from = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * ease(t);
      el.textContent = isFloat ? v.toFixed(2) : Math.round(v).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = isFloat ? Number(target).toFixed(2) : Number(target).toLocaleString();
    };
    requestAnimationFrame(step);
  }

  // Numeric stats with [data-target] on the .num element or on a .v child
  $$('.stat .num').forEach((numEl) => {
    const directTarget = numEl.dataset.target;
    const vChild = numEl.querySelector('.v[data-target]');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (directTarget) {
          const v = numEl.querySelector('.v');
          if (v) countUp(v, parseFloat(directTarget));
        } else if (vChild) {
          countUp(vChild, parseFloat(vChild.dataset.target));
        }
        obs.disconnect();
      });
    }, { threshold: 0.4 });
    obs.observe(numEl);
  });

  // Per-domain percentages
  $$('.domain .pct').forEach((el) => {
    const target = parseFloat(el.dataset.target);
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const start = performance.now();
        const dur = 1400;
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        const step = (now) => {
          const t = Math.min(1, (now - start) / dur);
          el.textContent = (target * ease(t)).toFixed(1) + '%';
          if (t < 1) requestAnimationFrame(step);
          else el.textContent = target.toFixed(1) + '%';
        };
        requestAnimationFrame(step);
        obs.disconnect();
      });
    }, { threshold: 0.45 });
    obs.observe(el);
  });

  /* --- Bar chart fill --- */
  const chart = $('.chart-frame');
  if (chart) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        $$('.bar .fill', chart).forEach((b, idx) => {
          const pct = parseFloat(b.dataset.pct);
          setTimeout(() => { b.style.width = pct + '%'; }, idx * 110);
        });
        obs.disconnect();
      });
    }, { threshold: 0.3 });
    obs.observe(chart);
  }

  /* --- BibTeX copy --- */
  window.copyBibtex = () => {
    const text = document.getElementById('bibtex').textContent;
    const btn = document.querySelector('.copy-btn');
    const orig = btn.textContent;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied';
      btn.style.background = 'var(--brand-2)';
      setTimeout(() => { btn.textContent = orig; btn.style.background = 'var(--brand)'; }, 1400);
    }).catch(() => {
      btn.textContent = 'Copy failed';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });
  };
})();
