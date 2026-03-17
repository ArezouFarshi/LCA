const DEFAULT_API_BASE = "https://oracle-ml-oracle-backend.onrender.com/api/lca";
const params = new URLSearchParams(window.location.search);
const PANEL_ID = params.get("panel_id") || "ID_27_C_42";
const RAW_API_URL = params.get("api_url") || `${DEFAULT_API_BASE}/${encodeURIComponent(PANEL_ID)}`;
const REFRESH_MS = Number(params.get("refresh_ms") || 60000);

const PRIMARY_PROFILE_OPTIONS = [
  { value: "lombardy_gas_boiler", label: "Lombardy gas boiler" },
  { value: "lombardy_heat_pump", label: "Lombardy heat pump" }
];

let selectedPrimaryProfile = params.get("pe_profile") || "lombardy_heat_pump";

const palette = {
  blue: "#53749a",
  gold: "#af8e57",
  green: "#6c945f",
  teal: "#4f8a8b",
  orange: "#d08b38",
  softOrange: "rgba(208, 139, 56, 0.24)",
  softGreen: "rgba(106, 160, 112, 0.22)",
  softBlue: "rgba(83, 116, 154, 0.18)",
  softPurple: "rgba(97, 84, 141, 0.20)",
  purple: "#61548d",
  muted: "#6a7785",
  line: "#c9d2dc"
};

if (window.Chart) {
  Chart.defaults.color = "#334155";
}

let charts = {};
let autoRefreshHandle = null;

function buildApiUrl() {
  try {
    const u = new URL(RAW_API_URL, window.location.href);
    if (selectedPrimaryProfile) {
      u.searchParams.set("pe_profile", selectedPrimaryProfile);
    }
    return u.toString();
  } catch (_) {
    const hasQuery = RAW_API_URL.includes("?");
    const base = RAW_API_URL.split("?")[0];
    const q = hasQuery ? RAW_API_URL.split("?")[1] : "";
    const parts = q ? q.split("&").filter(Boolean).filter((x) => !x.startsWith("pe_profile=")) : [];
    if (selectedPrimaryProfile) {
      parts.push(`pe_profile=${encodeURIComponent(selectedPrimaryProfile)}`);
    }
    return parts.length ? `${base}?${parts.join("&")}` : base;
  }
}

function fmtNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtUnit(value, unit, digits = 2) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? `— ${unit}`
    : `${fmtNumber(value, digits)} ${unit}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shortenHash(value, start = 10, end = 8) {
  if (!value) return "—";
  const s = String(value);
  if (s.length <= start + end + 3) return s;
  return `${s.slice(0, start)}…${s.slice(-end)}`;
}

function formatDay(dayStr) {
  if (!dayStr) return "—";
  return dayStr;
}

function formatStoredTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showError(message) {
  const box = document.getElementById("errorBox");
  if (!box) return;
  box.textContent = message;
  box.classList.remove("hidden");
}

function clearError() {
  const box = document.getElementById("errorBox");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    charts[name] = null;
  }
}

function upsertChart(name, ctx, config) {
  if (!ctx) return;
  destroyChart(name);
  charts[name] = new Chart(ctx, config);
}

function findSectionForElement(el) {
  if (!el) return null;

  let node = el;
  while (node && node !== document.body) {
    if (
      node.matches &&
      node.matches(".dashboard-card, .section-card, .card, .panel, .module, .widget, .box")
    ) {
      return node;
    }

    if (node.querySelector) {
      const heading = node.querySelector(":scope > h1, :scope > h2, :scope > h3");
      if (heading) {
        return node;
      }
    }

    node = node.parentElement;
  }

  return el.parentElement || null;
}

function findDirectChildContaining(section, el) {
  if (!section || !el) return null;
  return Array.from(section.children).find((child) => child === el || child.contains(el)) || null;
}

function mostCommonParent(sections) {
  const counts = new Map();

  sections.forEach((section) => {
    if (section?.parentElement) {
      counts.set(section.parentElement, (counts.get(section.parentElement) || 0) + 1);
    }
  });

  let best = null;
  let max = 0;

  for (const [parent, count] of counts.entries()) {
    if (count > max) {
      max = count;
      best = parent;
    }
  }

  return best;
}

function applyPrimaryEnergyWideLayout() {
  const chartEl = document.getElementById("primaryEnergyChart");
  const summaryEl = document.getElementById("primaryEnergySummary");
  const selectEl = document.getElementById("primaryEnergyProfileSelect");
  const section = findSectionForElement(chartEl);

  if (!section) return null;

  section.style.gridColumn = "1 / -1";
  section.style.width = "100%";

  const chartBlock = findDirectChildContaining(section, chartEl);
  const summaryBlock = findDirectChildContaining(section, summaryEl);
  const selectBlock = findDirectChildContaining(section, selectEl);

  let layout = section.querySelector(":scope > .primary-energy-layout");
  let leftCol = section.querySelector(":scope > .primary-energy-layout > .primary-energy-left");
  let rightCol = section.querySelector(":scope > .primary-energy-layout > .primary-energy-right");

  if (!layout) {
    layout = document.createElement("div");
    layout.className = "primary-energy-layout";
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "minmax(0, 2.15fr) minmax(320px, 1fr)";
    layout.style.gap = "24px";
    layout.style.alignItems = "start";
    layout.style.width = "100%";
    layout.style.marginTop = "16px";

    leftCol = document.createElement("div");
    leftCol.className = "primary-energy-left";
    leftCol.style.minWidth = "0";

    rightCol = document.createElement("div");
    rightCol.className = "primary-energy-right";
    rightCol.style.minWidth = "0";
    rightCol.style.display = "grid";
    rightCol.style.gridTemplateRows = "auto 1fr";
    rightCol.style.gap = "16px";
    rightCol.style.alignItems = "start";

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);

    if (chartBlock) {
      section.insertBefore(layout, chartBlock);
    } else {
      section.appendChild(layout);
    }
  }

  if (chartBlock && leftCol && chartBlock.parentElement !== leftCol) {
    leftCol.appendChild(chartBlock);
  }

  if (selectBlock && rightCol && selectBlock.parentElement !== rightCol) {
    rightCol.appendChild(selectBlock);
  }

  if (summaryBlock && rightCol && summaryBlock.parentElement !== rightCol) {
    rightCol.appendChild(summaryBlock);
  }

  if (chartBlock) {
    chartBlock.style.height = "360px";
    chartBlock.style.minHeight = "360px";
  }

  if (summaryBlock) {
    summaryBlock.style.height = "100%";
  }

  return section;
}

function arrangeDashboardLayout() {
  const uSection = findSectionForElement(document.getElementById("uChart"));
  const embodiedSection = findSectionForElement(document.getElementById("embodiedChart"));
  const energySection = findSectionForElement(document.getElementById("energyChart"));
  const replacementSection = findSectionForElement(document.getElementById("replacementTimeline"));
  const carbonSection = findSectionForElement(document.getElementById("carbonChart"));
  const operationalSummarySection = findSectionForElement(document.getElementById("operationalRingChart"));
  const primaryEnergySection = applyPrimaryEnergyWideLayout();
  const ledgerSection = findSectionForElement(document.getElementById("ledgerBody"));

  const orderedSections = [
    uSection,
    embodiedSection,
    energySection,
    replacementSection,
    carbonSection,
    operationalSummarySection,
    primaryEnergySection,
    ledgerSection
  ].filter(Boolean);

  const gridParent = mostCommonParent(orderedSections);

  if (!gridParent) return;

  orderedSections.forEach((section) => {
    if (section.parentElement === gridParent) {
      gridParent.appendChild(section);
    }
  });
}

function ensurePrimaryProfileSelector(activeProfile) {
  const select = document.getElementById("primaryEnergyProfileSelect");
  if (!select) return;

  if (!select.dataset.initialized) {
    select.innerHTML = PRIMARY_PROFILE_OPTIONS.map((opt) => `
      <option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>
    `).join("");

    select.addEventListener("change", () => {
      selectedPrimaryProfile = select.value || "lombardy_heat_pump";
      fetchData();
    });

    select.dataset.initialized = "1";
  }

  const targetValue = activeProfile || selectedPrimaryProfile || "lombardy_heat_pump";
  if ([...select.options].some((o) => o.value === targetValue)) {
    select.value = targetValue;
  }
}

function buildEmbodiedLegend(components) {
  const container = document.getElementById("embodiedLegend");
  if (!container) return;

  if (!components.length) {
    container.innerHTML = `<div class="small-muted">No embodied-component data available.</div>`;
    return;
  }

  const colors = [palette.blue, palette.gold, palette.green, "#8f6fb1", "#c76d6d", "#5f998f"];
  container.innerHTML = components.map((comp, idx) => {
    const color = colors[idx % colors.length];
    return `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${color}"></span>
        <span>${escapeHtml(comp.component_code)} (${fmtNumber(comp.embodied_kgco2, 2)} kgCO₂e)</span>
      </div>
    `;
  }).join("");
}

function renderReplacementTimeline(replacements, baselineTotal) {
  const wrap = document.getElementById("replacementTimeline");
  if (!wrap) return;

  const items = [];

  items.push(`
    <div class="timeline-entry">
      <div class="timeline-title">Installation / Baseline Record</div>
      <div class="timeline-meta">Initial embodied inventory recorded: ${fmtNumber(baselineTotal, 2)} kgCO₂e</div>
      <div class="timeline-note">Monitoring remains active for future net embodied-carbon updates.</div>
    </div>
  `);

  if (!replacements.length) {
    items.push(`
      <div class="timeline-empty">
        <div>
          <strong>No replacement event recorded yet.</strong><br>
          Future component replacements will appear here with their embodied-carbon delta.
        </div>
      </div>
    `);
    wrap.innerHTML = items.join("");
    return;
  }

  replacements.forEach((evt) => {
    items.push(`
      <div class="timeline-entry">
        <div class="timeline-title">Replacement: ${escapeHtml(evt.component_code)}</div>
        <div class="timeline-meta">Removed: ${fmtNumber(evt.removed_embodied_kgco2, 2)} kgCO₂e • Added: ${fmtNumber(evt.added_embodied_kgco2, 2)} kgCO₂e</div>
        <div class="timeline-note">Net embodied-carbon delta: ${fmtNumber(evt.net_embodied_delta_kgco2, 2)} kgCO₂e</div>
      </div>
    `);
  });

  wrap.innerHTML = items.join("");
}

function buildSepoliaTxUrl(txHash) {
  if (!txHash) return "";
  return `https://sepolia.etherscan.io/tx/${encodeURIComponent(String(txHash).trim())}`;
}

function buildSepoliaSearchUrl(value) {
  if (!value) return "";
  return `https://sepolia.etherscan.io/search?f=0&q=${encodeURIComponent(String(value).trim())}`;
}

function renderLedger(records) {
  const body = document.getElementById("ledgerBody");
  if (!body) return;

  if (!records.length) {
    body.innerHTML = `
      <tr>
        <td colspan="11" class="small-muted">No daily LCA records available.</td>
      </tr>
    `;
    return;
  }

  const ledgerRecords = [...records].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );

  body.innerHTML = ledgerRecords.map((rec) => {
    const ok = !rec.chain_error && rec.chain_tx_hash;
    const statusClass = ok ? "status-ok" : "status-fail";
    const statusText = ok ? "Anchored" : (rec.chain_error ? "Issue" : "Pending");

    const snapshotHash = rec.snapshot_hash_hex || "";
    const chainTxHash = rec.chain_tx_hash || "";

    const txCell = chainTxHash
      ? `
        <a
          href="${buildSepoliaTxUrl(chainTxHash)}"
          target="_blank"
          rel="noopener noreferrer"
          class="hash-link"
          title="${escapeHtml(chainTxHash)}"
        >${escapeHtml(shortenHash(chainTxHash))}</a>
      `
      : "—";

    return `
      <tr>
        <td>${escapeHtml(formatDay(rec.day))}</td>
        <td>${fmtNumber(rec.measured_u_dyn_daily, 4)}</td>
        <td>${fmtNumber(rec.baseline_u_value, 4)}</td>
        <td>${fmtNumber(rec.delta_u, 4)}</td>
        <td>${fmtNumber(rec.extra_energy_kwh_day, 4)}</td>
        <td>${fmtNumber(rec.operational_co2_delta_kg, 4)}</td>
        <td>${fmtNumber(rec.cumulative_operational_co2_delta_kg, 4)}</td>
        <td class="tx-cell">${txCell}</td>
        <td>${escapeHtml(formatStoredTimestamp(rec.timestamp))}</td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
      </tr>
    `;
  }).join("");
}

function renderCards(baseline, records, panelId) {
  const baselineProfile = baseline?.baseline_environmental_profile || {};
  const currentTotals = baseline?.current_totals || {};
  const baselineTotal = currentTotals.current_embodied_kgco2e ?? baselineProfile.total_embodied_kgco2e;
  const statusText = records.length ? "Active monitoring" : "No daily data yet";

  setText("pageTitle", `Façade LCA Lifecycle Monitor: ${panelId}`);
  setText("panelSubtitle", `Panel ${panelId}`);
  setText("statusSubtitle", statusText);
  setText("updatedSubtitle", " ");

  setText("cardPanelId", panelId || "—");
  setText("cardBaselineU", fmtUnit(baselineProfile.baseline_u_value_w_m2k, "W/m²K", 2));
  setText("cardEmbodied", fmtUnit(baselineTotal, "kgCO₂e", 2));
  setText("cardOperational", fmtUnit(currentTotals.cumulative_operational_co2e_kg, "kgCO₂e", 2));
  setText("cardExtraEnergy", fmtUnit(currentTotals.latest_extra_energy_kwh, "kWh/day", 3));
  setText("cardRecordCount", String(records.length));
}

function renderUChart(records) {
  const labels = records.map((r) => formatDay(r.day));
  const measured = records.map((r) => r.measured_u_dyn_daily ?? null);
  const baseline = records.map((r) => r.baseline_u_value ?? null);
  const deltaU = records.map((r) => r.delta_u ?? null);
  const outdoor = records.map((r) => r.out_temp_daily_c ?? null);
  const indoor = records.map((r) => r.room_temp_daily_c ?? null);

  upsertChart("uChart", document.getElementById("uChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Measured U-Value",
          data: measured,
          borderColor: palette.blue,
          backgroundColor: "rgba(83, 116, 154, 0.18)",
          fill: "+1",
          borderWidth: 2.4,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y",
          order: 1
        },
        {
          label: "Baseline U-Value",
          data: baseline,
          borderColor: palette.gold,
          borderDash: [7, 5],
          borderWidth: 2.1,
          pointRadius: 0,
          tension: 0,
          yAxisID: "y",
          order: 2
        },
        {
          label: "ΔU (Measured − Baseline)",
          data: deltaU,
          borderColor: palette.orange,
          borderDash: [3, 5],
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.18,
          yAxisID: "y",
          order: 3
        },
        {
          label: "Indoor Temperature (°C)",
          data: indoor,
          borderColor: palette.teal,
          borderDash: [8, 4],
          borderWidth: 1.9,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: "y1",
          order: 4
        },
        {
          label: "Outdoor Temperature (°C)",
          data: outdoor,
          borderColor: palette.green,
          borderDash: [4, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: "y1",
          order: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || "";
              const value = ctx.raw;
              if (value === null || value === undefined) return `${label}: —`;
              if (label.includes("Temperature")) {
                return `${label}: ${fmtNumber(value, 3)} °C`;
              }
              return `${label}: ${fmtNumber(value, 4)} W/m²K`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Historical Performance Day" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y: {
          title: { display: true, text: "U-Value / ΔU (W/m²K)" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Temperature (°C)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderEnergyChart(records) {
  const labels = records.map((r) => formatDay(r.day));
  const daily = records.map((r) => Number(r.extra_energy_kwh_day || 0));
  let running = 0;
  const cumulative = daily.map((v) => {
    running += v;
    return Number(running.toFixed(6));
  });

  upsertChart("energyChart", document.getElementById("energyChart"), {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily Added Energy Consumption (kWh/day)",
          data: daily,
          backgroundColor: palette.softGreen,
          borderColor: palette.green,
          borderWidth: 1.2,
          yAxisID: "y"
        },
        {
          type: "line",
          label: "Cumulative Added Energy Consumption (kWh)",
          data: cumulative,
          borderColor: palette.green,
          backgroundColor: "transparent",
          borderWidth: 2.2,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" }
      },
      scales: {
        x: {
          title: { display: true, text: "Historical Performance Day" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y: {
          title: { display: true, text: "Daily Added Energy (kWh/day)" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Cumulative Added Energy (kWh)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderCarbonChart(records) {
  const labels = records.map((r) => formatDay(r.day));
  const daily = records.map((r) => Number(r.operational_co2_delta_kg || 0));
  const cumulative = records.map((r) => Number(r.cumulative_operational_co2_delta_kg || 0));

  upsertChart("carbonChart", document.getElementById("carbonChart"), {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily Operational CO₂ Increment (kg)",
          data: daily,
          backgroundColor: palette.softOrange,
          borderColor: palette.orange,
          borderWidth: 1.2,
          yAxisID: "y"
        },
        {
          type: "line",
          label: "Cumulative Operational CO₂ Increase (kg)",
          data: cumulative,
          borderColor: palette.orange,
          backgroundColor: "transparent",
          borderWidth: 2.2,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" }
      },
      scales: {
        x: {
          title: { display: true, text: "Historical Performance Day" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y: {
          title: { display: true, text: "Daily CO₂ Increment (kg)" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Cumulative CO₂ Increase (kg)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderEmbodiedChart(baseline) {
  const comps = Array.isArray(baseline?.baseline_components) ? baseline.baseline_components : [];
  buildEmbodiedLegend(comps);

  upsertChart("embodiedChart", document.getElementById("embodiedChart"), {
    type: "doughnut",
    data: {
      labels: comps.map((c) => c.component_code),
      datasets: [{
        data: comps.map((c) => Number(c.embodied_kgco2 || 0)),
        backgroundColor: [palette.blue, palette.gold, palette.green, "#8f6fb1", "#c76d6d", "#5f998f"],
        borderColor: "#ffffff",
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${fmtNumber(ctx.raw, 2)} kgCO₂e`;
          }
        }
      }
    }
  });
}

function renderOperationalRing(baseline, records) {
  const cumulative = Number(baseline?.current_totals?.cumulative_operational_co2e_kg || 0);
  const latestDaily = Number(records.length ? records[records.length - 1].operational_co2_delta_kg || 0 : 0);
  const chartMax = Math.max(cumulative, 1);

  upsertChart("operationalRingChart", document.getElementById("operationalRingChart"), {
    type: "doughnut",
    data: {
      labels: ["Cumulative Operational CO₂ Increase", "Spacer"],
      datasets: [{
        data: [cumulative, Math.max(chartMax - cumulative, 0.0001)],
        backgroundColor: [palette.orange, "#ece8e0"],
        borderColor: "#ffffff",
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataIndex === 0
              ? `${fmtNumber(ctx.raw, 4)} kgCO₂e`
              : "";
          }
        }
      }
    }
  });

  const target = document.getElementById("operationalRingText");
  if (!target) return;

  target.innerHTML = `
    <strong>${fmtNumber(cumulative, 2)} kgCO₂e</strong>
    Total cumulative operational CO₂ increase<br>
    <span class="small-muted">Latest daily increment: ${fmtNumber(latestDaily, 4)} kgCO₂e</span>
  `;
}

function renderPrimaryEnergyChart(records) {
  const canvas = document.getElementById("primaryEnergyChart");
  if (!canvas) return;

  const labels = records.map((r) => formatDay(r.day));
  const daily = records.map((r) => {
    const v = r.primary_total_kwh_day;
    return v === null || v === undefined ? null : Number(v);
  });
  const cumulative = records.map((r) => {
    const v = r.cumulative_primary_total_kwh;
    return v === null || v === undefined ? null : Number(v);
  });

  upsertChart("primaryEnergyChart", canvas, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily Heating Primary Energy (kWh/day)",
          data: daily,
          backgroundColor: palette.softPurple,
          borderColor: palette.purple,
          borderWidth: 1.2,
          yAxisID: "y"
        },
        {
          type: "line",
          label: "Cumulative Heating Primary Energy (kWh)",
          data: cumulative,
          borderColor: palette.purple,
          backgroundColor: "transparent",
          borderWidth: 2.2,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" }
      },
      scales: {
        x: {
          title: { display: true, text: "Historical Performance Day" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y: {
          title: { display: true, text: "Daily Primary Energy (kWh/day)" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Cumulative Primary Energy (kWh)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderPrimaryEnergySummary(baseline, records, activeProfile) {
  const wrap = document.getElementById("primaryEnergySummary");
  if (!wrap) return;

  const assumption = baseline?.primary_energy_assumption || {};
  const currentTotals = baseline?.current_totals || {};
  const latestRecord = records.length ? records[records.length - 1] : null;

  const scenarioLabel = assumption?.scenario_label || activeProfile || "Heating scenario";
  const carrier = assumption?.carrier || "—";
  const latestDaily = currentTotals?.latest_primary_total_kwh ?? latestRecord?.primary_total_kwh_day ?? null;
  const cumulative = currentTotals?.cumulative_primary_total_kwh ?? latestRecord?.cumulative_primary_total_kwh ?? null;
  const latestRen = currentTotals?.latest_primary_renewable_kwh ?? latestRecord?.primary_renewable_kwh_day ?? null;
  const latestNren = currentTotals?.latest_primary_non_renewable_kwh ?? latestRecord?.primary_non_renewable_kwh_day ?? null;

  const hasPrimaryData = latestDaily !== null || cumulative !== null || latestRen !== null || latestNren !== null;

  if (!hasPrimaryData) {
    wrap.innerHTML = `
      <div class="small-muted">
        Primary-energy values are not available yet for the selected heating scenario.
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <div class="primary-energy-summary-block">
      <div><strong>${escapeHtml(scenarioLabel)}</strong></div>
      <div class="small-muted">Carrier: ${escapeHtml(carrier)}</div>
      <div class="primary-energy-grid">
        <div><span class="small-muted">Latest daily primary energy</span><br><strong>${fmtUnit(latestDaily, "kWh", 3)}</strong></div>
        <div><span class="small-muted">Cumulative primary energy</span><br><strong>${fmtUnit(cumulative, "kWh", 3)}</strong></div>
        <div><span class="small-muted">Latest renewable share</span><br><strong>${fmtUnit(latestRen, "kWh", 3)}</strong></div>
        <div><span class="small-muted">Latest non-renewable share</span><br><strong>${fmtUnit(latestNren, "kWh", 3)}</strong></div>
      </div>
    </div>
  `;
}

async function fetchData() {
  clearError();
  const apiUrl = buildApiUrl();

  try {
    const response = await fetch(apiUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    render(payload);
  } catch (err) {
    showError(`Unable to load LCA data from ${apiUrl}. ${err.message}`);
  }
}

function render(payload) {
  const baseline = payload?.baseline || {};
  const activeProfile = payload?.active_primary_energy_profile || selectedPrimaryProfile || "lombardy_heat_pump";
  const panelId = payload?.panel_id || baseline?.panel_id || PANEL_ID;
  const records = (payload?.operational_daily || payload?.baseline?.operational_history || [])
    .slice()
    .sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")));
  const replacements = (payload?.replacement_events || payload?.baseline?.replacement_history || [])
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  selectedPrimaryProfile = activeProfile;
  ensurePrimaryProfileSelector(activeProfile);

  renderCards(baseline, records, panelId);
  renderUChart(records);
  renderEnergyChart(records);
  renderCarbonChart(records);
  renderEmbodiedChart(baseline);
  renderOperationalRing(baseline, records);
  renderPrimaryEnergyChart(records);
  renderPrimaryEnergySummary(baseline, records, activeProfile);
  renderReplacementTimeline(
    replacements,
    baseline?.current_totals?.current_embodied_kgco2e ??
      baseline?.baseline_environmental_profile?.total_embodied_kgco2e ??
      0
  );
  renderLedger(records);

  requestAnimationFrame(arrangeDashboardLayout);
}

function init() {
  ensurePrimaryProfileSelector(selectedPrimaryProfile);

  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchData);
  }

  fetchData();

  if (REFRESH_MS > 0) {
    autoRefreshHandle = setInterval(fetchData, REFRESH_MS);
  }
}

window.addEventListener("beforeunload", () => {
  if (autoRefreshHandle) {
    clearInterval(autoRefreshHandle);
  }
});

init();
