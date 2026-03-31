(function () {
  /** @type {Array<{trigger:string,name:string,description:string,aliases:string[]}> | null} */
  let commandCache = null;
  let cacheExpiry = 0;
  const CACHE_TTL = 5 * 60 * 1000;
  let maxSuggestions = 6;
  let dropdownPosition = "above";

  fetch("/api/extensions")
    .then((r) => r.json())
    .then((data) => {
      const plugin = (data.plugins ?? []).find((p) => p.id === "plugin-auto-bang");
      const val = parseInt(plugin?.settings?.maxSuggestions, 10);
      if (!isNaN(val) && val > 0) maxSuggestions = val;
      if (plugin?.settings?.position === "below") dropdownPosition = "below";
    })
    .catch(() => {});

  /** @returns {Promise<typeof commandCache>} */
  async function fetchCommands() {
    if (commandCache && Date.now() < cacheExpiry) return commandCache;
    try {
      const res = await fetch("/api/commands", { cache: "no-store" });
      if (!res.ok) return commandCache ?? [];
      const data = await res.json();
      commandCache = data.commands ?? [];
      cacheExpiry = Date.now() + CACHE_TTL;
      return commandCache;
    } catch {
      return commandCache ?? [];
    }
  }

  /**
   * @param {string} q
   * @param {{trigger:string,name:string,aliases:string[]}} c
   * @returns {number|null}
   */
  function scoreCommand(q, c) {
    const trigger = c.trigger.toLowerCase();
    const name = c.name.toLowerCase();
    const aliases = (c.aliases ?? []).map((a) => a.toLowerCase());

    if (trigger === q) return 0;
    if (aliases.some((a) => a === q)) return 1;
    if (trigger.startsWith(q)) return 10 + trigger.length;
    if (aliases.some((a) => a.startsWith(q))) return 20 + Math.min(...aliases.filter((a) => a.startsWith(q)).map((a) => a.length));
    if (name.startsWith(q)) return 30 + name.length;

    const tIdx = trigger.indexOf(q);
    if (tIdx !== -1) return 50 + tIdx + trigger.length;

    const nIdx = name.indexOf(q);
    if (nIdx !== -1) return 70 + nIdx + name.length;

    return null;
  }

  /**
   * @param {string} query
   * @param {Array<{trigger:string,name:string,description:string,aliases:string[]}>} commands
   */
  function filterCommands(query, commands) {
    const q = query.toLowerCase();
    if (!q) return commands.slice(0, maxSuggestions);

    /** @type {Array<{c: typeof commands[0], score: number}>} */
    const scored = [];
    for (const c of commands) {
      const score = scoreCommand(q, c);
      if (score !== null) scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, maxSuggestions).map((s) => s.c);
  }

  /** @param {HTMLInputElement} input */
  function attachBangAutocomplete(input) {
    if (input.dataset.bangAcInit) return;
    input.dataset.bangAcInit = "1";

    const effectivePosition = input.id === "results-search-input" ? "below" : dropdownPosition;


    const dropdown = document.createElement("div");
    dropdown.className = "bang-ac-dropdown";
    dropdown.style.display = "none";

    const wrapper = input.closest(".search-input-wrap, .search-bar, form") ?? input.parentElement;
    if (!wrapper) return;
    wrapper.style.position = "relative";
    wrapper.appendChild(dropdown);

    let selectedIdx = -1;
    let debounceTimer = null;

    /**
     * @param {Array<{trigger:string,name:string,description:string,aliases:string[]}>} commands
     */
    function render(commands) {
      if (!commands.length) { hide(); return; }
      selectedIdx = -1;

      if (effectivePosition === "below") {
        dropdown.style.bottom = "";
        dropdown.style.top = "calc(100% + 4px)";
      } else {
        dropdown.style.top = "";
        dropdown.style.bottom = "calc(100% + 4px)";
      }

      const display = effectivePosition === "below" ? commands : [...commands].reverse();
      dropdown.innerHTML = display.map((c) =>
        `<div class="bang-ac-item" data-trigger="${c.trigger}">
          <span class="bang-ac-trigger">!${c.trigger}</span>
          <span class="bang-ac-name">${c.name}</span>
          <span class="bang-ac-desc">${c.description}</span>
        </div>`
      ).join("");
      dropdown.style.display = "block";

      dropdown.querySelectorAll(".bang-ac-item").forEach((item) => {
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const trigger = item.dataset.trigger;
          if (trigger) {
            input.value = `!${trigger} `;
            input.focus();
            hide();
          }
        });
      });
    }

    function hide() {
      dropdown.style.display = "none";
      selectedIdx = -1;
    }

    function updateHighlight() {
      const items = dropdown.querySelectorAll(".bang-ac-item");
      const mirroredIdx = selectedIdx < 0 ? -1 : items.length - 1 - selectedIdx;
      items.forEach((el, i) => {
        el.classList.toggle("bang-ac-active", i === mirroredIdx);
      });
    }

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const val = input.value;
      if (!val.startsWith("!")) { hide(); return; }
      const afterBang = val.slice(1);
      if (afterBang.includes(" ")) { hide(); return; }
      debounceTimer = setTimeout(async () => {
        const commands = await fetchCommands();
        const filtered = filterCommands(afterBang, commands);
        render(filtered);
      }, 80);
    });

    input.addEventListener("keydown", (e) => {
      if (dropdown.style.display === "none") return;
      const items = dropdown.querySelectorAll(".bang-ac-item");
      if (!items.length) return;

      const selectedTrigger = () => {
        if (selectedIdx < 0) return null;
        return items[items.length - 1 - selectedIdx]?.dataset.trigger ?? null;
      };
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
        updateHighlight();
        const t = selectedTrigger();
        if (t) input.value = `!${t} `;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, -1);
        updateHighlight();
        if (selectedIdx === -1) {
          const afterBang = input.value.slice(1).split(" ")[0];
          input.value = `!${afterBang}`;
        } else {
          const t = selectedTrigger();
          if (t) input.value = `!${t} `;
        }
      } else if (e.key === "Escape") {
        hide();
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (selectedIdx >= 0) {
          const t = selectedTrigger();
          if (t) { input.value = `!${t} `; hide(); }
        } else if (items.length) {
          const t = items[items.length - 1]?.dataset.trigger;
          if (t) { input.value = `!${t} `; hide(); }
        }
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(hide, 150);
    });

    input.addEventListener("focus", () => {
      const val = input.value;
      if (val.startsWith("!") && !val.slice(1).includes(" ")) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const commands = await fetchCommands();
          const filtered = filterCommands(val.slice(1), commands);
          render(filtered);
        }, 80);
      }
    });
  }

  function initInputs() {
    const ids = ["search-input", "results-search-input"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) attachBangAutocomplete(el);
    });
  }

  const obs = new MutationObserver(initInputs);
  obs.observe(document.body, { childList: true, subtree: true });
  initInputs();
})();
