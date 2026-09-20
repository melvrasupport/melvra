const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const CUSTOM_CAT = "__custom__";
const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Safe way to pass a text value (e.g. a category like  Men's Wear ) into an
// onclick="" attribute without breaking the page.
const jsArg = (s) => escapeHtml(JSON.stringify(String(s == null ? "" : s)));
const MAX_PHOTOS = 5;

const ui = { page: "dash", editId: null, newId: null, couponId: null };

// Tells the admin — visibly — whether their changes are really going online.
function paintSyncStatus(errMsg) {
  let el = $("#sync-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "sync-status";
    el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:60;width:" + (window.innerWidth > 900 ? "216px" : "min(92vw,360px)") + ";padding:8px 11px;border-radius:10px;font-size:12px;line-height:1.4;box-shadow:0 4px 18px rgba(0,0,0,.14);border:1px solid transparent";
    document.body.appendChild(el);
  }
  const info = MELVRA.syncInfo();
  let bg = "#e9f6ee", fg = "#1f5e3a", bd = "#bfe3cd", msg = "● Live sync ON";
  if (errMsg || info.lastError) {
    bg = "#fdecea"; fg = "#8a1f17"; bd = "#f3b9b3";
    msg = "⚠ Cloud problem: " + (errMsg || info.lastError);
  } else if (!info.configured) {
    bg = "#fff4dd"; fg = "#7a5200"; bd = "#f0d9a0";
    msg = "⚠ Cloud sync is not set up — changes stay on THIS device only.";
  } else if (!info.ready) {
    bg = "#fdecea"; fg = "#8a1f17"; bd = "#f3b9b3";
    msg = "⚠ Firebase did not load (blocked or offline). Changes will stay on THIS device only. Refresh with a working internet before adding products.";
  }
  el.style.background = bg; el.style.color = fg; el.style.borderColor = bd;
  el.textContent = msg;
}

// Shows a clear alert if a cloud save did not go through.
function reportFail(promise) {
  Promise.resolve(promise).then((r) => {
    if (r && r.ok === false) {
      paintSyncStatus(r.message);
      alert("⚠ This change was NOT saved online.\n\n" + r.message);
    }
  });
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function showGate(on) {
  $("#gate").style.display = on ? "grid" : "none";
  $("#shell").classList.toggle("on", !on);
}

async function login(e) {
  e.preventDefault();
  const user = $("#user").value;
  const pass = $("#pass").value;
  const ok = await MELVRA.checkLogin(user, pass);
  if (!ok) {
    $("#err").textContent = "Those keys do not open the atelier.";
    return;
  }
  MELVRA.setSession();
  $("#err").textContent = "";
  openStudio();
}

function logout() {
  MELVRA.clearSession();
  showGate(true);
}

// Live sync (and the download of customer orders) starts ONLY after a
// successful login — never for someone who merely opens admin.html.
let syncStarted = false;
function startAdminSync() {
  if (syncStarted) return;
  syncStarted = true;
  paintSyncStatus();
  MELVRA.startSync(refreshFromSync, { admin: true, onError: () => paintSyncStatus() });
  setTimeout(() => paintSyncStatus(), 4000);
}
function openStudio() {
  showGate(false);
  go("dash");
  startAdminSync();
}

const pageHistory = [];
function go(page, skipHistory, opts) {
  if (!skipHistory && ui.page && ui.page !== page) pageHistory.push(ui.page);
  ui.page = page;
  ui.editId = null;
  ui.couponId = null;
  // Also record this in real browser history, so the device/browser back
  // button steps back through Studio pages instead of leaving the panel
  // entirely (mirrors the same fix on the shop side).
  if (!(opts && opts.fromPopState)) {
    history.pushState({ melvraPage: page }, "", location.pathname + location.search);
  }
  $$(".side nav button[data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + page));
  if (page === "dash") renderDash();
  if (page === "products") renderProducts();
  if (page === "coupons") renderCoupons();
  if (page === "orders") renderOrders();
  if (page === "bills") renderBills();
  if (page === "notes") renderNotes();
  if (page === "reviews") renderReviews();
  if (page === "settings") renderSettings();
}
function studioBack() {
  // If a product/coupon editor is open, close it first instead of leaving the page.
  const prodEditor = $("#prod-editor");
  const coupEditor = $("#coup-editor");
  if (prodEditor && prodEditor.style.display === "block") { cancelEditor(); return; }
  if (coupEditor && coupEditor.style.display === "block") { coupEditor.style.display = "none"; return; }
  const prev = pageHistory.pop();
  go(prev || "dash", true);
}

function renderDash() {
  const products = MELVRA.catalog();
  const live = products.filter((p) => p.visible !== false);
  const orders = MELVRA.orders();
  // Revenue comes from Bills (permanent, never auto-removed) and skips
  // cancelled orders — the old figure shrank whenever delivered orders aged out.
  const revenue = MELVRA.bills().filter((o) => o.status !== "Cancelled").reduce((a, o) => a + (Number(o.total) || 0), 0);
  const low = products.filter((p) => (p.stock || 0) <= 8).length;
  const activeC = MELVRA.coupons().filter((c) => c.active).length;
  const reviewCount = MELVRA.reviews().length;
  $("#dash-stats").innerHTML = `
    <div class="stat"><span>Live pieces</span><b>${live.length}</b></div>
    <div class="stat"><span>Orders</span><b>${orders.length}</b></div>
    <div class="stat"><span>Recorded total</span><b>${inr(revenue)}</b></div>
    <div class="stat"><span>Low stock</span><b>${low}</b></div>
    <div class="stat"><span>Reviews</span><b>${reviewCount}</b></div>`;
  const recent = orders.slice(0, 6);
  $("#dash-orders").innerHTML = recent.length ? recent.map((o) => `
    <tr>
      <td>${escapeHtml(o.id)}</td>
      <td>${escapeHtml(o.name) || "—"}</td>
      <td>${inr(o.total)}</td>
      <td><span class="pill ${o.status === "New" ? "warn" : "on"}">${escapeHtml(o.status)}</span></td>
    </tr>`).join("") : `<tr><td colspan="4">No orders yet. They will appear here after checkout on the shop.</td></tr>`;
  $("#dash-coupons").textContent = activeC + " codes active";
}

/* ---------------------------------------------------------------
   PRODUCTS + CATEGORY (homepage-section) ORDERING
--------------------------------------------------------------- */
function renderProducts() {
  renderProductTable();
  $("#prod-editor").style.display = "none";
}
// Refreshes only the list + category order. Never touches the editor, so a
// live update arriving while you type/upload can't wipe your form.
function renderProductTable() {
  const list = MELVRA.catalog();
  $("#prod-count").textContent = list.length + " in catalog";
  $("#prod-table").innerHTML = list.length ? list.map((p) => `
    <tr>
      <td><img class="thumb" src="${p.image || (p.gallery && p.gallery[0]) || ""}" alt=""></td>
      <td><b>${escapeHtml(p.name)}</b><div class="hint">${escapeHtml(p.id)}</div></td>
      <td>${escapeHtml(p.category)}</td>
      <td>${inr(p.price)}</td>
      <td>${p.stock ?? 0}</td>
      <td><span class="pill ${p.visible === false ? "off" : "on"}">${p.visible === false ? "Hidden" : "Live"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editProduct(${jsArg(p.id)})">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleVis(${jsArg(p.id)})">${p.visible === false ? "Show" : "Hide"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeProduct(${jsArg(p.id)})">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7">${MELVRA.catalogLoaded() ? "No pieces in the catalog right now." : "Loading catalog…"}</td></tr>`;
  renderCategoryOrder();
}

function renderCategoryOrder() {
  const box = $("#cat-order");
  if (!box) return;
  const cats = MELVRA.categoryOrder();
  box.innerHTML = cats.length ? cats.map((c, i) => `
    <div class="cat-row">
      <span class="cat-name">${escapeHtml(c)}</span>
      <div class="cat-actions">
        <button class="btn btn-ghost btn-sm" title="Move up" ${i === 0 ? "disabled" : ""} onclick="bumpCategory(${i}, -1)">↑</button>
        <button class="btn btn-ghost btn-sm" title="Move down" ${i === cats.length - 1 ? "disabled" : ""} onclick="bumpCategory(${i}, 1)">↓</button>
        <button class="btn btn-danger btn-sm" title="Remove this homepage section (products keep this category, they just won't get their own section)" onclick="dropCategory(${i})">Remove section</button>
      </div>
    </div>`).join("") : `<p class="hint">Categories you use on products will appear here — the top one becomes the first section on the homepage.</p>`;
}
function bumpCategory(i, dir) {
  const name = MELVRA.categoryOrder()[i];
  if (name === undefined) return;
  reportFail(MELVRA.moveCategory(name, dir));
  renderCategoryOrder();
}
function dropCategory(i) {
  const name = MELVRA.categoryOrder()[i];
  if (name === undefined) return;
  if (!confirm("Remove \"" + name + "\" as its own homepage section? Products keep this category and still show up under \"All\".")) return;
  reportFail(MELVRA.removeCategory(name));
  renderCategoryOrder();
}

function newProduct() {
  ui.editId = null;
  // One id per "New piece" form: pressing Save twice (or a slow connection +
  // second tap) now updates the SAME product instead of creating duplicates.
  ui.newId = MELVRA.slug("piece");
  fillEditor({
    name: "", category: MELVRA.categoryOrder()[0] || "Bracelet", price: 599, compare: 699, stock: 10,
    tag: "New", visible: true, image: "", gallery: [],
    desc: "", blurb: "", rating: 0, reviewCount: 0
  });
}
function editProduct(id) {
  const p = MELVRA.findProduct(id);
  if (!p) return;
  ui.editId = id;
  ui.newId = null;
  fillEditor(p);
}
function fillEditor(p) {
  $("#prod-editor").style.display = "block";
  $("#e-name").value = p.name || "";
  fillCategorySelect(p.category);
  $("#e-price").value = p.price || 0;
  $("#e-compare").value = p.compare || "";
  $("#e-stock").value = p.stock ?? 0;
  $("#e-tag").value = p.tag || "";
  $("#e-desc").value = p.desc || p.blurb || "";
  $("#e-live").checked = p.visible !== false;
  const liveSel = $("#e-live-select");
  if (liveSel) liveSel.value = p.visible === false ? "0" : "1";
  $("#e-title").textContent = ui.editId ? "Edit piece" : "New piece";
  ui.gallery = (p.gallery && p.gallery.length) ? [...p.gallery] : (p.image ? [p.image] : []);
  renderGalleryEditor();
  $("#prod-editor").scrollIntoView({ behavior: "smooth" });
}
// Category dropdown is built from every category already in use, plus a
// "Custom…" option that reveals a free-text box — so admin is never stuck
// picking from a fixed list.
function fillCategorySelect(current) {
  const sel = $("#e-cat");
  const known = MELVRA.categoryOrder();
  const cats = [...known];
  if (current && !cats.includes(current)) cats.push(current);
  sel.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")
    + `<option value="${CUSTOM_CAT}">+ Custom category…</option>`;
  sel.value = current && cats.includes(current) ? current : (cats[0] || CUSTOM_CAT);
  onCategoryChange();
}
function onCategoryChange() {
  const box = $("#e-cat-custom");
  if (!box) return;
  box.style.display = $("#e-cat").value === CUSTOM_CAT ? "block" : "none";
}
function currentCategoryValue() {
  const sel = $("#e-cat").value;
  if (sel !== CUSTOM_CAT) return sel;
  return ($("#e-cat-custom").value || "").trim();
}
function renderGalleryEditor() {
  const box = $("#e-gallery");
  if (!box) return;
  box.innerHTML = (ui.gallery || []).map((src, i) => `
    <div style="position:relative;width:78px;height:64px">
      <img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;background:#e7dfd2">
      ${i === 0 ? '<span style="position:absolute;bottom:2px;left:2px;background:#000;color:#fff;font-size:10px;padding:1px 5px;border-radius:4px">cover</span>' : ""}
      <button type="button" title="Remove" onclick="removeGalleryImage(${i})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#c0392b;color:#fff;cursor:pointer;line-height:1;font-size:13px">×</button>
      ${i !== 0 ? `<button type="button" title="Make cover" onclick="makeCoverImage(${i})" style="position:absolute;bottom:2px;right:2px;width:18px;height:18px;border-radius:4px;border:none;background:#2d6a4f;color:#fff;cursor:pointer;font-size:11px;line-height:1">★</button>` : ""}
    </div>`).join("") || `<p class="hint" style="margin:0">No photos yet — upload at least one below.</p>`;
}
function removeGalleryImage(i) {
  ui.gallery.splice(i, 1);
  renderGalleryEditor();
}
function makeCoverImage(i) {
  const [img] = ui.gallery.splice(i, 1);
  ui.gallery.unshift(img);
  renderGalleryEditor();
}
async function onGalleryFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  if (!ui.gallery) ui.gallery = [];
  const room = MAX_PHOTOS - ui.gallery.length;
  if (room <= 0) { input.value = ""; return toast("Maximum " + MAX_PHOTOS + " photos per piece."); }
  const use = files.slice(0, room);
  if (files.length > room) toast("Only " + room + " more photo" + (room === 1 ? "" : "s") + " fit — extra ones skipped.");
  else toast("Optimising photo" + (use.length === 1 ? "" : "s") + "…");
  // Promise.all keeps the photos in the order they were picked.
  const results = await Promise.all(use.map((f) => resizeImageFile(f).catch(() => null)));
  let bad = 0;
  results.forEach((r) => { if (r) ui.gallery.push(r); else bad++; });
  if (bad) toast(bad + " photo" + (bad === 1 ? "" : "s") + " could not be read — please use JPG or PNG.");
  input.value = "";
  renderGalleryEditor();
}
// Centre-crops to a square and compresses until each photo is ≈100 KB or
// less. The old code saved 1080px photos of 300-450 KB each; a few of them
// pushed the product over Firebase's 1 MB limit, so Firebase rejected it and
// the product vanished a moment after it appeared.
const PHOTO_MAX_CHARS = 110000;
function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        if (!side) return reject(new Error("empty image"));
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        let data = "";
        for (const target of [800, 640, 512, 400]) {
          const out = Math.min(target, side); // never upscale
          const canvas = document.createElement("canvas");
          canvas.width = out; canvas.height = out;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out, out); // transparent PNGs → white, not black
          ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
          for (let q = 0.8; q >= 0.4; q -= 0.1) {
            data = canvas.toDataURL("image/jpeg", q);
            if (data.length <= PHOTO_MAX_CHARS) return resolve(data);
          }
        }
        resolve(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function cancelEditor() {
  $("#prod-editor").style.display = "none";
  ui.editId = null;
}
let savingProduct = false;
async function saveProduct(e) {
  e.preventDefault();
  if (savingProduct) return; // ignore double-taps while a save is in progress
  const name = $("#e-name").value.trim();
  if (!name) return toast("A name is required.");
  const category = currentCategoryValue();
  if (!category) return toast("Enter a category name.");
  const price = Number($("#e-price").value);
  if (!(price >= 1)) return toast("Enter a price of at least ₹1.");
  const existing = (ui.editId ? MELVRA.findProduct(ui.editId) : null) || {};
  const gallery = (ui.gallery && ui.gallery.length) ? ui.gallery : (existing.gallery && existing.gallery.length ? existing.gallery : []);
  if (!gallery.length) return toast("Add at least one photo.");
  const prod = {
    ...existing,
    id: ui.editId || ui.newId || MELVRA.slug(name),
    name,
    category,
    price,
    compare: Number($("#e-compare").value) || 0,
    stock: Math.max(0, Math.floor(Number($("#e-stock").value) || 0)),
    tag: $("#e-tag").value.trim(),
    image: gallery[0],
    gallery: gallery,
    desc: $("#e-desc").value.trim(),
    blurb: $("#e-desc").value.trim().slice(0, 120),
    visible: ($("#e-live-select") ? $("#e-live-select").value === "1" : $("#e-live").checked),
    rating: existing.rating || 0,
    reviewCount: existing.reviewCount || 0,
    specs: existing.specs || { Material: "Hand-spun cotton", Origin: "Made in Delhi" }
  };
  const btn = e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null;
  savingProduct = true;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Saving…"; }
  const slow = setTimeout(() => toast("Still saving… check the internet and keep this page open."), 8000);
  let res;
  try { res = await MELVRA.upsertProduct(prod); }
  catch (err) { res = { ok: false, message: (err && err.message) || "Unexpected error" }; }
  clearTimeout(slow);
  savingProduct = false;
  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || "Save"; }
  if (!res.ok) {
    paintSyncStatus(res.message);
    renderProductTable();
    // The form stays open with all your text and photos — nothing is lost.
    alert("⚠ \"" + prod.name + "\" was NOT saved.\n\n" + res.message + "\n\nYour form is still open. Fix the problem and press Save again.");
    return;
  }
  paintSyncStatus();
  toast(prod.name + (MELVRA.isCloudReady() ? " saved — live on every device" : " saved on THIS device only (cloud not connected)"));
  ui.gallery = null;
  ui.newId = null;
  renderProducts();
}
async function toggleVis(id) {
  const p = MELVRA.findProduct(id);
  if (!p) return;
  const res = await MELVRA.upsertProduct({ ...p, visible: p.visible === false });
  if (!res.ok) alert("⚠ Not saved online.\n\n" + res.message);
  renderProductTable();
}
function removeProduct(id) {
  if (!confirm("Remove this piece from the catalog?")) return;
  reportFail(MELVRA.deleteProduct(id));
  toast("Piece removed");
  renderProducts();
}

function renderCoupons() {
  renderCouponTable();
  $("#coup-editor").style.display = "none";
}
function renderCouponTable() {
  const list = MELVRA.coupons();
  $("#coup-table").innerHTML = list.map((c) => `
    <tr>
      <td><b>${escapeHtml(c.code)}</b><div class="hint">${escapeHtml(c.note)}</div></td>
      <td>${c.type === "percent" ? c.value + "%" : inr(c.value)}</td>
      <td>${inr(c.min || 0)}</td>
      <td>${c.used || 0} / ${c.maxUses || "∞"}</td>
      <td><span class="pill ${c.active ? "on" : "off"}">${c.active ? "Active" : "Paused"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editCoupon(${jsArg(c.id)})">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleCoupon(${jsArg(c.id)})">${c.active ? "Pause" : "Activate"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeCoupon(${jsArg(c.id)})">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6">No coupons yet.</td></tr>`;
}
function newCoupon() {
  ui.couponId = "c-" + Date.now();
  $("#c-code").value = "";
  $("#c-type").value = "percent";
  $("#c-value").value = 10;
  $("#c-min").value = 499;
  $("#c-max").value = 100;
  $("#c-note").value = "";
  $("#c-active").checked = true;
  $("#coup-editor").style.display = "block";
  $("#c-title").textContent = "New coupon";
}
function editCoupon(id) {
  const c = MELVRA.coupons().find((x) => x.id === id);
  if (!c) return;
  ui.couponId = id;
  $("#c-code").value = c.code;
  $("#c-type").value = c.type;
  $("#c-value").value = c.value;
  $("#c-min").value = c.min || 0;
  $("#c-max").value = c.maxUses || 0;
  $("#c-note").value = c.note || "";
  $("#c-active").checked = !!c.active;
  $("#coup-editor").style.display = "block";
  $("#c-title").textContent = "Edit coupon";
}
function saveCoupon(e) {
  e.preventDefault();
  const code = $("#c-code").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return toast("Code is required.");
  const prev = MELVRA.coupons().find((x) => x.id === ui.couponId) || {};
  // Two different coupons must never share one code (the shop would pick the wrong one).
  if (MELVRA.coupons().some((x) => x.code === code && x.id !== (ui.couponId || ""))) return toast("A coupon with this code already exists.");
  reportFail(MELVRA.upsertCoupon({
    id: ui.couponId || "c-" + Date.now(),
    code,
    type: $("#c-type").value,
    value: Number($("#c-value").value) || 0,
    min: Number($("#c-min").value) || 0,
    maxUses: Number($("#c-max").value) || 0,
    used: prev.used || 0,
    note: $("#c-note").value.trim(),
    active: $("#c-active").checked
  }));
  toast(code + " saved");
  renderCoupons();
}
function toggleCoupon(id) {
  const c = MELVRA.coupons().find((x) => x.id === id);
  if (!c) return;
  reportFail(MELVRA.upsertCoupon({ ...c, active: !c.active }));
  renderCouponTable();
}
function removeCoupon(id) {
  if (!confirm("Delete this coupon?")) return;
  reportFail(MELVRA.deleteCoupon(id));
  renderCoupons();
}
function cancelCoupon() { $("#coup-editor").style.display = "none"; }

/* ---------------------------------------------------------------
   ORDERS (working queue — sorted newest first, Delivered orders age
   out automatically) and BILLS (permanent record of every order).
--------------------------------------------------------------- */
function daysLeftBadge(o) {
  if (o.status !== "Delivered") return "";
  const deliveredAt = new Date(o.deliveredAt || o.at).getTime();
  const daysGone = (Date.now() - deliveredAt) / (24 * 60 * 60 * 1000);
  const left = Math.max(0, Math.ceil(MELVRA.DELIVERED_RETENTION_DAYS - daysGone));
  return `<div class="hint">Auto-removes from Orders in ${left} day${left === 1 ? "" : "s"} (kept in Bills)</div>`;
}

// Shared "details" block used by both Orders and Bills — email opens Gmail,
// phone opens the dialer, address opens Google Maps.
function orderDetailsBlock(o) {
  const gmailHref = o.email ? "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(o.email) : "";
  const mapsHref = o.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address) : "";
  return `
    <div style="background:var(--panel-2,#f6f1e8);border-radius:10px;padding:14px 16px;display:grid;gap:6px;font-size:14px">
      <div><b>Name:</b> ${escapeHtml(o.name) || "—"}</div>
      <div><b>Email:</b> ${o.email ? `<a href="${escapeHtml(gmailHref)}" target="_blank" rel="noopener" style="text-decoration:underline">${escapeHtml(o.email)}</a>` : "—"}</div>
      <div><b>Phone:</b> ${o.phone ? `<a href="tel:${escapeHtml(o.phone)}" style="text-decoration:underline">${escapeHtml(o.phone)}</a>` : "—"}</div>
      <div><b>Address:</b> ${escapeHtml(o.address) || "—"} ${mapsHref ? `<a href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener" style="text-decoration:underline;margin-left:6px">Open in Google Maps ↗</a>` : ""}</div>
      <div><b>Payment method:</b> ${escapeHtml(o.pay) || "—"} ${o.paymentStatus ? `<span class="pill ${o.paymentStatus === "Paid" ? "on" : o.paymentStatus === "COD" ? "warn" : "off"}" style="margin-left:6px">${escapeHtml(o.paymentStatus)}</span>` : ""}</div>
      ${o.paymentId ? `<div><b>Payment ID:</b> ${escapeHtml(o.paymentId)}</div>` : ""}
      <div><b>Account:</b> ${escapeHtml(o.user) || "Guest checkout"}</div>
      <div><b>Coupon used:</b> ${escapeHtml(o.coupon) || "—"}</div>
      <div><b>Items:</b> ${(o.items || []).map((i) => escapeHtml(i.name || i.id) + " × " + escapeHtml(i.qty) + " (" + inr(i.price) + ")").join(", ") || "—"}</div>
      <div><b>Subtotal:</b> ${inr(o.sub)} &nbsp; <b>Discount:</b> ${o.discount ? "−" + inr(o.discount) : "—"} &nbsp; <b>Shipping:</b> ${o.ship ? inr(o.ship) : "Free"}</div>
    </div>`;
}

function openDetailIds(prefix) {
  return $$('[id^="' + prefix + '"]').filter((r) => r.style.display !== "none").map((r) => r.id);
}
function restoreDetailIds(ids) {
  ids.forEach((id) => { const r = document.getElementById(id); if (r) r.style.display = "table-row"; });
}
function renderOrders() {
  MELVRA.purgeExpiredDeliveries();
  const openIds = openDetailIds("ord-details-");
  const list = MELVRA.orders(); // already sorted newest-first
  $("#ord-table").innerHTML = list.length ? list.map((o) => `
    <tr>
      <td><b>${escapeHtml(o.id)}</b><div class="hint">${new Date(o.at).toLocaleString("en-IN")}</div></td>
      <td>${escapeHtml(o.name)}<div class="hint">${escapeHtml(o.email)}</div></td>
      <td>${(o.items || []).map((i) => escapeHtml(i.name || i.id) + " × " + escapeHtml(i.qty)).join(", ")}</td>
      <td>${o.coupon ? escapeHtml(o.coupon) : "—"}</td>
      <td>${inr(o.total)}<div class="hint"><span class="pill ${o.paymentStatus === "Paid" ? "on" : o.paymentStatus === "COD" ? "warn" : "off"}">${o.paymentStatus || "—"}</span></div></td>
      <td>
        <select onchange="setStatus(${jsArg(o.id)}, this.value)">
          ${["New", "Packed", "Shipped", "Delivered", "Cancelled"].map((s) => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        ${daysLeftBadge(o)}
      </td>
      <td><button class="btn btn-ghost btn-sm" onclick="toggleOrderDetails(${jsArg(o.id)})">Details</button></td>
    </tr>
    <tr id="ord-details-${escapeHtml(o.id)}" style="display:none">
      <td colspan="7">${orderDetailsBlock(o)}</td>
    </tr>`).join("") : `<tr><td colspan="7">No orders yet.</td></tr>`;
  restoreDetailIds(openIds);
}
function toggleOrderDetails(id) {
  const row = $("#ord-details-" + id);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "table-row" : "none";
}
function setStatus(id, status) {
  reportFail(MELVRA.updateOrder(id, { status }));
  toast("Order " + id + " → " + status);
  renderOrders();
}

function renderBills() {
  const openIds = openDetailIds("bill-details-");
  const list = MELVRA.bills(); // permanent, never auto-removed
  $("#bill-count").textContent = list.length + " recorded";
  $("#bill-table").innerHTML = list.length ? list.map((o) => `
    <tr>
      <td><b>${escapeHtml(o.id)}</b><div class="hint">${new Date(o.at).toLocaleString("en-IN")}</div></td>
      <td>${escapeHtml(o.name)}<div class="hint">${escapeHtml(o.email)}</div></td>
      <td>${(o.items || []).map((i) => escapeHtml(i.name || i.id) + " × " + escapeHtml(i.qty)).join(", ")}</td>
      <td>${o.coupon ? escapeHtml(o.coupon) : "—"}</td>
      <td>${inr(o.total)}</td>
      <td><span class="pill ${o.status === "Delivered" ? "on" : o.status === "Cancelled" ? "off" : "warn"}">${escapeHtml(o.status) || "—"}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="toggleBillDetails(${jsArg(o.id)})">Details</button></td>
    </tr>
    <tr id="bill-details-${escapeHtml(o.id)}" style="display:none">
      <td colspan="7">${orderDetailsBlock(o)}</td>
    </tr>`).join("") : `<tr><td colspan="7">No bills recorded yet.</td></tr>`;
  restoreDetailIds(openIds);
}
function toggleBillDetails(id) {
  const row = $("#bill-details-" + id);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function renderNotes() {
  renderNoteTable();
  $("#note-editor").style.display = "none";
}
function renderNoteTable() {
  const list = MELVRA.announcements();
  $("#note-table").innerHTML = list.length ? list.map((a) => `
    <tr>
      <td>${escapeHtml(a.text)}</td>
      <td><span class="pill ${a.active ? "on" : "off"}">${a.active ? "Live" : "Off"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="toggleNote(${jsArg(a.id)})">${a.active ? "Hide" : "Show"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeNote(${jsArg(a.id)})">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="3">No announcements yet.</td></tr>`;
}
function newNote() {
  $("#n-text").value = "";
  $("#n-active").checked = true;
  $("#note-editor").style.display = "block";
}
function saveNote(e) {
  e.preventDefault();
  const text = $("#n-text").value.trim();
  if (!text) return;
  const active = $("#n-active").checked;
  const list = MELVRA.announcements().map((a) => active ? { ...a, active: false } : a);
  MELVRA.saveAnnouncements(list);
  reportFail(MELVRA.upsertAnnouncement({ id: "n-" + Date.now(), text, active, at: new Date().toISOString() }));
  toast("Announcement saved");
  renderNotes();
}
function toggleNote(id) {
  const list = MELVRA.announcements();
  const target = list.find((a) => a.id === id);
  if (!target) return;
  const next = !target.active;
  const updated = list.map((a) => ({ ...a, active: next && a.id === id }));
  MELVRA.saveAnnouncements(updated);
  // This toggle used to change only this device; now it is pushed to everyone.
  reportFail(MELVRA.upsertAnnouncement(updated.find((a) => a.id === id)));
  updated.filter((a) => a.id !== id && list.find((x) => x.id === a.id).active).forEach((a) => MELVRA.upsertAnnouncement(a));
  renderNoteTable();
}
function removeNote(id) {
  reportFail(MELVRA.deleteAnnouncement(id));
  renderNoteTable();
}

/* ---------------------------------------------------------------
   REVIEWS — moderate real customer ratings/notes. Ratings shown on
   the shop are always calculated live from what's left here.
--------------------------------------------------------------- */
function renderReviews() {
  const list = MELVRA.reviews();
  $("#review-count").textContent = list.length + " submitted";
  $("#review-table").innerHTML = list.length ? list.map((r) => `
    <tr>
      <td><b>${escapeHtml(r.productName || r.productId)}</b></td>
      <td>${escapeHtml(r.name || "Guest")}</td>
      <td>${"★".repeat(r.stars || 0)}${"☆".repeat(5 - (r.stars || 0))}</td>
      <td style="max-width:320px">${escapeHtml((r.text || "").slice(0, 180))}${(r.text || "").length > 180 ? "…" : ""}</td>
      <td><div class="hint">${new Date(r.at).toLocaleString("en-IN")}</div></td>
      <td><button class="btn btn-danger btn-sm" onclick="removeReview(${jsArg(r.id)})">Delete</button></td>
    </tr>`).join("") : `<tr><td colspan="6">No reviews submitted yet.</td></tr>`;
}
function removeReview(id) {
  if (!confirm("Delete this review? This cannot be undone.")) return;
  reportFail(MELVRA.deleteReview(id));
  toast("Review deleted");
  renderReviews();
}

function renderSettings() {
  const s = MELVRA.settings();
  $("#s-brand").value = s.brand;
  $("#s-tag").value = s.tagline;
  $("#s-free").value = s.freeShip;
  $("#s-ship").value = s.shipFee;
  $("#s-email").value = s.email;
  const products = MELVRA.catalog();
  const sel = $("#s-spotlight");
  if (sel) {
    sel.innerHTML = products.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    sel.value = s.spotlightProductId || (products[0] && products[0].id) || "";
  }
  $("#s-spotlight-label").value = s.spotlightLabel || "";
}
function saveSettings(e) {
  e.preventDefault();
  reportFail(MELVRA.saveSettings({
    brand: $("#s-brand").value.trim() || "MELVRA",
    tagline: $("#s-tag").value.trim(),
    freeShip: Number($("#s-free").value) || 0,
    shipFee: Number($("#s-ship").value) || 0,
    email: $("#s-email").value.trim(),
    spotlightProductId: $("#s-spotlight") ? $("#s-spotlight").value : "",
    spotlightLabel: $("#s-spotlight-label") ? $("#s-spotlight-label").value.trim() : ""
  }));
  toast("Settings saved");
}
async function savePass(e) {
  e.preventDefault();
  const a = $("#s-pass").value;
  const b = $("#s-pass2").value;
  if (a.length < 6) return toast("Use at least 6 characters.");
  if (a !== b) return toast("Passwords do not match.");
  await MELVRA.setPassword(a);
  $("#s-pass").value = "";
  $("#s-pass2").value = "";
  toast("Password updated");
}
async function resetAll() {
  if (!confirm("This DELETES every product, coupon and setting on the live shop and puts back the original demo set. (Bills history is kept.)\n\nContinue?")) return;
  const typed = prompt("Type RESET (capital letters) to confirm. This cannot be undone.");
  if (typed !== "RESET") return toast("Reset cancelled.");
  const res = await MELVRA.resetDemo();
  if (res && res.ok === false) return alert("⚠ Reset did not finish online.\n\n" + res.message);
  toast("Studio reset");
  go(ui.page);
}

history.replaceState({ melvraPage: "dash" }, "", location.pathname + location.search);
window.addEventListener("popstate", (e) => {
  const s = e.state || { melvraPage: "dash" };
  go(s.melvraPage, true, { fromPopState: true });
});

function isTypingNow() {
  const a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
function refreshFromSync(type) {
  if (!MELVRA.hasSession()) return;
  const dash = ui.page === "dash";
  if (type === "catalog") {
    if (ui.page === "products") renderProductTable();
    else if (dash) renderDash();
    else if (ui.page === "settings" && !isTypingNow()) renderSettings();
  }
  if (type === "categories" && ui.page === "products") renderCategoryOrder();
  if (type === "coupons") {
    if (ui.page === "coupons") renderCouponTable();
    else if (dash) renderDash();
  }
  if (type === "orders") {
    if (ui.page === "orders") renderOrders();
    else if (dash) renderDash();
  }
  if (type === "bills") {
    if (ui.page === "bills") renderBills();
    else if (dash) renderDash();
  }
  if (type === "announcements" && ui.page === "notes") renderNoteTable();
  if (type === "reviews") {
    if (ui.page === "reviews") renderReviews();
    else if (dash) renderDash();
  }
  if (type === "settings" && ui.page === "settings" && !isTypingNow()) renderSettings();
}

window.addEventListener("DOMContentLoaded", () => {
  if (MELVRA.hasSession()) openStudio();
  else showGate(true);

  // Self-heal the Orders queue on every load, and periodically while the
  // studio stays open, so a Delivered order disappears from Orders once its
  // retention window has passed even without a fresh sync event.
  MELVRA.purgeExpiredDeliveries();
  setInterval(() => {
    if (MELVRA.purgeExpiredDeliveries() && ui.page === "orders") renderOrders();
  }, 60 * 60 * 1000);

  // (Live sync itself is started by startAdminSync(), after login. It only
  // re-draws lists — it never closes an open editor, never resets what you
  // are typing, and never pushes browser history. The old version called go()
  // here, which closed the product form and could turn "Edit" into a
  // duplicate "New" product mid-edit.)
});
