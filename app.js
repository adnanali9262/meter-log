const { useState, useEffect, useRef, useCallback } = React;

// ---------------- Storage (Chrome localStorage) ----------------
const STORAGE_KEY = "meter-readings-v1";

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { meter1: [], meter2: [] };
    const parsed = JSON.parse(raw);
    return {
      meter1: Array.isArray(parsed.meter1) ? parsed.meter1 : [],
      meter2: Array.isArray(parsed.meter2) ? parsed.meter2 : [],
    };
  } catch (e) {
    return { meter1: [], meter2: [] };
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------- Utilities ----------------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatTimeLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTimeShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSpan(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m span`;
  if (hours < 48) return `${hours.toFixed(1)}h span`;
  return `${(hours / 24).toFixed(1)}d span`;
}

// Sort readings chronologically and compute usage rate per consecutive pair,
// normalized to a 24-hour rate regardless of actual elapsed time.
// This correctly handles gaps (multi-day) and bursts (multiple same-day entries).
function computeRates(readings) {
  const sorted = [...readings].sort((a, b) => new Date(a.time) - new Date(b.time));
  const rates = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const deltaKwh = curr.value - prev.value;
    const deltaMs = new Date(curr.time) - new Date(prev.time);
    const deltaHours = deltaMs / 3600000;
    if (deltaHours <= 0) continue; // guard against duplicate/out-of-order timestamps
    const ratePerDay = (deltaKwh / deltaHours) * 24;
    rates.push({
      id: curr.id,
      time: curr.time,
      label: formatTimeShort(curr.time),
      rate: ratePerDay,
      deltaKwh,
      hours: deltaHours,
      spanLabel: formatSpan(deltaHours),
      fromTime: prev.time,
      toTime: curr.time,
      negative: deltaKwh < 0,
    });
  }
  return rates;
}

// ================= Lightweight SVG charts (no external chart library) =================
const CHART_PAD = { top: 12, right: 6, bottom: 18, left: 8 };
const VB_W = 300;
const VB_H = 140;

function niceDomain(values) {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padAmt = (max - min) * 0.12;
  return [min - padAmt, max + padAmt];
}

function buildScales(points, valueKey) {
  const innerW = VB_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = VB_H - CHART_PAD.top - CHART_PAD.bottom;
  const n = points.length;
  const [vMin, vMax] = niceDomain(points.map((p) => p[valueKey]));

  const xForIndex = (i) => CHART_PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yForValue = (v) => CHART_PAD.top + innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  return { xForIndex, yForValue, vMin, vMax, innerW, innerH };
}

function useChartTooltip() {
  const [hover, setHover] = useState(null); // { index, clientX, clientY }
  return [hover, setHover];
}

function LineChartSVG({ data, accent, valueKey, formatTooltip }) {
  const containerRef = useRef(null);
  const [hover, setHover] = useChartTooltip();

  if (data.length === 0) {
    return React.createElement("div", { className: "empty-state" },
      React.createElement("span", null, "No readings logged yet"));
  }
  if (data.length === 1) {
    return React.createElement("div", { className: "empty-state" },
      React.createElement("div", { className: "pulse", style: { background: accent } }),
      React.createElement("span", null, "1 reading logged — add another to plot a trend"));
  }

  const { xForIndex, yForValue } = buildScales(data, valueKey);
  const pathD = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(2)} ${yForValue(d[valueKey]).toFixed(2)}`)
    .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => CHART_PAD.top + t * (VB_H - CHART_PAD.top - CHART_PAD.bottom));
  const labelStep = Math.max(1, Math.ceil(data.length / 6));

  const handleMove = (evt) => {
    const svg = containerRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((evt.clientX - rect.left) / rect.width) * VB_W;
    let nearest = 0;
    let bestDist = Infinity;
    data.forEach((_, i) => {
      const dist = Math.abs(xForIndex(i) - relX);
      if (dist < bestDist) { bestDist = dist; nearest = i; }
    });
    setHover({ index: nearest, clientX: evt.clientX, clientY: evt.clientY });
  };

  const hoveredPoint = hover ? data[hover.index] : null;

  return React.createElement("div", { style: { position: "relative", width: "100%", height: "100%" } },
    React.createElement("svg", {
      ref: containerRef,
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: "none",
      style: { width: "100%", height: "100%", display: "block", cursor: "crosshair" },
      onMouseMove: handleMove,
      onMouseLeave: () => setHover(null),
      onTouchStart: (e) => handleMove(e.touches[0]),
      onTouchMove: (e) => { e.preventDefault(); handleMove(e.touches[0]); },
      onTouchEnd: () => setHover(null),
    },
      gridLines.map((y, i) =>
        React.createElement("line", {
          key: i, x1: CHART_PAD.left, x2: VB_W - CHART_PAD.right, y1: y, y2: y,
          stroke: "#1D2127", strokeWidth: 0.5, strokeDasharray: "3 3"
        })
      ),
      React.createElement("path", { d: pathD, fill: "none", stroke: accent, strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round" }),
      data.map((d, i) =>
        React.createElement("circle", {
          key: d.id || i, cx: xForIndex(i), cy: yForValue(d[valueKey]), r: hover && hover.index === i ? 3 : 2,
          fill: "#0B0D0F", stroke: accent, strokeWidth: 1.4
        })
      ),
      hover && React.createElement("line", {
        x1: xForIndex(hover.index), x2: xForIndex(hover.index),
        y1: CHART_PAD.top, y2: VB_H - CHART_PAD.bottom,
        stroke: accent, strokeWidth: 0.5, strokeOpacity: 0.35
      }),
      data.map((d, i) => (i % labelStep === 0 || i === data.length - 1) &&
        React.createElement("text", {
          key: "lbl-" + (d.id || i), x: xForIndex(i), y: VB_H - 4,
          fontSize: 7, fill: "#6B7078", textAnchor: "middle", fontFamily: "'JetBrains Mono', monospace"
        }, d.label)
      )
    ),
    hoveredPoint && React.createElement("div", {
      className: "tooltip-box",
      style: { position: "fixed", left: hover.clientX + 12, top: hover.clientY - 12, border: `1px solid ${accent}55`, zIndex: 10 }
    }, formatTooltip(hoveredPoint))
  );
}

function BarChartSVG({ data, accent, formatTooltip }) {
  const containerRef = useRef(null);
  const [hover, setHover] = useChartTooltip();

  if (data.length === 0) {
    return React.createElement("div", { className: "empty-state" },
      React.createElement("span", null, "No readings logged yet"));
  }

  const innerW = VB_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = VB_H - CHART_PAD.top - CHART_PAD.bottom;
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.min(slot * 0.55, 28);

  const values = data.map((d) => d.rate);
  let vMin = Math.min(0, ...values);
  let vMax = Math.max(0, ...values);
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const padAmt = (vMax - vMin) * 0.12;
  vMin -= padAmt; vMax += padAmt;

  const yForValue = (v) => CHART_PAD.top + innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  const zeroY = yForValue(0);
  const xForIndex = (i) => CHART_PAD.left + slot * i + slot / 2;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => CHART_PAD.top + t * innerH);
  const labelStep = Math.max(1, Math.ceil(n / 6));

  const handleMove = (evt) => {
    const svg = containerRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((evt.clientX - rect.left) / rect.width) * VB_W;
    let idx = Math.floor((relX - CHART_PAD.left) / slot);
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover({ index: idx, clientX: evt.clientX, clientY: evt.clientY });
  };

  const hoveredPoint = hover ? data[hover.index] : null;

  return React.createElement("div", { style: { position: "relative", width: "100%", height: "100%" } },
    React.createElement("svg", {
      ref: containerRef,
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: "none",
      style: { width: "100%", height: "100%", display: "block", cursor: "pointer" },
      onMouseMove: handleMove,
      onMouseLeave: () => setHover(null),
      onTouchStart: (e) => handleMove(e.touches[0]),
      onTouchMove: (e) => { e.preventDefault(); handleMove(e.touches[0]); },
      onTouchEnd: () => setHover(null),
    },
      gridLines.map((y, i) =>
        React.createElement("line", {
          key: i, x1: CHART_PAD.left, x2: VB_W - CHART_PAD.right, y1: y, y2: y,
          stroke: "#1D2127", strokeWidth: 0.5, strokeDasharray: "3 3"
        })
      ),
      React.createElement("line", {
        x1: CHART_PAD.left, x2: VB_W - CHART_PAD.right, y1: zeroY, y2: zeroY,
        stroke: "#2A2F37", strokeWidth: 0.6
      }),
      data.map((d, i) => {
        const y = yForValue(d.rate);
        const top = Math.min(y, zeroY);
        const h = Math.abs(y - zeroY);
        const isHovered = hover && hover.index === i;
        const fill = d.negative ? "#E0664A" : accent;
        return React.createElement("rect", {
          key: d.id, x: xForIndex(i) - barW / 2, y: top, width: barW, height: Math.max(h, 0.5),
          fill, opacity: isHovered ? 1 : 0.85, rx: 1.5
        });
      }),
      data.map((d, i) => (i % labelStep === 0 || i === data.length - 1) &&
        React.createElement("text", {
          key: "lbl-" + d.id, x: xForIndex(i), y: VB_H - 4,
          fontSize: 7, fill: "#6B7078", textAnchor: "middle", fontFamily: "'JetBrains Mono', monospace"
        }, d.label)
      )
    ),
    hoveredPoint && React.createElement("div", {
      className: "tooltip-box",
      style: { position: "fixed", left: hover.clientX + 12, top: hover.clientY - 12, border: `1px solid ${hoveredPoint.negative ? "#E0664A55" : accent + "55"}`, zIndex: 10 }
    }, formatTooltip(hoveredPoint))
  );
}

// ---------------- Tooltip content builders ----------------
function readingTooltipContent(p, accent) {
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "tooltip-time" }, formatTimeLabel(p.time)),
    React.createElement("div", { className: "tooltip-val", style: { color: accent } }, `${p.value.toFixed(2)} kWh`)
  );
}

function rateTooltipContent(p, accent) {
  const color = p.negative ? "#E0664A" : accent;
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "tooltip-time" }, formatTimeLabel(p.toTime)),
    React.createElement("div", { className: "tooltip-val", style: { color } }, `${p.rate.toFixed(2)} kWh / 24h`),
    React.createElement("div", { className: "tooltip-sub" },
      `${p.deltaKwh >= 0 ? "+" : ""}${p.deltaKwh.toFixed(2)} kWh over ${p.spanLabel}`)
  );
}

// ---------------- Meter Panel ----------------
function MeterPanel({ label, accent, readings, onAdd, onDelete }) {
  const [tab, setTab] = useState("rate"); // "rate" | "raw"
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (showInput && inputRef.current) inputRef.current.focus();
  }, [showInput]);

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed === "") { setError("Enter a reading value before adding."); return; }
    const num = Number(trimmed);
    if (Number.isNaN(num)) { setError("Reading must be a number."); return; }
    onAdd(num);
    setInputValue("");
    setShowInput(false);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") { setShowInput(false); setInputValue(""); setError(null); }
  };

  const sorted = [...readings].sort((a, b) => new Date(a.time) - new Date(b.time));
  const rawData = sorted.map((r) => ({ id: r.id, time: r.time, value: r.value, label: formatTimeShort(r.time) }));
  const rateData = computeRates(readings);
  const latest = sorted.length ? sorted[sorted.length - 1] : null;

  const chartBody = tab === "raw"
    ? React.createElement(LineChartSVG, {
        data: rawData, accent, valueKey: "value",
        formatTooltip: (p) => readingTooltipContent(p, accent)
      })
    : (rateData.length === 0
        ? React.createElement("div", { className: "empty-state" },
            React.createElement("span", null,
              readings.length === 1
                ? "1 reading logged — add another to see a usage rate"
                : "No readings logged yet"))
        : React.createElement(BarChartSVG, {
            data: rateData, accent,
            formatTooltip: (p) => rateTooltipContent(p, accent)
          })
      );

  return React.createElement("div", { className: "panel" },
    React.createElement("div", { className: "panel-header" },
      React.createElement("div", { className: "panel-header-left" },
        React.createElement("div", { className: "dot", style: { background: accent, boxShadow: `0 0 8px ${accent}` } }),
        React.createElement("span", { className: "panel-label" }, label)
      ),
      React.createElement("div", { className: "panel-reading" },
        React.createElement("span", { className: "val", style: { color: latest ? accent : "#4A4F58" } },
          latest ? latest.value.toFixed(2) : "—.——"),
        React.createElement("span", { className: "unit" }, "kWh")
      )
    ),
    React.createElement("div", { className: "tab-row" },
      React.createElement("button", {
        className: `tab-btn ${tab === "rate" ? "active" : ""}`,
        style: tab === "rate" ? { borderBottomColor: accent, color: "#E6E8EB" } : {},
        onClick: () => setTab("rate")
      }, "24h usage"),
      React.createElement("button", {
        className: `tab-btn ${tab === "raw" ? "active" : ""}`,
        style: tab === "raw" ? { borderBottomColor: accent, color: "#E6E8EB" } : {},
        onClick: () => setTab("raw")
      }, "Raw readings")
    ),
    React.createElement("div", { className: "chart-wrap" }, chartBody),
    React.createElement("div", { className: "add-section" },
      showInput
        ? React.createElement("div", { className: "add-form" },
            React.createElement("input", {
              ref: inputRef, type: "number", inputMode: "decimal", step: "any",
              placeholder: "Reading in kWh", value: inputValue,
              onChange: (e) => setInputValue(e.target.value),
              onKeyDown: handleKeyDown,
              style: { border: `1px solid ${accent}66` }
            }),
            React.createElement("button", {
              className: "log-btn", style: { background: accent }, onClick: handleSubmit
            }, "Log"),
            React.createElement("button", {
              className: "cancel-btn",
              onClick: () => { setShowInput(false); setInputValue(""); setError(null); }
            }, "Cancel")
          )
        : React.createElement("button", {
            className: "add-trigger",
            onClick: () => setShowInput(true),
            onMouseEnter: (e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; },
            onMouseLeave: (e) => { e.currentTarget.style.borderColor = "#2A2F37"; e.currentTarget.style.color = "#8A8F98"; }
          },
            React.createElement("span", null, "+"),
            " Add reading"
          ),
      error && React.createElement("div", { className: "field-error" }, error)
    ),
    readings.length > 0 && React.createElement("div", { className: "log-list" },
      [...sorted].reverse().map((r) =>
        React.createElement("div", { key: r.id, className: "log-row" },
          React.createElement("span", { className: "when" }, formatTimeLabel(r.time)),
          React.createElement("div", { className: "right" },
            React.createElement("span", { className: "value" }, `${r.value.toFixed(2)} kWh`),
            React.createElement("button", {
              className: "del", onClick: () => onDelete(r.id),
              onMouseEnter: (e) => e.currentTarget.style.color = "#E0664A",
              onMouseLeave: (e) => e.currentTarget.style.color = "#4A4F58"
            }, "✕")
          )
        )
      )
    )
  );
}

// ---------------- Main App ----------------
function App() {
  const [data, setData] = useState({ meter1: [], meter2: [] });
  const [saveFailed, setSaveFailed] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setData(loadAll());

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const persist = useCallback((next) => {
    const ok = saveAll(next);
    setSaveFailed(!ok);
  }, []);

  const addReading = (meterKey, value) => {
    const entry = { id: uid(), value, time: new Date().toISOString() };
    setData((prev) => {
      const next = { ...prev, [meterKey]: [...prev[meterKey], entry] };
      persist(next);
      return next;
    });
  };

  const deleteReading = (meterKey, id) => {
    setData((prev) => {
      const next = { ...prev, [meterKey]: prev[meterKey].filter((r) => r.id !== id) };
      persist(next);
      return next;
    });
  };

  const handleInstallClick = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  return React.createElement("div", { className: "container" },
    React.createElement("div", { className: "eyebrow" },
      React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" },
        React.createElement("path", { d: "M13 2L4 14h6l-1 8 9-12h-6l1-8z", fill: "#F2C14E" })
      ),
      React.createElement("span", null, "Energy Meter Log")
    ),
    React.createElement("h1", null, "Meter 1 & Meter 2"),
    React.createElement("p", { className: "subtitle" },
      "Log a reading whenever you check the meter. Timestamp is captured automatically. ",
      "24h usage shows the rate between consecutive readings, normalized per day — accurate even with gaps or multiple same-day entries."),

    installEvent && !installed && React.createElement("div", { className: "install-banner" },
      React.createElement("span", null, "Install Meter Log to your home screen for offline use."),
      React.createElement("button", { onClick: handleInstallClick }, "Install")
    ),

    saveFailed && React.createElement("div", { className: "banner danger" }, "⚠ Couldn't save last change. Storage may be full or blocked."),

    React.createElement("div", { className: "meters-grid" },
      React.createElement(MeterPanel, {
        label: "Meter 1", accent: "#3DD6C4", readings: data.meter1,
        onAdd: (v) => addReading("meter1", v), onDelete: (id) => deleteReading("meter1", id)
      }),
      React.createElement(MeterPanel, {
        label: "Meter 2", accent: "#F2C14E", readings: data.meter2,
        onAdd: (v) => addReading("meter2", v), onDelete: (id) => deleteReading("meter2", id)
      })
    ),

    React.createElement("div", { className: "install-hint" },
      React.createElement("strong", null, "Data storage: "), "all readings are saved in this browser's local storage on this device only — they won't sync to other devices or browsers. ",
      React.createElement("br"), React.createElement("br"),
      React.createElement("strong", null, "Install on Android: "), "open this page in Chrome, tap the ⋮ menu, then \"Add to Home screen\" (or use the Install button above if it appears)."
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
