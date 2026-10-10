/* Viclaw site interactions. No dependencies. */
(function () {
  "use strict";

  // Sticky nav shadow
  var nav = document.getElementById("nav");
  var onScroll = function () {
    nav.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mobile menu
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  toggle.addEventListener("click", function () {
    var open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", function (e) {
    if (e.target.tagName === "A") links.classList.remove("open");
  });

  // Scroll reveal
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  // Provider tabs
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll("[role=tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-panel]"));
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabBtns.forEach(function (b) { b.setAttribute("aria-selected", "false"); });
      btn.setAttribute("aria-selected", "true");
      panels.forEach(function (p) {
        p.hidden = p.getAttribute("data-panel") !== btn.getAttribute("data-tab");
      });
    });
  });

  // Hero terminal typing loop (respects reduced motion)
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var typed = document.getElementById("typed");
  var script = [
    { t: "$ viclaw chat", c: "p" },
    { t: "fix the login redirect, add a test", c: "" },
    { t: "▸ Grep  \"redirect\"  →  src/auth.ts:42, src/routes.ts:17", c: "dim" },
    { t: "▸ Read  src/auth.ts → Edit → Bash  npm test", c: "dim" },
    { t: "✓ 3 passed · isolated change · no other files touched", c: "ok" },
    { t: "$ VICLAW_FREE_STACK=true viclaw chat", c: "p" },
    { t: "✓ answered via local Ollama · $0.00 this session", c: "ok" }
  ];
  function renderInstant() {
    typed.innerHTML = script
      .map(function (l) { return '<span class="' + l.c + '">' + escapeHtml(l.t) + "</span>"; })
      .join("\n");
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  if (reduceMotion) {
    renderInstant();
    return;
  }
  var li = 0, ci = 0, out = "";
  function tick() {
    if (li >= script.length) {
      setTimeout(function () { li = 0; ci = 0; out = ""; typed.innerHTML = ""; tick(); }, 4200);
      return;
    }
    var line = script[li];
    ci++;
    out = line.t.slice(0, ci);
    var done = script
      .slice(0, li)
      .map(function (l) { return '<span class="' + l.c + '">' + escapeHtml(l.t) + "</span>"; })
      .join("\n");
    typed.innerHTML = done + (li > 0 ? "\n" : "") + '<span class="' + line.c + '">' + escapeHtml(out) + "</span>";
    if (ci >= line.t.length) {
      li++;
      ci = 0;
      setTimeout(tick, line.c === "p" ? 500 : 900);
    } else {
      setTimeout(tick, line.c === "p" ? 34 : 12);
    }
  }
  // Start typing when the hero is visible
  if ("IntersectionObserver" in window) {
    var hero = document.querySelector(".terminal");
    var started = false;
    var heroIo = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !started) {
        started = true;
        tick();
        heroIo.disconnect();
      }
    });
    heroIo.observe(hero);
  } else {
    tick();
  }
})();
