/**
 * Kiosk mode — auto-cycling slide show with keyboard nav
 */
/* global AsciinemaPlayer */
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('kiosk-app');
  if (!app) return;

  const _parsed = parseInt(app.dataset.interval, 10);
  const intervalSecs = Number.isFinite(_parsed) && _parsed >= 1 ? _parsed : 30;
  const slides = Array.from(document.querySelectorAll('.kiosk-slide'));
  const totalEl   = document.getElementById('kiosk-total');
  const currentEl = document.getElementById('kiosk-current');
  const progressBar = document.getElementById('kiosk-progress-bar');

  if (!slides.length) return;
  if (totalEl) totalEl.textContent = slides.length;

  let current = 0;
  let timer   = null;

  function showSlide(n) {
    slides[current].classList.remove('active');
    current = (n + slides.length) % slides.length;
    slides[current].classList.add('active');
    if (currentEl) currentEl.textContent = current + 1;
    resetProgress();
  }

  function resetProgress() {
    if (!progressBar) return;
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progressBar.style.transition = `width ${intervalSecs}s linear`;
        progressBar.style.width = '100%';
      });
    });
  }

  function startAuto() {
    timer = setInterval(() => showSlide(current + 1), intervalSecs * 1000);
  }

  function stopAuto() {
    clearInterval(timer);
  }

  // Keyboard nav
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      const tag = document.activeElement?.tagName;
      if (e.key === ' ' && (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A')) return;
      e.preventDefault();
      stopAuto(); showSlide(current + 1); startAuto();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stopAuto(); showSlide(current - 1); startAuto();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      window.location.href = '/';
    }
  });

  // Init asciinema players for visible slide
  if (typeof AsciinemaPlayer !== 'undefined') {
    document.querySelectorAll('.kiosk-cast[data-cast-id]').forEach((el) => {
      AsciinemaPlayer.create(
        `https://asciinema.org/a/${el.dataset.castId}.cast`,
        el,
        { fit: 'width', theme: 'solarized-dark', autoPlay: false }
      );
    });
  }

  showSlide(0);
  startAuto();
});
