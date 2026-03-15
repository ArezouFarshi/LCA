const DEFAULT_API_BASE = "https://oracle-ml-oracle-backend.onrender.com/api/lca";
const params = new URLSearchParams(window.location.search);
const PANEL_ID = params.get("panel_id") || "ID_27_C_42";
const API_URL = params.get("api_url") || `${DEFAULT_API_BASE}/${encodeURIComponent(PANEL_ID)}`;
const REFRESH_MS = Number(params.get("refresh_ms") || 60000);

const palette = {
  blue: "#53749a",
  gold: "#af8e57",
  green: "#6c945f",
  orange: "#d08b38",
  softOrange: "rgba(208, 139, 56, 0.24)",
  softGreen: "rgba(106, 160, 112, 0.22)",
  softBlue: "rgba(83, 116, 154, 0.18)",
  muted: "#6a7785",
  line: "#c9d2dc"
};

let charts = {};
let autoRefreshHandle = null;

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
  box.textContent = message;
  box.classList.remove("hidden");
}

function clearError() {
  const box = document.getElementById("errorBox");
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
  destroyChart(name);
  charts[name] = new Chart(ctx, config);
}

function buildEmbodiedLegend(components) {
  const container = document.getElementById("embodiedLegend");
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

function renderLedger(records) {
  const body = document.getElementById("ledgerBody");

  if (!records.length) {
    body.innerHTML = `
      <tr>
        <td colspan="11" class="small-muted">No daily LCA records available.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = records.map((rec) => {
    const ok = !rec.chain_error && rec.chain_tx_hash;
    const statusClass = ok ? "status-ok" : "status-fail";
    const statusText = ok ? "Anchored" : (rec.chain_error ? "Issue" : "Pending");

    return `
      <tr>
        <td>${escapeHtml(formatDay(rec.day))}</td>
        <td>${fmtNumber(rec.measured_u_dyn_daily, 4)}</td>
        <td>${fmtNumber(rec.baseline_u_value, 4)}</td>
        <td>${fmtNumber(rec.delta_u, 4)}</td>
        <td>${fmtNumber(rec.extra_energy_kwh_day, 4)}</td>
        <td>${fmtNumber(rec.operational_co2_delta_kg, 4)}</td>
        <td>${fmtNumber(rec.cumulative_operational_co2_delta_kg, 4)}</td>
        <td class="hash-cell" title="${escapeHtml(rec.snapshot_hash_hex || '')}">${escapeHtml(shortenHash(rec.snapshot_hash_hex))}</td>
        <td class="tx-cell" title="${escapeHtml(rec.chain_tx_hash || '')}">${escapeHtml(shortenHash(rec.chain_tx_hash))}</td>
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
  setText("updatedSubtitle", `Source ${API_URL}`);

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
  const outdoor = records.map((r) => r.out_temp_daily_c ?? null);

  upsertChart("uChart", document.getElementById("uChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Measured Dynamic U-Value",
          data: measured,
          borderColor: palette.blue,
          backgroundColor: palette.softBlue,
          borderWidth: 2.4,
          pointRadius: 2,
          tension: 0.25,
          yAxisID: "y"
        },
        {
          label: "Baseline U-Value",
          data: baseline,
          borderColor: palette.gold,
          borderDash: [7, 5],
          borderWidth: 2.1,
          pointRadius: 0,
          tension: 0,
          yAxisID: "y"
        },
        {
          label: "Outdoor Temperature (°C)",
          data: outdoor,
          borderColor: palette.green,
          borderDash: [4, 4],
          borderWidth: 1.8,
          pointRadius: 0,
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
          title: { display: true, text: "U-Value (W/m²K)" },
          grid: { color: "rgba(201,210,220,0.35)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Outdoor Temperature (°C)" },
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
            label: (ctx) => `${ctx.label}: ${fmtNumber(ctx.raw, 2)} kgCO₂e`
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
              : ""
          }
        }
      }
    }
  });

  document.getElementById("operationalRingText").innerHTML = `
    <strong>${fmtNumber(cumulative, 2)} kgCO₂e</strong>
    Total cumulative operational CO₂ increase<br>
    <span class="small-muted">Latest daily increment: ${fmtNumber(latestDaily, 4)} kgCO₂e</span>
  `;
}

async function fetchData() {
  clearError();
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    render(payload);
  } catch (err) {
    showError(`Unable to load LCA data from ${API_URL}. ${err.message}`);
  }
}

function render(payload) {
  const baseline = payload?.baseline || {};
  const panelId = payload?.panel_id || baseline?.panel_id || PANEL_ID;
  const records = (payload?.operational_daily || payload?.baseline?.operational_history || [])
    .slice()
    .sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")));
  const replacements = (payload?.replacement_events || payload?.baseline?.replacement_history || [])
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  renderCards(baseline, records, panelId);
  renderUChart(records);
  renderEnergyChart(records);
  renderCarbonChart(records);
  renderEmbodiedChart(baseline);
  renderOperationalRing(baseline, records);
  renderReplacementTimeline(replacements, baseline?.current_totals?.current_embodied_kgco2e ?? baseline?.baseline_environmental_profile?.total_embodied_kgco2e ?? 0);
  renderLedger(records);
}

function init() {
  document.getElementById("refreshBtn").addEventListener("click", fetchData);
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
