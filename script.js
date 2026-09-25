(() => {
  "use strict";

  // Backend address: keep in sync with the port you start uvicorn on.
  const API_BASE = "http://127.0.0.1:8001";

  const $ = (sel, root = document) => root.querySelector(sel);
  const form = $("#predict-form");
  const submitBtn = $("#submit-btn");
  const panel = $("#result");
  const fill = $("#g-fill");
  const dot = $("#g-dot");
  const seg = $("#stress_group");
  const stressInput = $("#stress_level");
  const states = { idle: $("#st-idle"), loading: $("#st-loading"), result: $("#st-result"), error: $("#st-error") };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0;

  // ---------- Theme ----------
  $("#theme").addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("eq-theme", next); } catch (e) { /* storage unavailable */ }
  });

  // ---------- Validation ----------
  const NUMBER_RULES = {
    age: { int: true, min: 10, max: 100 },
    avg_daily_usage_hours: { min: 0, max: 24 },
    daily_unlocks: { int: true, min: 0 },
    study_hours: { min: 0, max: 24 },
    physical_activity_hours: { min: 0, max: 24 },
    sleep_hours_per_night: { min: 0, max: 24 },
  };
  const CHOICES = ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use", "stress_level"];

  function collect() {
    const f = new FormData(form);
    const num = (key, int) => {
      const v = String(f.get(key) ?? "").trim();
      return v === "" ? NaN : int ? parseInt(v, 10) : parseFloat(v);
    };
    const txt = (key) => String(f.get(key) ?? "").trim();
    return {
      age: num("age", true),
      gender: txt("gender"),
      country: txt("country"),
      academic_level: txt("academic_level"),
      most_used_platform: txt("most_used_platform"),
      purpose_of_use: txt("purpose_of_use"),
      avg_daily_usage_hours: num("avg_daily_usage_hours"),
      daily_unlocks: num("daily_unlocks", true),
      study_hours: num("study_hours"),
      physical_activity_hours: num("physical_activity_hours"),
      sleep_hours_per_night: num("sleep_hours_per_night"),
      stress_level: txt("stress_level"),
    };
  }

  function validate(p) {
    const errs = {};
    for (const [key, r] of Object.entries(NUMBER_RULES)) {
      const v = p[key];
      if (Number.isNaN(v)) errs[key] = "Enter a number.";
      else if (v < r.min || (r.max !== undefined && v > r.max)) {
        errs[key] = r.max !== undefined ? `Enter a value from ${r.min} to ${r.max}.` : `Enter ${r.min} or more.`;
      }
    }
    CHOICES.forEach((key) => { if (!p[key]) errs[key] = key === "country" ? "Enter a country." : "Choose an option."; });
    return errs;
  }

  function setError(name, msg) {
    const el = $(`.err[data-for="${name}"]`);
    if (el) el.textContent = msg || "";
    const target = name === "stress_level" ? seg : form.elements[name];
    if (target) msg ? target.setAttribute("aria-invalid", "true") : target.removeAttribute("aria-invalid");
  }

  function clearErrors() {
    Object.keys(NUMBER_RULES).concat(CHOICES).forEach((k) => setError(k, ""));
  }

  function applyServerErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let matched = false;
    detail.forEach((d) => {
      const key = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
      if (typeof key === "string" && $(`.err[data-for="${key}"]`)) {
        setError(key, d.msg || "Invalid value.");
        matched = true;
      }
    });
    return matched;
  }

  form.addEventListener("input", (e) => { if (e.target.name) setError(e.target.name, ""); });
  form.addEventListener("change", (e) => { if (e.target.name) setError(e.target.name, ""); });

  // ---------- Stress selector ----------
  function pick(value) {
    stressInput.value = value;
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));
    if (value) setError("stress_level", "");
  }
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) pick(b.dataset.value);
  });

  // ---------- Result panel ----------
  const BANDS = [
    { max: 4, key: "low", label: "Strained", text: "Your answers point to elevated strain. Small changes to sleep or screen time can make a real difference." },
    { max: 7, key: "mid", label: "Balanced", text: "Your routine looks fairly steady, with room to improve rest and recovery." },
    { max: Infinity, key: "high", label: "Strong", text: "Your habits point to a well-supported baseline. Keep it up." },
  ];
  const bandFor = (s) => BANDS.find((b) => s < b.max);

  function resetGauge() {
    cancelAnimationFrame(raf);
    fill.style.setProperty("--off", "100");
    dot.style.opacity = "0";
  }

  function draw(v) {
    fill.style.setProperty("--off", String(100 - v * 10));
    const a = Math.PI * (1 - v / 10);
    dot.setAttribute("cx", (120 + 100 * Math.cos(a)).toFixed(2));
    dot.setAttribute("cy", (140 - 100 * Math.sin(a)).toFixed(2));
    dot.style.opacity = "1";
  }

  function show(name) {
    Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
    panel.classList.toggle("is-loading", name === "loading");
    if (name !== "result") { delete panel.dataset.band; resetGauge(); }
  }

  function reveal(score) {
    const s = Math.max(0, Math.min(10, score));
    const band = bandFor(s);
    show("result");
    panel.dataset.band = band.key;
    $("#band").textContent = band.label;
    $("#context").textContent = band.text;

    const scoreEl = $("#score");
    const start = performance.now();
    const duration = reduceMotion ? 0 : 1100;
    const step = (now) => {
      const p = duration ? Math.min(1, (now - start) / duration) : 1;
      const v = s * (1 - Math.pow(1 - p, 3));
      draw(v);
      scoreEl.textContent = v.toFixed(2);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    if (matchMedia("(max-width: 900px)").matches) {
      panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function fail(title, copy) {
    $("#err-title").textContent = title;
    $("#err-copy").textContent = copy;
    show("error");
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle("busy", busy);
    submitBtn.setAttribute("aria-busy", String(busy));
  }

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = collect();
    const errs = validate(payload);
    clearErrors();
    Object.entries(errs).forEach(([k, msg]) => setError(k, msg));

    const bad = form.querySelector('[aria-invalid="true"]');
    if (bad) {
      (bad.matches("input,select") ? bad : bad.querySelector("button")).focus();
      return;
    }

    setBusy(true);
    show("loading");
    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 422) {
        const body = await res.json().catch(() => null);
        const matched = applyServerErrors(body && body.detail);
        return fail("Check your answers", matched
          ? "The server rejected some fields. They are marked in the form."
          : "The server rejected this submission. Review your answers and try again.");
      }
      if (!res.ok) {
        return fail("Something went wrong", `The server returned status ${res.status}. Check the backend terminal for details.`);
      }
      const data = await res.json();
      if (typeof data.predicted_mental_health_score !== "number") {
        return fail("Unexpected response", "The server replied, but the score was missing.");
      }
      reveal(data.predicted_mental_health_score);
    } catch (err) {
      fail("Can't reach the server", `Couldn't connect to ${API_BASE}. Start the backend with: uvicorn main:app --reload --port 8001`);
    } finally {
      setBusy(false);
    }
  });

  // ---------- Other actions ----------
  $("#retry").addEventListener("click", () => form.requestSubmit());
  $("#reset").addEventListener("click", () => {
    form.reset();
    pick("");
    clearErrors();
    show("idle");
    form.elements.age.focus();
  });
  $("#sample").addEventListener("click", () => {
    const sample = {
      age: 21, gender: "Female", country: "India", academic_level: "Undergraduate",
      most_used_platform: "Instagram", purpose_of_use: "Entertainment", avg_daily_usage_hours: 5.5,
      daily_unlocks: 80, study_hours: 4, physical_activity_hours: 1, sleep_hours_per_night: 6.5,
    };
    Object.entries(sample).forEach(([k, v]) => { form.elements[k].value = v; });
    pick("Medium");
    clearErrors();
  });
})();
