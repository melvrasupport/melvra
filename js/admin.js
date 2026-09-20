const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const CUSTOM_CAT = "__custom__";
const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ui = { page: "dash", editId: null, couponId: null };

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

function openStudio() {
  showGate(false);
  go("dash");
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
  const revenue = orders.reduce((a, o) => a + (o.total || 0), 0);
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
      <td>${o.id}</td>
      <td>${o.name || "—"}</td>
      <td>${inr(o.total)}</td>
      <td><span class="pill ${o.status === "New" ? "warn" : "on"}">${o.status}</span></td>
    </tr>`).join("") : `<tr><td colspan="4">No orders yet. They will appear here after checkout on the shop.</td></tr>`;
  $("#dash-coupons").textContent = activeC + " codes active";
}

/* ---------------------------------------------------------------
   PRODUCTS + CATEGORY (homepage-section) ORDERING
--------------------------------------------------------------- */
function renderProducts() {
  const list = MELVRA.catalog();
  $("#prod-count").textContent = list.length + " in catalog";
  $("#prod-table").innerHTML = list.length ? list.map((p) => `
    <tr>
      <td><img class="thumb" src="${p.image}" alt=""></td>
      <td><b>${p.name}</b><div class="hint">${p.id}</div></td>
      <td>${p.category}</td>
      <td>${inr(p.price)}</td>
      <td>${p.stock ?? 0}</td>
      <td><span class="pill ${p.visible === false ? "off" : "on"}">${p.visible === false ? "Hidden" : "Live"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleVis('${p.id}')">${p.visible === false ? "Show" : "Hide"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeProduct('${p.id}')">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7">No pieces in the catalog right now.</td></tr>`;
  $("#prod-editor").style.display = "none";
  renderCategoryOrder();
}

function renderCategoryOrder() {
  const box = $("#cat-order");
  if (!box) return;
  const cats = MELVRA.categoryOrder();
  box.innerHTML = cats.length ? cats.map((c, i) => `
    <div class="cat-row">
      <span class="cat-name">${c}</span>
      <div class="cat-actions">
        <button class="btn btn-ghost btn-sm" title="Move up" ${i === 0 ? "disabled" : ""} onclick="bumpCategory('${c}', -1)">↑</button>
        <button class="btn btn-ghost btn-sm" title="Move down" ${i === cats.length - 1 ? "disabled" : ""} onclick="bumpCategory('${c}', 1)">↓</button>
        <button class="btn btn-danger btn-sm" title="Remove this homepage section (products keep this category, they just won't get their own section)" onclick="dropCategory('${c}')">Remove section</button>
      </div>
    </div>`).join("") : `<p class="hint">Categories you use on products will appear here — the top one becomes the first section on the homepage.</p>`;
}
function bumpCategory(name, dir) {
  MELVRA.moveCategory(name, dir);
  renderCategoryOrder();
}
function dropCategory(name) {
  if (!confirm("Remove \"" + name + "\" as its own homepage section? Products keep this category and still show up under \"All\".")) return;
  MELVRA.removeCategory(name);
  renderCategoryOrder();
}

function newProduct() {
  ui.editId = null;
  fillEditor({
    name: "", category: "Bracelet", price: 599, compare: 699, stock: 10,
    tag: "New", visible: true, image: "images/qmOsP.jpg", gallery: ["images/qmOsP.jpg"],
    desc: "", blurb: "", rating: 0, reviewCount: 0
  });
}
function editProduct(id) {
  const p = MELVRA.findProduct(id);
  if (!p) return;
  ui.editId = id;
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
  sel.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join("")
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
function onGalleryFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  if (!ui.gallery) ui.gallery = [];
  let remaining = files.length;
  files.forEach((file) => {
    resizeImageFile(file, 1080, 0.85).then((dataUrl) => {
      ui.gallery.push(dataUrl);
      remaining--;
      if (remaining === 0) { renderGalleryEditor(); input.value = ""; }
    });
  });
}
function resizeImageFile(file, targetSize, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Every product photo on the site is shown at a 1:1 ratio, so we
        // center-crop the source to a square before scaling it down —
        // this keeps every image consistent regardless of the original
        // photo's shape (portrait, landscape, etc).
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = targetSize; canvas.height = targetSize;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function cancelEditor() {
  $("#prod-editor").style.display = "none";
  ui.editId = null;
}
function saveProduct(e) {
  e.preventDefault();
  const name = $("#e-name").value.trim();
  if (!name) return toast("A name is required.");
  const category = currentCategoryValue();
  if (!category) return toast("Enter a category name.");
  const existing = ui.editId ? MELVRA.findProduct(ui.editId) : {};
  const gallery = (ui.gallery && ui.gallery.length) ? ui.gallery : (existing.gallery && existing.gallery.length ? existing.gallery : ["images/qmOsP.jpg"]);
  const prod = {
    ...existing,
    id: ui.editId || MELVRA.slug(name),
    name,
    category,
    price: Number($("#e-price").value) || 0,
    compare: Number($("#e-compare").value) || 0,
    stock: Number($("#e-stock").value) || 0,
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
  MELVRA.upsertProduct(prod);
  toast(prod.name + " saved");
  ui.gallery = null;
  renderProducts();
}
function toggleVis(id) {
  const p = MELVRA.findProduct(id);
  if (!p) return;
  MELVRA.upsertProduct({ ...p, visible: p.visible === false });
  renderProducts();
}
function removeProduct(id) {
  if (!confirm("Remove this piece from the catalog?")) return;
  MELVRA.deleteProduct(id);
  toast("Piece removed");
  renderProducts();
}

function renderCoupons() {
  const list = MELVRA.coupons();
  $("#coup-table").innerHTML = list.map((c) => `
    <tr>
      <td><b>${c.code}</b><div class="hint">${c.note || ""}</div></td>
      <td>${c.type === "percent" ? c.value + "%" : inr(c.value)}</td>
      <td>${inr(c.min || 0)}</td>
      <td>${c.used || 0} / ${c.maxUses || "∞"}</td>
      <td><span class="pill ${c.active ? "on" : "off"}">${c.active ? "Active" : "Paused"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="editCoupon('${c.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleCoupon('${c.id}')">${c.active ? "Pause" : "Activate"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeCoupon('${c.id}')">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6">No coupons yet.</td></tr>`;
  $("#coup-editor").style.display = "none";
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
  MELVRA.upsertCoupon({
    id: ui.couponId || "c-" + Date.now(),
    code,
    type: $("#c-type").value,
    value: Number($("#c-value").value) || 0,
    min: Number($("#c-min").value) || 0,
    maxUses: Number($("#c-max").value) || 0,
    used: prev.used || 0,
    note: $("#c-note").value.trim(),
    active: $("#c-active").checked
  });
  toast(code + " saved");
  renderCoupons();
}
function toggleCoupon(id) {
  const c = MELVRA.coupons().find((x) => x.id === id);
  if (!c) return;
  MELVRA.upsertCoupon({ ...c, active: !c.active });
  renderCoupons();
}
function removeCoupon(id) {
  if (!confirm("Delete this coupon?")) return;
  MELVRA.deleteCoupon(id);
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
      <div><b>Name:</b> ${o.name || "—"}</div>
      <div><b>Email:</b> ${o.email ? `<a href="${gmailHref}" target="_blank" rel="noopener" style="text-decoration:underline">${o.email}</a>` : "—"}</div>
      <div><b>Phone:</b> ${o.phone ? `<a href="tel:${o.phone}" style="text-decoration:underline">${o.phone}</a>` : "—"}</div>
      <div><b>Address:</b> ${o.address || "—"} ${mapsHref ? `<a href="${mapsHref}" target="_blank" rel="noopener" style="text-decoration:underline;margin-left:6px">Open in Google Maps ↗</a>` : ""}</div>
      <div><b>Payment method:</b> ${o.pay || "—"} ${o.paymentStatus ? `<span class="pill ${o.paymentStatus === "Paid" ? "on" : o.paymentStatus === "COD" ? "warn" : "off"}" style="margin-left:6px">${o.paymentStatus}</span>` : ""}</div>
      ${o.paymentId ? `<div><b>Payment ID:</b> ${o.paymentId}</div>` : ""}
      <div><b>Account:</b> ${o.user || "Guest checkout"}</div>
      <div><b>Coupon used:</b> ${o.coupon || "—"}</div>
      <div><b>Items:</b> ${(o.items || []).map((i) => i.name + " × " + i.qty + " (" + inr(i.price) + ")").join(", ") || "—"}</div>
      <div><b>Subtotal:</b> ${inr(o.sub)} &nbsp; <b>Discount:</b> ${o.discount ? "−" + inr(o.discount) : "—"} &nbsp; <b>Shipping:</b> ${o.ship ? inr(o.ship) : "Free"}</div>
    </div>`;
}

function renderOrders() {
  MELVRA.purgeExpiredDeliveries();
  const list = MELVRA.orders(); // already sorted newest-first
  $("#ord-table").innerHTML = list.length ? list.map((o) => `
    <tr>
      <td><b>${o.id}</b><div class="hint">${new Date(o.at).toLocaleString("en-IN")}</div></td>
      <td>${o.name}<div class="hint">${o.email || ""}</div></td>
      <td>${(o.items || []).map((i) => i.name + " × " + i.qty).join(", ")}</td>
      <td>${o.coupon ? o.coupon : "—"}</td>
      <td>${inr(o.total)}<div class="hint"><span class="pill ${o.paymentStatus === "Paid" ? "on" : o.paymentStatus === "COD" ? "warn" : "off"}">${o.paymentStatus || "—"}</span></div></td>
      <td>
        <select onchange="setStatus('${o.id}', this.value)">
          ${["New", "Packed", "Shipped", "Delivered", "Cancelled"].map((s) => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        ${daysLeftBadge(o)}
      </td>
      <td><button class="btn btn-ghost btn-sm" onclick="toggleOrderDetails('${o.id}')">Details</button></td>
    </tr>
    <tr id="ord-details-${o.id}" style="display:none">
      <td colspan="7">${orderDetailsBlock(o)}</td>
    </tr>`).join("") : `<tr><td colspan="7">No orders yet.</td></tr>`;
}
function toggleOrderDetails(id) {
  const row = $("#ord-details-" + id);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "table-row" : "none";
}
function setStatus(id, status) {
  MELVRA.updateOrder(id, { status });
  toast("Order " + id + " → " + status);
  renderOrders();
}

function renderBills() {
  const list = MELVRA.bills(); // permanent, never auto-removed
  $("#bill-count").textContent = list.length + " recorded";
  $("#bill-table").innerHTML = list.length ? list.map((o) => `
    <tr>
      <td><b>${o.id}</b><div class="hint">${new Date(o.at).toLocaleString("en-IN")}</div></td>
      <td>${o.name}<div class="hint">${o.email || ""}</div></td>
      <td>${(o.items || []).map((i) => i.name + " × " + i.qty).join(", ")}</td>
      <td>${o.coupon ? o.coupon : "—"}</td>
      <td>${inr(o.total)}</td>
      <td><span class="pill ${o.status === "Delivered" ? "on" : o.status === "Cancelled" ? "off" : "warn"}">${o.status || "—"}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="toggleBillDetails('${o.id}')">Details</button></td>
    </tr>
    <tr id="bill-details-${o.id}" style="display:none">
      <td colspan="7">${orderDetailsBlock(o)}</td>
    </tr>`).join("") : `<tr><td colspan="7">No bills recorded yet.</td></tr>`;
}
function toggleBillDetails(id) {
  const row = $("#bill-details-" + id);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function renderNotes() {
  const list = MELVRA.announcements();
  $("#note-table").innerHTML = list.length ? list.map((a) => `
    <tr>
      <td>${a.text}</td>
      <td><span class="pill ${a.active ? "on" : "off"}">${a.active ? "Live" : "Off"}</span></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" onclick="toggleNote('${a.id}')">${a.active ? "Hide" : "Show"}</button>
        <button class="btn btn-danger btn-sm" onclick="removeNote('${a.id}')">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="3">No announcements yet.</td></tr>`;
  $("#note-editor").style.display = "none";
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
  MELVRA.upsertAnnouncement({ id: "n-" + Date.now(), text, active, at: new Date().toISOString() });
  toast("Announcement saved");
  renderNotes();
}
function toggleNote(id) {
  const list = MELVRA.announcements();
  const target = list.find((a) => a.id === id);
  if (!target) return;
  const next = !target.active;
  MELVRA.saveAnnouncements(list.map((a) => ({ ...a, active: next && a.id === id })));
  renderNotes();
}
function removeNote(id) {
  MELVRA.deleteAnnouncement(id);
  renderNotes();
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
      <td><button class="btn btn-danger btn-sm" onclick="removeReview('${r.id}')">Delete</button></td>
    </tr>`).join("") : `<tr><td colspan="6">No reviews submitted yet.</td></tr>`;
}
function removeReview(id) {
  if (!confirm("Delete this review? This cannot be undone.")) return;
  MELVRA.deleteReview(id);
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
    sel.innerHTML = products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
    sel.value = s.spotlightProductId || (products[0] && products[0].id) || "";
  }
  $("#s-spotlight-label").value = s.spotlightLabel || "";
}
function saveSettings(e) {
  e.preventDefault();
  MELVRA.saveSettings({
    brand: $("#s-brand").value.trim() || "MELVRA",
    tagline: $("#s-tag").value.trim(),
    freeShip: Number($("#s-free").value) || 0,
    shipFee: Number($("#s-ship").value) || 0,
    email: $("#s-email").value.trim(),
    spotlightProductId: $("#s-spotlight") ? $("#s-spotlight").value : "",
    spotlightLabel: $("#s-spotlight-label") ? $("#s-spotlight-label").value.trim() : ""
  });
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
function resetAll() {
  if (!confirm("Reset catalog, coupons and orders to the original atelier set? (Bills history is kept.)")) return;
  MELVRA.resetDemo();
  toast("Studio reset");
  go(ui.page);
}

history.replaceState({ melvraPage: "dash" }, "", location.pathname + location.search);
window.addEventListener("popstate", (e) => {
  const s = e.state || { melvraPage: "dash" };
  go(s.melvraPage, true, { fromPopState: true });
});

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

  // Live updates: reflect changes made from another device/tab logged
  // into the same studio (e.g. teammate editing stock at the same time).
  MELVRA.startSync((type) => {
    if (type === "catalog" && (ui.page === "products" || ui.page === "dash")) go(ui.page);
    if (type === "categories" && ui.page === "products") renderCategoryOrder();
    if (type === "coupons" && (ui.page === "coupons" || ui.page === "dash")) go(ui.page);
    if (type === "orders") {
      MELVRA.purgeExpiredDeliveries();
      if (ui.page === "orders" || ui.page === "dash") go(ui.page);
    }
    if (type === "bills" && ui.page === "bills") renderBills();
    if (type === "announcements" && ui.page === "notes") go(ui.page);
    if (type === "reviews" && ui.page === "reviews") renderReviews();
    if (type === "settings" && ui.page === "settings") go(ui.page);
  });
});
