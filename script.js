// ---- Configuration ----
// Paste the Web App URL you get after deploying apps-script/Code.gs as a
// Google Apps Script Web App (Deploy > New deployment > Web app > Execute
// as: Me, Who has access: Anyone). See README.md for the full walkthrough.
const APPS_SCRIPT_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

const REFRESH_HOURS = 10;
let ALL_JOBS = [];

async function loadJobs() {
  try {
    const res = await fetch("data/jobs.json", { cache: "no-store" });
    const data = await res.json();
    ALL_JOBS = data.jobs || [];
    renderStats(data);
    populateFilters(ALL_JOBS);
    renderTicker(ALL_JOBS);
    renderDispatches(ALL_JOBS);
  } catch (err) {
    console.error("Could not load job feed:", err);
    document.getElementById("dispatchList").innerHTML =
      '<li class="dispatch empty">The feed couldn\'t be loaded. Try refreshing the page.</li>';
  }
}

function timeAgo(isoDate) {
  if (!isoDate) return "unknown";
  const then = new Date(isoDate);
  const diffMs = Date.now() - then.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderStats(data) {
  document.getElementById("statCount").textContent = data.job_count ?? ALL_JOBS.length;
  const cities = new Set(ALL_JOBS.map(j => (j.city || "").trim()).filter(Boolean));
  document.getElementById("statCities").textContent = cities.size;
  document.getElementById("statUpdated").textContent = data.generated_at ? timeAgo(data.generated_at) : "pending";

  const nextEl = document.getElementById("nextRefresh");
  if (data.generated_at) {
    const next = new Date(new Date(data.generated_at).getTime() + REFRESH_HOURS * 3600000);
    nextEl.textContent = `Refreshes every ${REFRESH_HOURS} hours \u2014 next refresh around ${next.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}.`;
  }

  document.getElementById("dateline").textContent =
    `TEXAS, USA \u2014 ${cities.size} CITIES \u2014 UPDATED ${data.generated_at ? timeAgo(data.generated_at).toUpperCase() : "PENDING"}`;
}

function populateFilters(jobs) {
  const citySelect = document.getElementById("cityFilter");
  const sourceSelect = document.getElementById("sourceFilter");
  const cities = [...new Set(jobs.map(j => (j.city || "").trim()).filter(Boolean))].sort();
  const sources = [...new Set(jobs.map(j => j.source).filter(Boolean))].sort();

  cities.forEach(city => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    citySelect.appendChild(opt);
  });
  sources.forEach(source => {
    const opt = document.createElement("option");
    opt.value = source;
    opt.textContent = source;
    sourceSelect.appendChild(opt);
  });
}

function renderTicker(jobs) {
  const track = document.getElementById("tickerTrack");
  if (!jobs.length) {
    track.innerHTML = '<span class="ticker-item">No dispatches on file yet \u2014 check back after the next refresh.</span>';
    return;
  }
  const headlines = jobs.slice(0, 20).map(j => `${j.title} \u2014 ${j.city}, TX`);
  const doubled = [...headlines, ...headlines];
  track.innerHTML = doubled.map(h => `<span class="ticker-item">${escapeHtml(h)}</span>`).join("");
}

function renderDispatches(jobs) {
  const list = document.getElementById("dispatchList");
  const countEl = document.getElementById("resultCount");

  if (!jobs.length) {
    list.innerHTML = '<li class="dispatch empty">No jobs on file yet. The feed refreshes every 10 hours \u2014 check back soon.</li>';
    countEl.textContent = "";
    return;
  }

  countEl.textContent = `${jobs.length} shown`;

  list.innerHTML = jobs.map(job => `
    <li class="dispatch">
      <p class="dispatch-meta">${escapeHtml(job.city || "TX")}, TX \u2014 ${job.days_old != null ? job.days_old + "d old" : ""} \u2014 ${escapeHtml(job.source || "")}</p>
      <h3 class="dispatch-title"><a href="${escapeAttr(job.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(job.title || "Untitled role")}</a></h3>
      <p class="dispatch-company">${escapeHtml(job.company || "Undisclosed employer")}</p>
      ${job.description ? `<p class="dispatch-desc">${escapeHtml(job.description)}${job.description.length >= 280 ? "\u2026" : ""}</p>` : ""}
      <div class="dispatch-tags">
        ${job.salary ? `<span class="tag salary">${escapeHtml(job.salary)}</span>` : ""}
        <span class="tag">${escapeHtml(job.posted_date || "")}</span>
      </div>
    </li>
  `).join("");
}

function applyFilters() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const city = document.getElementById("cityFilter").value;
  const source = document.getElementById("sourceFilter").value;

  const filtered = ALL_JOBS.filter(j => {
    if (city && j.city !== city) return false;
    if (source && j.source !== source) return false;
    if (search) {
      const haystack = `${j.title} ${j.company}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  renderDispatches(filtered);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("cityFilter").addEventListener("change", applyFilters);
document.getElementById("sourceFilter").addEventListener("change", applyFilters);

// ---- Resume form submission ----
const resumeForm = document.getElementById("resumeForm");
const formStatus = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");

resumeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (APPS_SCRIPT_URL.includes("PASTE_YOUR")) {
    formStatus.textContent = "Form isn't connected yet \u2014 the site owner needs to add the Apps Script URL in script.js.";
    formStatus.classList.add("error");
    return;
  }

  const fileInput = document.getElementById("resumeFile");
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    formStatus.textContent = "That file is over 5MB. Please upload a smaller file.";
    formStatus.classList.add("error");
    return;
  }

  submitBtn.disabled = true;
  formStatus.classList.remove("error");
  formStatus.textContent = "Uploading\u2026";

  try {
    const base64 = await fileToBase64(file);
    const payload = new FormData();
    payload.append("fullName", resumeForm.fullName.value);
    payload.append("email", resumeForm.email.value);
    payload.append("preferredCity", resumeForm.preferredCity.value);
    payload.append("keywords", resumeForm.keywords.value);
    payload.append("fileName", file.name);
    payload.append("mimeType", file.type || "application/octet-stream");
    payload.append("resumeData", base64);
    payload.append("submittedAt", new Date().toISOString());

    // Apps Script web apps redirect through googleusercontent.com, which
    // usually strips CORS headers on the redirected response even though
    // the POST itself succeeds server-side. We fire the request and treat
    // it as submitted once it settles, rather than depending on reading
    // the response body.
    await fetch(APPS_SCRIPT_URL, { method: "POST", body: payload }).catch(() => null);

    formStatus.textContent = "Resume received. We'll email you once matching jobs come through the feed.";
    resumeForm.reset();
  } catch (err) {
    console.error(err);
    formStatus.textContent = "Something went wrong reading that file. Try again or use a different file.";
    formStatus.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

loadJobs();
