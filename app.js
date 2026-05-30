/* ============================================================
   CANTINHO DA DÊ — Guest Guide JS
   ============================================================ */

/* ── ACCORDION ── */
function initAccordions() {
  document.querySelectorAll('.section-block').forEach(block => {
    const header = block.querySelector('.accordion-header');
    const body   = block.querySelector('.accordion-body');
    if (!header || !body) return;

    header.addEventListener('click', () => {
      const isOpen = block.classList.contains('is-open');

      // close all
      document.querySelectorAll('.section-block.is-open').forEach(b => {
        b.classList.remove('is-open');
        b.querySelector('.accordion-body').style.maxHeight = '0';
      });

      // open clicked (if it was closed)
      if (!isOpen) {
        block.classList.add('is-open');
        body.style.maxHeight = body.scrollHeight + 'px';

        // recalc after images load inside
        body.querySelectorAll('img').forEach(img => {
          if (!img.complete) {
            img.addEventListener('load', () => {
              if (block.classList.contains('is-open')) {
                body.style.maxHeight = body.scrollHeight + 'px';
              }
            }, { once: true });
          }
        });
      }
    });
  });

  // open first by default
  const first = document.querySelector('.section-block');
  if (first) {
    first.classList.add('is-open');
    const body = first.querySelector('.accordion-body');
    if (body) {
      // wait for fonts
      document.fonts.ready.then(() => {
        body.style.maxHeight = body.scrollHeight + 'px';
      });
    }
  }
}

/* ── CAROUSEL ── */
function initCarousels() {
  document.querySelectorAll('.carousel-wrap').forEach(wrap => {
    const slides = wrap.querySelectorAll('.carousel-slide');
    const dots   = wrap.querySelectorAll('.carousel-dot');
    const prevBtn = wrap.querySelector('.carousel-btn.prev');
    const nextBtn = wrap.querySelector('.carousel-btn.next');
    if (slides.length === 0) return;

    let current = 0;
    let timer = null;

    function goTo(idx) {
      slides[current].classList.remove('is-active');
      dots[current]?.classList.remove('is-active');
      current = (idx + slides.length) % slides.length;
      slides[current].classList.add('is-active');
      dots[current]?.classList.add('is-active');
    }

    function startAuto() {
      if (slides.length <= 1) return;
      timer = setInterval(() => goTo(current + 1), 4000);
    }

    function stopAuto() {
      clearInterval(timer);
    }

    goTo(0);
    startAuto();

    prevBtn?.addEventListener('click', () => { stopAuto(); goTo(current - 1); startAuto(); });
    nextBtn?.addEventListener('click', () => { stopAuto(); goTo(current + 1); startAuto(); });
    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => { stopAuto(); goTo(i); startAuto(); });
    });

    // hide controls if only 1 slide
    if (slides.length <= 1) {
      prevBtn?.remove();
      nextBtn?.remove();
      wrap.querySelector('.carousel-dots')?.remove();
    }
  });
}

/* ── CHECKLIST ── */
function initChecklists() {
  document.querySelectorAll('.check-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('checked');
    });
  });

  document.querySelectorAll('.reset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = btn.closest('.accordion-body-inner').querySelector('.checklist');
      list?.querySelectorAll('.check-item.checked').forEach(i => i.classList.remove('checked'));
    });
  });
}

/* ── ACCORDION HEIGHT RECALC on resize ── */
function initResizeRecalc() {
  let rTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
      document.querySelectorAll('.section-block.is-open').forEach(block => {
        const body = block.querySelector('.accordion-body');
        if (body) body.style.maxHeight = body.scrollHeight + 'px';
      });
    }, 150);
  });
}

/* ── COPY BUTTONS ── */
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = orig;
          btn.classList.remove('copied');
        }, 1800);
      });
    });
  });
}

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', () => {
  initAccordions();
  initCarousels();
  initChecklists();
  initCopyButtons();
  initResizeRecalc();
});
