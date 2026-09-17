(function () {
  "use strict";

  const canvas = document.getElementById("collective-dynamics-canvas");
  const figure = document.querySelector("[data-dynamics-figure]");
  const toggle = document.querySelector("[data-dynamics-toggle]");
  const obstacleElement = document.querySelector("[data-dynamics-obstacle]");

  if (!canvas || !figure) return;

  const context = canvas.getContext("2d", { alpha: true });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = { x: 0, y: 0, active: false };

  let width = 0;
  let height = 0;
  let fish = [];
  let frameId = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let userPaused = false;
  let inViewport = true;
  let obstacle = null;

  function seededRandom(seed) {
    let value = seed >>> 0;

    return function () {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function limit(vector, maximum) {
    const magnitude = Math.hypot(vector.x, vector.y);

    if (magnitude > maximum && magnitude > 0) {
      vector.x = (vector.x / magnitude) * maximum;
      vector.y = (vector.y / magnitude) * maximum;
    }

    return vector;
  }

  function createSchool() {
    const random = seededRandom(4815162342);
    const count = width < 520 ? 58 : width < 760 ? 72 : 92;
    const shortSide = Math.min(width, height);
    const centerX = width * 0.51;
    const centerY = height * 0.49;

    fish = Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const radius = shortSide * (0.13 + Math.pow(random(), 0.72) * 0.29);
      const clockwise = index % 13 === 0 ? -1 : 1;
      const speed = 0.78 + random() * 1.18;

      return {
        x: centerX + Math.cos(angle) * radius * (1.42 + random() * 0.42),
        y: centerY + Math.sin(angle) * radius * (0.72 + random() * 0.28),
        vx: -Math.sin(angle) * speed * clockwise + (random() - 0.5) * 0.35,
        vy: Math.cos(angle) * speed * clockwise + (random() - 0.5) * 0.35,
        maxSpeed: 1.45 + random() * 0.92,
        phase: random() * Math.PI * 2,
        depth: 0.58 + random() * 0.68,
        body: 3.7 + random() * 2.8,
        orbit: 0.21 + random() * 0.18,
        trail: []
      };
    });
  }

  function updateObstacle() {
    if (!obstacleElement) {
      obstacle = null;
      return;
    }

    const figureRect = figure.getBoundingClientRect();
    const textRect = obstacleElement.getBoundingClientRect();
    const padding = width < 520 ? 17 : 28;

    obstacle = {
      left: textRect.left - figureRect.left - padding,
      top: textRect.top - figureRect.top - padding,
      right: textRect.right - figureRect.left + padding,
      bottom: textRect.bottom - figureRect.top + padding
    };
  }

  function resize() {
    const rect = figure.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    const oldWidth = width || nextWidth;
    const oldHeight = height || nextHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const expectedCount = nextWidth < 520 ? 58 : nextWidth < 760 ? 72 : 92;

    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!fish.length || fish.length !== expectedCount) {
      createSchool();
    } else {
      fish.forEach((individual) => {
        individual.x *= width / oldWidth;
        individual.y *= height / oldHeight;
        individual.trail = [];
      });
    }

    updateObstacle();
    drawSchool();
  }

  function obstacleForce(individual) {
    if (!obstacle) return { x: 0, y: 0 };

    const lookAhead = 18;
    const futureX = individual.x + individual.vx * lookAhead;
    const futureY = individual.y + individual.vy * lookAhead;
    const inside =
      futureX > obstacle.left &&
      futureX < obstacle.right &&
      futureY > obstacle.top &&
      futureY < obstacle.bottom;

    if (inside) {
      const distances = [
        { value: futureX - obstacle.left, x: -1, y: 0 },
        { value: obstacle.right - futureX, x: 1, y: 0 },
        { value: futureY - obstacle.top, x: 0, y: -1 },
        { value: obstacle.bottom - futureY, x: 0, y: 1 }
      ];
      const nearestEdge = distances.reduce((nearest, edge) =>
        edge.value < nearest.value ? edge : nearest
      );

      return {
        x: nearestEdge.x * 0.38,
        y: nearestEdge.y * 0.38
      };
    }

    const nearestX = Math.max(obstacle.left, Math.min(futureX, obstacle.right));
    const nearestY = Math.max(obstacle.top, Math.min(futureY, obstacle.bottom));
    const dx = futureX - nearestX;
    const dy = futureY - nearestY;
    const distance = Math.hypot(dx, dy);
    const influence = width < 520 ? 34 : 58;

    if (distance > 0 && distance < influence) {
      const strength = Math.pow(1 - distance / influence, 2) * 0.22;
      return {
        x: (dx / distance) * strength,
        y: (dy / distance) * strength
      };
    }

    return { x: 0, y: 0 };
  }

  function steerSchool(step) {
    const centerX = width * (0.51 + Math.sin(elapsed * 0.17) * 0.024);
    const centerY = height * (0.49 + Math.cos(elapsed * 0.13) * 0.022);
    const shortSide = Math.min(width, height);
    const alignmentRadiusSquared = Math.pow(shortSide * 0.135, 2);
    const cohesionRadiusSquared = Math.pow(shortSide * 0.175, 2);
    const separationRadiusSquared = Math.pow(shortSide * 0.038, 2);

    const forces = fish.map((individual, index) => {
      let alignmentX = 0;
      let alignmentY = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let separationX = 0;
      let separationY = 0;
      let alignmentCount = 0;
      let cohesionCount = 0;
      let separationCount = 0;

      for (let otherIndex = 0; otherIndex < fish.length; otherIndex += 1) {
        if (otherIndex === index) continue;

        const other = fish[otherIndex];
        const dx = other.x - individual.x;
        const dy = other.y - individual.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < alignmentRadiusSquared) {
          alignmentX += other.vx;
          alignmentY += other.vy;
          alignmentCount += 1;
        }

        if (distanceSquared < cohesionRadiusSquared) {
          cohesionX += other.x;
          cohesionY += other.y;
          cohesionCount += 1;
        }

        if (distanceSquared < separationRadiusSquared && distanceSquared > 0.01) {
          separationX -= dx / distanceSquared;
          separationY -= dy / distanceSquared;
          separationCount += 1;
        }
      }

      let forceX = 0;
      let forceY = 0;

      if (alignmentCount) {
        const desired = limit(
          {
            x: alignmentX / alignmentCount,
            y: alignmentY / alignmentCount
          },
          individual.maxSpeed
        );
        forceX += (desired.x - individual.vx) * 0.026;
        forceY += (desired.y - individual.vy) * 0.026;
      }

      if (cohesionCount) {
        const targetX = cohesionX / cohesionCount;
        const targetY = cohesionY / cohesionCount;
        forceX += (targetX - individual.x) * 0.00062;
        forceY += (targetY - individual.y) * 0.00062;
      }

      if (separationCount) {
        forceX += (separationX / separationCount) * shortSide * 0.09;
        forceY += (separationY / separationCount) * shortSide * 0.09;
      }

      const ellipseScale = width / height > 1.45 ? 1.72 : 1.08;
      const dx = (individual.x - centerX) / ellipseScale;
      const dy = individual.y - centerY;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance;
      const ny = dy / distance;
      const targetRadius =
        shortSide *
        (individual.orbit +
          Math.sin(elapsed * 0.21 + individual.phase) * 0.035 +
          Math.sin(elapsed * 0.09 + individual.phase * 1.7) * 0.025);
      const radialError = targetRadius - distance;
      const radialDirection = limit({ x: nx * ellipseScale, y: ny }, 1);
      const tangentDirection = limit({ x: -ny * ellipseScale, y: nx }, 1);
      const desiredTangentSpeed = individual.maxSpeed * (0.84 + individual.depth * 0.12);

      forceX += radialDirection.x * radialError * 0.0019;
      forceY += radialDirection.y * radialError * 0.0019;
      forceX +=
        (tangentDirection.x * desiredTangentSpeed - individual.vx) * 0.021;
      forceY +=
        (tangentDirection.y * desiredTangentSpeed - individual.vy) * 0.021;

      forceX +=
        Math.cos(individual.y * 0.018 + elapsed * 0.54 + individual.phase) * 0.008;
      forceY +=
        Math.sin(individual.x * 0.016 - elapsed * 0.47 + individual.phase) * 0.008;

      if (pointer.active) {
        const pointerDx = individual.x - pointer.x;
        const pointerDy = individual.y - pointer.y;
        const pointerDistance = Math.hypot(pointerDx, pointerDy) || 1;
        const influence = shortSide * 0.23;

        if (pointerDistance < influence) {
          const push = Math.pow(1 - pointerDistance / influence, 2) * 0.34;
          forceX += (pointerDx / pointerDistance) * push;
          forceY += (pointerDy / pointerDistance) * push;
        }
      }

      const textAvoidance = obstacleForce(individual);
      forceX += textAvoidance.x;
      forceY += textAvoidance.y;

      const margin = 28;
      if (individual.x < margin) forceX += (margin - individual.x) * 0.006;
      if (individual.x > width - margin) forceX -= (individual.x - width + margin) * 0.006;
      if (individual.y < margin) forceY += (margin - individual.y) * 0.006;
      if (individual.y > height - margin) forceY -= (individual.y - height + margin) * 0.006;

      return limit({ x: forceX, y: forceY }, 0.18);
    });

    fish.forEach((individual, index) => {
      individual.vx += forces[index].x * step;
      individual.vy += forces[index].y * step;

      const velocity = limit(
        { x: individual.vx, y: individual.vy },
        individual.maxSpeed
      );
      individual.vx = velocity.x;
      individual.vy = velocity.y;
      individual.x += individual.vx * step;
      individual.y += individual.vy * step;

      individual.trail.push({ x: individual.x, y: individual.y });
      if (individual.trail.length > 17) individual.trail.shift();
    });
  }

  function drawWater() {
    const centerX = width * 0.51;
    const centerY = height * 0.49;
    const radius = Math.min(width, height) * 0.36;
    const glow = context.createRadialGradient(
      centerX,
      centerY,
      radius * 0.05,
      centerX,
      centerY,
      radius
    );

    glow.addColorStop(0, "rgba(45, 63, 111, 0.075)");
    glow.addColorStop(0.56, "rgba(62, 81, 130, 0.035)");
    glow.addColorStop(1, "rgba(62, 81, 130, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }

  function drawTrail(individual) {
    if (individual.trail.length < 2) return;

    context.lineCap = "round";
    context.lineJoin = "round";

    context.save();
    context.beginPath();
    context.moveTo(individual.trail[0].x, individual.trail[0].y);
    for (let index = 1; index < individual.trail.length; index += 1) {
      context.lineTo(individual.trail[index].x, individual.trail[index].y);
    }
    context.strokeStyle = "rgba(33, 49, 92, " + 0.045 * individual.depth + ")";
    context.lineWidth = 4.6 * individual.depth;
    context.shadowBlur = 7;
    context.shadowColor = "rgba(35, 52, 97, 0.18)";
    context.stroke();
    context.restore();

    for (let index = 1; index < individual.trail.length; index += 1) {
      const progress = index / (individual.trail.length - 1);
      const previous = individual.trail[index - 1];
      const current = individual.trail[index];

      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.strokeStyle =
        "rgba(26, 43, 88, " +
        Math.pow(progress, 2.15) * 0.16 * individual.depth +
        ")";
      context.lineWidth = (0.25 + progress * 2.15) * individual.depth;
      context.stroke();
    }
  }

  function drawFish(individual) {
    const heading = Math.atan2(individual.vy, individual.vx);
    const speed = Math.hypot(individual.vx, individual.vy);
    const length = individual.body * individual.depth * (0.88 + speed * 0.1);
    const thickness = Math.max(1.15, length * 0.34);
    const tailWave = Math.sin(elapsed * 8.2 + individual.phase) * thickness * 0.52;
    const opacity = 0.48 + individual.depth * 0.35;

    context.save();
    context.translate(individual.x, individual.y);
    context.rotate(heading);
    context.shadowBlur = 4.5 * individual.depth;
    context.shadowColor = "rgba(27, 43, 84, 0.2)";

    context.beginPath();
    context.moveTo(-length * 0.72, 0);
    context.lineTo(-length * 1.26, -thickness * 0.72 + tailWave);
    context.lineTo(-length * 1.12, thickness * 0.72 + tailWave);
    context.closePath();
    context.fillStyle = "rgba(29, 45, 88, " + opacity * 0.5 + ")";
    context.fill();

    context.beginPath();
    context.ellipse(0, 0, length, thickness, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(24, 39, 80, " + opacity + ")";
    context.fill();

    context.beginPath();
    context.ellipse(
      length * 0.25,
      -thickness * 0.2,
      length * 0.3,
      thickness * 0.22,
      -0.18,
      0,
      Math.PI * 2
    );
    context.fillStyle = "rgba(255, 255, 255, 0.17)";
    context.fill();

    context.restore();
  }

  function drawSchool() {
    context.clearRect(0, 0, width, height);
    drawWater();

    fish
      .slice()
      .sort((first, second) => first.depth - second.depth)
      .forEach((individual) => {
        drawTrail(individual);
        drawFish(individual);
      });

    if (pointer.active && !reducedMotion.matches) {
      context.beginPath();
      context.arc(pointer.x, pointer.y, Math.min(width, height) * 0.07, 0, Math.PI * 2);
      context.strokeStyle = "rgba(38, 56, 102, 0.13)";
      context.lineWidth = 1;
      context.stroke();
    }
  }

  function animate(timestamp) {
    if (!lastFrame) lastFrame = timestamp;
    const delta = Math.min((timestamp - lastFrame) / 1000, 0.034);
    lastFrame = timestamp;
    elapsed += delta;
    steerSchool(delta * 60);
    drawSchool();
    frameId = window.requestAnimationFrame(animate);
  }

  function shouldAnimate() {
    return !reducedMotion.matches && !userPaused && !document.hidden && inViewport;
  }

  function syncAnimation() {
    if (shouldAnimate()) {
      if (!frameId) {
        lastFrame = 0;
        frameId = window.requestAnimationFrame(animate);
      }
    } else if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
      drawSchool();
    }
  }

  function updateToggle() {
    if (!toggle) return;

    const paused = userPaused || reducedMotion.matches;
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute(
      "aria-label",
      paused ? "Play fish school animation" : "Pause fish school animation"
    );
    toggle.querySelector(".dynamics-toggle-icon").textContent = paused ? "▶" : "Ⅱ";
    toggle.hidden = reducedMotion.matches;
  }

  figure.addEventListener("pointermove", (event) => {
    if (reducedMotion.matches) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = true;
  });

  figure.addEventListener("pointerleave", () => {
    pointer.active = false;
  });

  if (toggle) {
    toggle.addEventListener("click", () => {
      userPaused = !userPaused;
      updateToggle();
      syncAnimation();
    });
  }

  document.addEventListener("visibilitychange", syncAnimation);
  reducedMotion.addEventListener("change", () => {
    updateToggle();
    syncAnimation();
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        inViewport = entries[0].isIntersecting;
        syncAnimation();
      },
      { threshold: 0.08 }
    );
    observer.observe(figure);
  }

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resize);
    observer.observe(figure);
  } else {
    window.addEventListener("resize", resize);
  }

  resize();
  updateToggle();
  syncAnimation();
})();
