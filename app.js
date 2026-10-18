const gradeOrder = ["HG", "RG", "MG", "MGSD", "MGEX", "PG", "PGU", "EG", "SD", "RE", "FM", "MB", "OTHER"];
const displayGrade = (grade) => ["RE/100", "RE100", "RE"].includes(grade) ? "RE" : grade;

const state = { quotes: [], filtered: [], meta: {}, sort: { key: "date", direction: "desc" } };
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
const date = (value) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—";
const datetime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "尚未自动同步";
const statusLabels = { verified: "已核对", extracted: "自动提取", pending: "待复核", manual: "手动添加" };
const safeSource = value => { try { const url=new URL(value); return url.protocol==='https:'&&!url.username&&!url.password ? url.href : null; } catch { return null; } };
function hasProductImage(item) {
  const photo=item.productImage;
  return photo && ((photo.kind==='manual-upload' && /^\/uploads\/[a-f0-9]{64}\.jpg$/.test(photo.url) && photo.sourceUrl===photo.url) || (/^https:\/\/(?:bandai-a\.akamaihd\.net|staticcdn\.bandaihobbysite\.cn)\//.test(photo.url) && /^https:\/\/(?:www\.bandaispirits\.co\.jp|bandaihobbysite\.cn)\//.test(photo.sourceUrl)));
}
function productVisual(item) {
  if(!hasProductImage(item))return '<figure class="product-visual product-visual--pending" title="暂无可唯一确认的商品图片"><span class="product-photo-fallback">待配图</span></figure>';
  const photo=item.productImage;
  return `<figure class="product-visual"><a href="${escapeHtml(photo.sourceUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(photo.credit)}"><img class="product-photo" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}" width="96" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a><span class="product-photo-fallback">图片暂不可用</span></figure>`;
}
els.rows.addEventListener('error',event=>{
  if(event.target?.classList?.contains('product-photo')){
    event.target.hidden=true;
    event.target.closest('.product-visual')?.classList.add('image-unavailable');
  }
},true);

function sortValue(item, key) {
  return key === "price" ? (typeof item.priceCents === "number" && Number.isFinite(item.priceCents) ? item.priceCents : null) : (Number.isFinite(Date.parse(item.publishedAt)) ? Date.parse(item.publishedAt) : null);
}
function compareQuotes(a, b) {
  const left = sortValue(a, state.sort.key), right = sortValue(b, state.sort.key);
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  return (left - right) * (state.sort.direction === "asc" ? 1 : -1);
}
function sortBy(key) {
  if (!["price", "date"].includes(key)) return;
  state.sort = { key, direction: state.sort.key === key ? (state.sort.direction === "asc" ? "desc" : "asc") : (key === "price" ? "asc" : "desc") };
  render();
}
function render() {
  const query = els.search.value.trim().toLowerCase();
  const grade = els.grade.value;
  const status = els.status.value;
  state.filtered = state.quotes.filter((item) => {
    const haystack = `${item.modelName} ${item.videoTitle} ${item.grade} ${displayGrade(item.grade)}`.toLowerCase();
    return (!query || haystack.includes(query)) && (grade === "all" || displayGrade(item.grade) === grade) && (status === "all" || item.status === status);
  }).sort(compareQuotes);
  for (const key of ["price", "date"]) {
    const active = state.sort.key === key;
    document.querySelector(`#${key}-header`).setAttribute("aria-sort", active ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");
    document.querySelector(`#${key}-sort-indicator`).textContent = active ? (state.sort.direction === "asc" ? "↑" : "↓") : "↕";
    const label = key === "price" ? "价格" : "日期";
    document.querySelector(`#sort-${key}`).setAttribute("aria-label", `${label}，${active ? (state.sort.direction === "asc" ? "当前升序，点击降序" : "当前降序，点击升序") : "点击排序"}`);
  }

  els.rows.innerHTML = state.filtered.length ? state.filtered.map((item) => `
    <tr>
      <td class="model"><div class="product-cell">${productVisual(item)}<div><strong>${escapeHtml(item.modelName)}</strong><small>${escapeHtml(item.scale || "比例未标注")} · ${item.manual ? '站长手动记录' : `可信度 ${Number(item.confidence || 0)}%`}</small>${hasProductImage(item) ? `<a class="image-credit" href="${escapeHtml(item.productImage.sourceUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(item.productImage.credit)}">${item.productImage.kind==='manual-upload'?'站长上传图':'官方商品图'} ↗</a><small class="image-disclaimer" title="${escapeHtml(item.productImage.note)}">${escapeHtml(item.productImage.caption)}</small>` : '<small class="image-disclaimer">型号或版本待确认</small>'}<button type="button" class="image-upload-button" data-image-record="${escapeHtml(item.id)}">${hasProductImage(item)?'更换图片':'上传图片'}</button></div></div></td>
      <td><span class="grade grade--${escapeHtml(displayGrade(item.grade))}">${escapeHtml(displayGrade(item.grade))}</span></td>
      <td><span class="price ${item.priceCents == null ? "price--pending" : ""}">${money(item.priceCents)}</span>${item.priceType === "coupon" && item.priceCents != null ? '<span class="coupon">券后</span>' : ""}${(item.alternativePrices || []).map(alt => `<small class="quote-alternative">${escapeHtml(alt.label)} ${money(alt.priceCents)}</small>`).join("")}</td>
      <td><span title="${escapeHtml(item.notes)}" class="status status--${item.status === "verified" ? "verified" : item.manual ? "manual" : "pending"}">${statusLabels[item.status] || "待复核"}</span></td>
      <td class="date">${date(item.publishedAt)}</td>
      <td>${item.manual ? `<span class="manual-source">站长手动添加 · 非视频采集</span>${safeSource(item.sourceUrl)?`<br><a class="source" href="${escapeHtml(safeSource(item.sourceUrl))}" target="_blank" rel="noreferrer">查看商品来源 ↗</a>`:''}<p class="manual-notes">${escapeHtml(item.notes)}</p>` : `<a class="source" href="${escapeHtml(item.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.videoTitle)}</a>`}${["subtitle_title_crosscheck", "local_auto_subtitle", "local_auto_dual", "local_auto_visual"].includes(item.extractionMethod) ? `<details class="quote-evidence"><summary>${item.extractionMethod==='local_auto_dual'?'字幕＋画面证据':item.extractionMethod==='local_auto_visual'?'画面OCR证据':'字幕依据'} · P${Number(item.evidence?.page || 1)} · ${Number(item.evidence?.startSeconds || 0).toFixed(1)}秒</summary><p>${escapeHtml(item.evidence?.text)}</p><p>${escapeHtml(item.notes)}</p><small>${['local_auto_dual','local_auto_visual'].includes(item.extractionMethod)?'本机OCR自动提取，未人工核对；截图保存在本机 state/visual。':'字幕或本地转写提取，未核对原视频画面。'}</small></details>` : ""}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty">没有匹配的型号，请清除筛选条件后重试。</td></tr>';

  els.total.textContent = state.quotes.length;
  els.verified.textContent = state.quotes.filter((item) => item.status === "verified").length;
  els.priced.textContent = state.quotes.filter((item) => item.priceCents != null).length;
  els.count.textContent = `显示 ${state.filtered.length} / ${state.quotes.length} 条记录`;
}

function setGrades() {
  const available = new Set(state.quotes.map((item) => displayGrade(item.grade)));
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
    if(state.meta.imageCoverage)els.note.textContent+=` · 商品图 ${Number(state.meta.imageCoverage.withImage)}/${Number(state.meta.imageCoverage.total)}`;
    if(state.meta.visualCollection){
      const visual=state.meta.visualCollection;
      const labels={complete:'本轮检查完成',queued:'排队处理中',partial:'部分失败',blocked:'访问受限，已暂停',cache_full:'本机截图缓存已满',disabled:'已关闭'};
      els.note.textContent+=` · 画面OCR ${Number(visual.checkedParts||0)}/${Number(visual.totalParts||0)}分P（${labels[visual.status]||'尚未完成'}）`;
    }
  } catch (error) {
    console.error(error);
    els.rows.innerHTML = '<tr><td colspan="6" class="empty">价格文件暂时不可用，请稍后刷新。</td></tr>';
    els.note.textContent = "价格数据读取失败";
    return;
  }
  setGrades();
  render();
  globalThis.manualDataLoaded?.(state.meta);
}

[els.search, els.grade, els.status].forEach((element) => element.addEventListener("input", render));
["price", "date"].forEach((key) => document.querySelector(`#sort-${key}`).addEventListener("click", () => sortBy(key)));

function initializeColumnWidths() {
  const table = document.querySelector("#price-table");
  const columns = Array.from(document.querySelectorAll("#price-table col"));
  const handles = Array.from(document.querySelectorAll(".column-resizer"));
  const defaults = [340, 100, 190, 120, 140, 400];
  const minimums = [250, 90, 130, 115, 130, 180];
  const storageKey = "gunpla.column-widths.v1";
  let widths = [...defaults], dragging = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length === defaults.length && saved.every((width, i) => Number.isFinite(width) && width >= minimums[i] && width <= 1200)) widths = saved;
  } catch { /* Browser storage may be disabled; resizing still works. */ }
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* Keep session widths. */ } };
  const apply = () => {
    columns.forEach((column, i) => { column.style.width = `${widths[i]}px`; });
    table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    handles.forEach((handle, i) => {
      handle.setAttribute("aria-valuemin", minimums[i]);
      handle.setAttribute("aria-valuemax", 1200);
      handle.setAttribute("aria-valuenow", widths[i]);
      handle.setAttribute("aria-valuetext", `${widths[i]}像素`);
    });
  };
  const resize = (i, width) => { widths[i] = Math.max(minimums[i], Math.min(1200, Math.round(width))); apply(); };
  handles.forEach((handle, i) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || dragging) return;
      event.preventDefault();
      dragging = { index: i, x: event.clientX, width: widths[i], pointerId: event.pointerId };
      handle.setPointerCapture(event.pointerId);
      table.classList.add("is-resizing");
    });
    handle.addEventListener("pointermove", (event) => {
      if (dragging?.index === i && dragging.pointerId === event.pointerId) resize(i, dragging.width + event.clientX - dragging.x);
    });
    const finish = (event) => {
      if (dragging?.index !== i || dragging.pointerId !== event.pointerId) return;
      dragging = null;
      table.classList.remove("is-resizing");
      save();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      resize(i, event.key === "Home" ? minimums[i] : event.key === "End" ? 1200 : widths[i] + (event.key === "ArrowLeft" ? -10 : 10));
      save();
    });
  });
  document.querySelector("#reset-columns").addEventListener("click", () => { widths = [...defaults]; apply(); save(); });
  apply();
}
initializeColumnWidths();
load();
