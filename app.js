const gradeOrder = ["HG", "RG", "MG", "MGSD", "MGEX", "PG", "PGU", "EG", "SD", "RE/100", "FM", "OTHER"];

const state = { quotes: [], filtered: [], meta: {} };
const els = {
  rows: document.querySelector("#price-rows"),
  search: document.querySelector("#search"),
  grade: document.querySelector("#grade"),
  status: document.querySelector("#status"),
  total: document.querySelector("#metric-total"),
  verified: document.querySelector("#metric-verified"),
  priced: document.querySelector("#metric-priced"),
  count: document.querySelector("#record-count"),
  note: document.querySelector("#update-note"),
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const money = (cents) => cents == null ? "待提取" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
const date = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value)) : "—";
const datetime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "尚未自动同步";
const statusLabels = { verified: "已核对", extracted: "自动提取", pending: "待复核" };

function render() {
  const query = els.search.value.trim().toLowerCase();
  const grade = els.grade.value;
  const status = els.status.value;
  state.filtered = state.quotes.filter((item) => {
    const haystack = `${item.modelName} ${item.videoTitle} ${item.grade}`.toLowerCase();
    return (!query || haystack.includes(query)) && (grade === "all" || item.grade === grade) && (status === "all" || item.status === status);
  });

  els.rows.innerHTML = state.filtered.length ? state.filtered.map((item) => `
    <tr>
      <td class="model"><strong>${escapeHtml(item.modelName)}</strong><small>${escapeHtml(item.scale || "比例未标注")} · 可信度 ${Number(item.confidence || 0)}%</small></td>
      <td><span class="grade grade--${escapeHtml(item.grade)}">${escapeHtml(item.grade)}</span></td>
      <td><span class="price ${item.priceCents == null ? "price--pending" : ""}">${money(item.priceCents)}</span>${item.priceType === "coupon" && item.priceCents != null ? '<span class="coupon">券后</span>' : ""}${(item.alternativePrices || []).map(alt => `<small class="quote-alternative">${escapeHtml(alt.label)} ${money(alt.priceCents)}</small>`).join("")}</td>
      <td><span title="${escapeHtml(item.notes)}" class="status status--${item.status === "verified" ? "verified" : "pending"}">${statusLabels[item.status] || "待复核"}</span></td>
      <td class="date">${date(item.publishedAt)}</td>
      <td><a class="source" href="${escapeHtml(item.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.videoTitle)}</a>${["subtitle_title_crosscheck", "local_auto_subtitle"].includes(item.extractionMethod) ? `<details class="quote-evidence"><summary>字幕依据 · P${Number(item.evidence?.page || 1)} · ${Number(item.evidence?.startSeconds || 0).toFixed(1)}秒</summary><p>${escapeHtml(item.evidence?.text)}</p><p>${escapeHtml(item.notes)}</p><small>字幕或本地转写提取，未核对原视频画面。</small></details>` : ""}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty">没有匹配的型号，请清除筛选条件后重试。</td></tr>';

  els.total.textContent = state.quotes.length;
  els.verified.textContent = state.quotes.filter((item) => item.status === "verified").length;
  els.priced.textContent = state.quotes.filter((item) => item.priceCents != null).length;
  els.count.textContent = `显示 ${state.filtered.length} / ${state.quotes.length} 条记录`;
}

function setGrades() {
  const available = new Set(state.quotes.map((item) => item.grade));
  els.grade.innerHTML = '<option value="all">全部等级</option>' + gradeOrder.filter((grade) => available.has(grade)).map((grade) => `<option value="${grade}">${grade}</option>`).join("");
}

async function load() {
  try {
    const response = await fetch("/data/prices.json", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.records)) throw new Error("Invalid price dataset");
    state.quotes = payload.records;
    state.meta = payload.meta || {};
    const schedule = state.meta.scheduleLabel || "每日检查";
    if (state.meta.check?.ok === false) {
      els.note.textContent = `最近尝试 ${datetime(state.meta.check.lastAttemptAt)} 未完成 · 上次成功 ${datetime(state.meta.lastSyncAt)} · 当前保留旧数据`;
      els.note.setAttribute("role", "status");
    } else if (!state.meta.lastSyncAt) {
      els.note.textContent = `尚无成功采集记录 · 当前为初始数据 · 计划${schedule}`;
    } else {
      const stale = Date.now() - Date.parse(state.meta.lastSyncAt) > 48 * 60 * 60 * 1000;
      els.note.textContent = `最近成功检查 ${datetime(state.meta.lastSyncAt)} · ${schedule}${stale ? " · 超过两天未更新，请留意数据日期" : ""}`;
    }
    if (state.meta.lastSubtitleImportAt) els.note.textContent += ` · 字幕导入 ${datetime(state.meta.lastSubtitleImportAt)}（${Number(state.meta.lastSubtitleImportVideos || 0)}条视频）`;
    if (state.meta.localCollection) {
      const local = state.meta.localCollection;
      els.note.textContent = `本机采集：${local.ok === true ? "最近完整检查" : "本次未完成，保留已有记录"} ${datetime(local.attemptedAt)} · 上次完整检查 ${datetime(local.lastSuccessAt)} · 导入 ${Number(state.meta.lastLocalImportParts || 0)}个分P`;
      if (local.lastSuccessAt && Date.now() - Date.parse(local.lastSuccessAt) > 48 * 3600000) els.note.textContent += " · 超过两天未成功检查，请启动本机采集";
      if (state.meta.check?.ok === false) els.note.textContent += " · 云端接口采集仍失败";
    }
  } catch (error) {
    console.error(error);
    els.rows.innerHTML = '<tr><td colspan="6" class="empty">价格文件暂时不可用，请稍后刷新。</td></tr>';
    els.note.textContent = "价格数据读取失败";
    return;
  }
  setGrades();
  render();
}

[els.search, els.grade, els.status].forEach((element) => element.addEventListener("input", render));
load();
