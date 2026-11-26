(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const THEME_KEY = "tab-organizer-mock-color-scheme";

  function setNote(el, text, warn = false) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("is-warn", warn);
  }

  // Theme: Light / Dark / System (System = clear override, follow OS)
  const themeMeta = document.querySelector('meta[name="color-scheme"]');
  const themeToggles = document.querySelectorAll(".theme-toggle");

  function readStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function writeStoredTheme(value) {
    try {
      if (!value || value === "light dark") {
        localStorage.removeItem(THEME_KEY);
      } else {
        localStorage.setItem(THEME_KEY, value);
      }
    } catch {
      /* mock-only persistence; ignore quota / private mode */
    }
  }

  function currentThemeChoice() {
    const stored = readStoredTheme();
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  }

  function applyTheme(choice) {
    const content = choice === "system" ? "light dark" : choice;
    if (themeMeta) themeMeta.content = content;
    writeStoredTheme(choice === "system" ? null : content);
    themeToggles.forEach((group) => {
      group.querySelectorAll("[data-theme]").forEach((btn) => {
        const id = btn.getAttribute("data-theme");
        btn.setAttribute("aria-pressed", id === choice ? "true" : "false");
      });
    });
  }

  if (themeToggles.length) {
    applyTheme(currentThemeChoice());
    themeToggles.forEach((group) => {
      group.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-theme]");
        if (!btn || !group.contains(btn)) return;
        const choice = btn.getAttribute("data-theme");
        if (choice === "light" || choice === "dark" || choice === "system") {
          applyTheme(choice);
        }
      });
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== THEME_KEY) return;
      applyTheme(currentThemeChoice());
    });
  }

  // Organize progress demo
  const sweep = document.getElementById("sweep");
  const progressPanel = document.getElementById("progress-panel");
  const progress = document.getElementById("organize-progress");
  const progressLabel = document.getElementById("progress-label");
  const progressValue = document.getElementById("progress-value");
  const result = document.getElementById("result");

  if (sweep && progress && progressPanel) {
    let running = false;
    sweep.addEventListener("click", () => {
      if (running) return;
      running = true;
      sweep.disabled = true;
      if (result) result.hidden = true;
      progressPanel.hidden = false;
      progress.removeAttribute("value");
      if (progressLabel) progressLabel.textContent = "Scanning window…";
      if (progressValue) progressValue.textContent = "…";

      const start = performance.now();
      const duration = reduceMotion ? 400 : 1600;

      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        if (t < 0.18) {
          progress.removeAttribute("value");
          if (progressLabel) progressLabel.textContent = "Scanning window…";
          if (progressValue) progressValue.textContent = "…";
        } else {
          const pct = Math.round(((t - 0.18) / 0.82) * 100);
          progress.value = pct;
          if (progressLabel) {
            progressLabel.textContent =
              pct < 55 ? "Filing tabs into groups…" : pct < 90 ? "Applying rules…" : "Polishing titles…";
          }
          if (progressValue) progressValue.textContent = `${pct}%`;
        }
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          progress.value = 100;
          if (progressLabel) progressLabel.textContent = "Done";
          if (progressValue) progressValue.textContent = "100%";
          if (result) result.hidden = false;
          sweep.disabled = false;
          running = false;
          window.setTimeout(() => {
            if (!running) progressPanel.hidden = true;
          }, reduceMotion ? 200 : 900);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // Local model disclosure
  const llm = document.getElementById("llm");
  const llmControls = document.getElementById("llm-controls");
  if (llm && llmControls) {
    const sync = () => llmControls.classList.toggle("is-collapsed", !llm.checked);
    sync();
    llm.addEventListener("change", sync);
  }

  // File-new-tabs status copy
  const organizer = document.getElementById("organizer");
  const status = document.getElementById("status");
  if (organizer && status && status.closest("#settings, .popup-header, .settings-note, header")) {
    const syncStatus = () => {
      if (status.closest(".popup-header")) {
        status.textContent = organizer.checked
          ? "Filing on · 18 tabs · 4 groups"
          : "Filing off · 18 tabs · 4 groups";
      } else {
        status.textContent = organizer.checked
          ? "Organizer is filing new tabs in this window."
          : "Organizer is off.";
      }
    };
    organizer.addEventListener("change", syncStatus);
  }

  // Test Ollama / AI rename mock feedback
  const testOllama = document.getElementById("test-ollama");
  const modelStatus = document.getElementById("model-status");
  const model = document.getElementById("model");
  if (testOllama) {
    testOllama.addEventListener("click", () => {
      const name = model?.value || "llama3.2";
      setNote(modelStatus, `Connected · ${name} responded in 42ms`);
    });
  }

  const retitle = document.getElementById("retitle-groups");
  if (retitle) {
    retitle.addEventListener("click", () => {
      setNote(modelStatus, "AI rename finished · 3 groups updated (tabs stayed put)");
      const board = document.getElementById("rename-results");
      if (board) {
        board.hidden = false;
        board.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
      }
    });
  }

  // Expandable groups in popup
  document.querySelectorAll("[data-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".group-item");
      if (!item) return;
      const open = item.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  // Dashboard group color selects → swatch (--group-color)
  const chromeGroupColors = {
    grey: "#9ca3af",
    blue: "#3b82f6",
    red: "#ef4444",
    yellow: "#f59e0b",
    green: "#22c55e",
    pink: "#ec4899",
    purple: "#a855f7",
    cyan: "#06b6d4",
    orange: "#f97316",
  };
  document.querySelectorAll(".group-manage .color-field select").forEach((select) => {
    const row = select.closest(".group-manage");
    if (!row) return;
    const apply = () => {
      const hex = chromeGroupColors[select.value];
      if (hex) row.style.setProperty("--group-color", hex);
    };
    select.addEventListener("change", apply);
    apply();
  });

  // Activity filter on dashboard
  const actor = document.getElementById("activity-actor");
  if (actor) {
    actor.addEventListener("change", () => {
      const value = actor.value;
      document.querySelectorAll(".activity-list.full .activity-item").forEach((row) => {
        const match = value === "all" || row.getAttribute("data-actor") === value;
        row.hidden = !match;
      });
    });
  }

  // Rule form mock
  const ruleForm = document.getElementById("rule-form");
  const confirmation = document.getElementById("confirmation");
  if (ruleForm) {
    ruleForm.addEventListener("submit", (event) => {
      event.preventDefault();
      setNote(confirmation, "Preview: github.com → Code · gitlab.com → Code");
    });
  }

  const save = document.getElementById("save");
  if (save && confirmation) {
    save.addEventListener("click", () => {
      setNote(confirmation, "Saved rule · put github and gitlab in Code");
    });
  }
})();
