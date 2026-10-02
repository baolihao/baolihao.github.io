(function () {
  "use strict";

  const movie = document.querySelector("[data-hero-movie]");
  const toggle = document.querySelector("[data-movie-toggle]");

  if (!movie || !toggle) return;

  const icon = toggle.querySelector(".dynamics-toggle-icon");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let userPaused = reducedMotion.matches;
  let inViewport = true;

  function syncButton(paused) {
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute(
      "aria-label",
      paused ? "Play goldfish movie" : "Pause goldfish movie"
    );
    icon.textContent = paused ? "▶" : "Ⅱ";
  }

  function updatePlayback() {
    const shouldPause = userPaused || !inViewport || document.hidden;

    if (shouldPause) {
      movie.pause();
      syncButton(true);
      return;
    }

    movie.play().then(
      () => syncButton(false),
      () => syncButton(true)
    );
  }

  toggle.addEventListener("click", () => {
    userPaused = !movie.paused;
    updatePlayback();
  });

  document.addEventListener("visibilitychange", updatePlayback);

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      inViewport = entry.isIntersecting;
      updatePlayback();
    },
    { threshold: 0.05 }
  );

  visibilityObserver.observe(movie);

  const handleMotionPreference = (event) => {
    userPaused = event.matches;

    if (event.matches && movie.readyState >= 1) {
      movie.currentTime = 2.5;
    }

    updatePlayback();
  };

  if (reducedMotion.addEventListener) {
    reducedMotion.addEventListener("change", handleMotionPreference);
  } else {
    reducedMotion.addListener(handleMotionPreference);
  }

  movie.addEventListener("loadedmetadata", () => {
    if (reducedMotion.matches) movie.currentTime = 2.5;
    updatePlayback();
  });

  movie.addEventListener("play", () => syncButton(false));
  movie.addEventListener("pause", () => syncButton(true));

  updatePlayback();
})();
