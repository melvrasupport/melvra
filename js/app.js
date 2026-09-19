// Currently-selected star rating in whatever product review form is open.
// Reset whenever a product page is (re)rendered for a different piece.
let reviewDraftStars = 0;

const state = {
  view: "home",
  filter: "All",
  productId: null,
  galleryIndex: 0,
  qty: 1,
  cart: JSON.parse(localStorage.getItem("melvra-cart") || "[]"),
  wishes: JSON.parse(localStorage.getItem("melvra-wish") || "[]"),
  checkout: false,
  ordered: false,
  orderNo: null,
  couponCode: "",
  coupon: null
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const save = () => {
  localStorage.setItem("melvra-cart", JSON.stringify(state.cart));
  localStorage.setItem("melvra-wish", JSON.stringify(state.wishes));
};
const catalog = () => MELVRA.catalog();
const PRODUCTS = () => MELVRA.liveProducts();
const count = () => state.cart.reduce((a, i) => a + i.qty, 0);
const findP = (id) => catalog().find((p) => p.id === id);
const settings = () => MELVRA.settings();

function setView(view, id, opts) {
  state.view = view;
  state.productId = id || null;
  state.galleryIndex = 0;
  state.qty = 1;
  state.checkout = false;
  state.ordered = view === "ordered" ? true : false;
  reviewDraftStars = 0;
  // Record this screen in real browser history so the device/browser back
  // button steps back through the shop (home -> product -> cart, etc.)
  // instead of leaving the site entirely. Skipped when we're the ones
  // responding to a popstate event (opts.fromPopState), or the caller asked
  // us not to push a new entry (opts.skipHistory) — otherwise every render
  // would add a duplicate entry.
  if (!(opts && (opts.fromPopState || opts.skipHistory))) {
    history.pushState({ melvraView: view, melvraId: id || null }, "", location.pathname + location.search);
  }
  $$(".view").forEach((v) => v.classList.remove("active"));
  if (view === "product") {
    $("#view-product").classList.add("active");
    renderProduct();
  } else if (view === "cart" || view === "ordered") {
    $("#view-cart").classList.add("active");
    renderCart();
  } else if (view === "login" || view === "auth") {
    $("#view-auth").classList.add("active");
    renderAuth();
  } else if (view === "account") {
    $("#view-account").classList.add("active");
    renderAccount();
  } else {
    $("#view-home").classList.add("active");
    renderGrid();
    renderCategorySections();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.dataset.view === (view === "product" ? "products" : view)));
  if (view === "product" || view === "cart" || view === "login" || view === "account") window.scrollTo({ top: 0, behavior: "smooth" });
  closeDrawer();
  closeMobile();
}

function addToCart(id, qty = 1, silent = false) {
  const p = findP(id);
  if (!p || p.visible === false) return toastMsg("This piece is no longer listed.");
  const have = state.cart.find((i) => i.id === id)?.qty || 0;
  if (have + qty > (p.stock || 0)) return toastMsg("Only " + (p.stock || 0) + " left in the atelier.");
  const item = state.cart.find((i) => i.id === id);
  if (item) item.qty += qty;
  else state.cart.push({ id, qty });
  save();
  updateBadge();
  if (!silent) toast(id);
  renderDrawer();
}

function setQty(id, qty) {
  const item = state.cart.find((i) => i.id === id);
  if (!item) return;
  const p = findP(id);
  item.qty = Math.min(Math.max(1, qty), p?.stock || 1);
  save();
  updateBadge();
  renderCart();
  renderDrawer();
}

function removeItem(id) {
  state.cart = state.cart.filter((i) => i.id !== id);
  save();
  updateBadge();
  renderCart();
  renderDrawer();
}

function toggleWish(id, ev) {
  if (ev) ev.stopPropagation();
  if (state.wishes.includes(id)) state.wishes = state.wishes.filter((x) => x !== id);
  else state.wishes.push(id);
  save();
  renderGrid();
  renderCategorySections();
}

function updateBadge() {
  const n = count();
  $$(".cart-count").forEach((el) => {
    el.textContent = n;
    el.classList.toggle("show", n > 0);
    el.classList.remove("pop");
    void el.offsetWidth;
    if (n > 0) el.classList.add("pop");
  });
}

function toast(id) {
  const p = findP(id);
  const t = $("#toast");
  t.innerHTML = `<img src="${p.image}" alt=""><div><b>Added to bag</b><small>${p.name} · ${inr(p.price)}</small></div>`;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
function toastMsg(msg) {
  const t = $("#toast");
  t.innerHTML = `<div><b>${msg}</b><small>MELVRA atelier</small></div>`;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function productCard(p) {
  const on = state.wishes.includes(p.id);
  const out = (p.stock || 0) < 1;
  const rt = MELVRA.productRating(p.id);
  const starsHtml = rt.count ? "★".repeat(Math.round(rt.avg)) + "☆".repeat(5 - Math.round(rt.avg)) : "☆☆☆☆☆";
  const ratingLabel = rt.count ? `${rt.avg.toFixed(1)} · ${rt.count}` : "New";
  return `
    <article class="card reveal" onclick="setView('product','${p.id}')">
      <div class="card-media">
        <img src="${p.image}" alt="${p.name}">
        <span class="card-tag">${out ? "Sold out" : p.tag || p.category}</span>
        <button class="wish ${on ? "on" : ""}" onclick="toggleWish('${p.id}', event)" aria-label="Save">${on ? "♥" : "♡"}</button>
      </div>
      <div class="card-body">
        <div class="card-cat">${p.category}</div>
        <h3>${p.name}</h3>
        <div class="card-row">
          <div>
            <div class="price">${inr(p.price)}</div>
            <div class="stars">${starsHtml} <span>${ratingLabel}</span></div>
          </div>
          <button class="add-mini" onclick="event.stopPropagation(); addToCart('${p.id}')" ${out ? "disabled" : ""}>${out ? "Out" : "Add"}</button>
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const list = PRODUCTS().filter((p) => state.filter === "All" || p.category === state.filter);
  const grid = $("#product-grid");
  if (!grid) return;
  grid.innerHTML = list.length ? list.map(productCard).join("") : `<p style="color:var(--muted)">Nothing in this shelf right now.</p>`;
  const meta = $("#meta-pieces");
  if (meta) meta.textContent = PRODUCTS().length;
  renderFilterChips();
  observeReveals();
}

// Chips are generated from whatever categories are actually in use, so a
// brand-new (custom) category shows up here automatically — no more fixed
// Bracelet/Keychain/Set list.
function renderFilterChips() {
  const wrap = $("#filters");
  if (!wrap) return;
  const cats = MELVRA.categoryOrder();
  wrap.innerHTML = `<button class="chip ${state.filter === "All" ? "active" : ""}" data-f="All" onclick="setFilter('All')">All</button>`
    + cats.map((c) => `<button class="chip ${state.filter === c ? "active" : ""}" data-f="${c}" onclick="setFilter('${c}')">${c}</button>`).join("");
}

// One homepage section per category, newest-created category first (that
// order comes straight from MELVRA.categoryOrder()). Each section caps at
// SECTION_CAP pieces with a "See more" button that reuses the full,
// filterable grid below.
const SECTION_CAP = 8;
function renderCategorySections() {
  const container = $("#category-sections");
  if (!container) return;
  const cats = MELVRA.categoryOrder();
  const live = PRODUCTS();
  container.innerHTML = cats.map((cat) => {
    const items = live.filter((p) => p.category === cat);
    if (!items.length) return "";
    const shown = items.slice(0, SECTION_CAP);
    return `
      <section class="section cat-section">
        <div class="section-inner">
          <div class="section-head">
            <h2>${cat}</h2>
            <p>${items.length} piece${items.length === 1 ? "" : "s"} in this shelf.</p>
          </div>
          <div class="grid">${shown.map(productCard).join("")}</div>
          ${items.length > SECTION_CAP ? `
            <div style="text-align:center;margin-top:28px">
              <button class="btn btn-ghost" onclick="setFilter('${cat}');document.getElementById('shop').scrollIntoView({behavior:'smooth'})">See more ${cat.toLowerCase()}</button>
            </div>` : ""}
        </div>
      </section>`;
  }).join("");
  observeReveals();
}

function renderSpotlight() {
  const el = $("#hero-spotlight");
  if (!el) return;
  const s = settings();
  const products = PRODUCTS();
  const p = (s.spotlightProductId && findP(s.spotlightProductId)) || products[0];
  if (!p) { el.style.display = "none"; return; }
  el.style.display = "block";
  $("#hero-spotlight-img").src = (p.gallery && p.gallery[0]) || p.image;
  $("#hero-spotlight-img").alt = p.name;
  $("#hero-spotlight-name").textContent = p.name;
  $("#hero-spotlight-label").textContent = s.spotlightLabel || inr(p.price);
  el.onclick = () => { setView("product", p.id); window.scrollTo({ top: 0, behavior: "smooth" }); return false; };
}

// Shared card markup for a real customer review — used on the homepage
// (across all products) and on a product page (that product only).
function reviewCardHTML(r, showProduct) {
  const initial = (r.name || "?").trim().charAt(0).toUpperCase() || "?";
  const dateStr = new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `
    <article class="review reveal">
      <header>
        <div class="who">
          <div class="avatar">${initial}</div>
          <div><b>${escapeHtml(r.name || "Verified buyer")}</b><small>${showProduct ? escapeHtml(r.productName || "") + " · " : ""}${dateStr}</small></div>
        </div>
        <div class="stars">${"★".repeat(r.stars || 0)}${"☆".repeat(5 - (r.stars || 0))}</div>
      </header>
      <p>${escapeHtml(r.text)}</p>
    </article>`;
}

function renderHomeReviews() {
  const el = $("#review-grid");
  if (!el) return;
  const list = MELVRA.reviews().slice(0, 6);
  el.innerHTML = list.length
    ? list.map((r) => reviewCardHTML(r, true)).join("")
    : `<p style="color:var(--muted)">No reviews yet — pieces are new to the world. Be the first to share yours after your order arrives.</p>`;
  const overall = MELVRA.overallRating();
  const bigEl = document.querySelector(".rating-hero .big");
  const starsEl = document.querySelector(".rating-hero .stars");
  const capEl = document.querySelector(".rating-hero p");
  if (bigEl) bigEl.textContent = overall.count ? overall.avg.toFixed(1) : "—";
  if (starsEl) starsEl.textContent = overall.count ? "★".repeat(Math.round(overall.avg)) + "☆".repeat(5 - Math.round(overall.avg)) : "☆☆☆☆☆";
  if (capEl) capEl.textContent = overall.count
    ? `Average from ${overall.count} verified customer review${overall.count === 1 ? "" : "s"} across the collection.`
    : "No verified reviews yet — every piece is waiting for its first note.";
}

function renderProduct() {
  const p = findP(state.productId);
  if (!p || p.visible === false) return setView("home");
  const gallery = (p.gallery && p.gallery.length ? p.gallery : [p.image]);
  const img = gallery[state.galleryIndex] || p.image;
  const related = PRODUCTS().filter((x) => x.id !== p.id && (x.category === p.category || x.category === "Set")).slice(0, 3);
  const productReviews = MELVRA.reviewsForProduct(p.id);
  const rt = MELVRA.productRating(p.id);
  const starsHtml = rt.count ? "★".repeat(Math.round(rt.avg)) + "☆".repeat(5 - Math.round(rt.avg)) : "☆☆☆☆☆";
  const alreadyReviewed = MELVRA.hasReviewed(p.id);
  const specs = p.specs || {};
  const out = (p.stock || 0) < 1;
  const s = settings();

  $("#view-product").innerHTML = `
    <div class="pdp">
      <div class="crumb"><a href="#" onclick="setView('home');return false;">Shop</a> · ${p.category} · ${p.name}</div>
      <div class="pdp-grid">
        <div>
          <div class="gallery-main"><img src="${img}" alt="${p.name}"></div>
          <div class="thumbs">
            ${gallery.map((g, i) => `<button class="${i === state.galleryIndex ? "on" : ""}" onclick="state.galleryIndex=${i};renderProduct()"><img src="${g}" alt=""></button>`).join("")}
          </div>
        </div>
        <div class="pdp-info">
          <div class="eyebrow">${p.tag || p.category} · Handmade</div>
          <h1>${p.name}</h1>
          <div class="stars">${starsHtml} <span>${rt.count ? rt.avg.toFixed(1) + " · " + rt.count + " review" + (rt.count === 1 ? "" : "s") : "No reviews yet"}</span></div>
          <div class="pdp-price"><span class="now">${inr(p.price)}</span>${p.compare ? `<span class="was">${inr(p.compare)}</span>` : ""}</div>
          <p class="desc">${p.desc || p.blurb || ""}</p>
          <dl class="specs">${Object.entries(specs).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
            <div><dt>In atelier</dt><dd>${out ? "Sold out" : p.stock + " remaining"}</dd></div>
          </dl>
          <div class="qty-row">
            <div class="qty">
              <button onclick="state.qty=Math.max(1,state.qty-1);$('#qtyn').textContent=state.qty">−</button>
              <span id="qtyn">${state.qty}</span>
              <button onclick="state.qty=Math.min(${p.stock || 1},state.qty+1);$('#qtyn').textContent=state.qty">+</button>
            </div>
            <button class="btn btn-primary" style="flex:1" ${out ? "disabled" : ""} onclick="addToCart('${p.id}', state.qty)">${out ? "Sold out" : "Add to bag"}</button>
          </div>
          <button class="btn btn-ghost full" ${out ? "disabled" : ""} onclick="addToCart('${p.id}', state.qty, true); setView('cart')">Buy now</button>
          <p class="buy-note">Free shipping across India on orders above ${inr(s.freeShip)}. Packed in undyed cotton. Ships in 7–8 days.</p>
        </div>
      </div>

      <div class="section" style="padding:72px 0 20px">
        <div class="section-head"><h2>You may also like</h2></div>
        <div class="grid">${related.map(productCard).join("")}</div>
      </div>

      <div class="section" style="padding:40px 0 0">
        <div class="section-head">
          <h2>Reviews</h2>
          <p>${rt.count ? rt.avg.toFixed(1) + " average from " + rt.count + " verified note" + (rt.count === 1 ? "" : "s") + "." : "No verified notes yet."}</p>
        </div>
        <div class="review-grid">
          ${productReviews.length
            ? productReviews.map((r) => reviewCardHTML(r, false)).join("")
            : `<p style="color:var(--muted)">No reviews yet for this piece — be the first to share yours.</p>`}
        </div>
        <div class="form reveal" style="max-width:520px;margin-top:28px">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:500;margin-bottom:14px">Write a review</h3>
          ${alreadyReviewed
            ? `<p style="color:var(--muted)">You've already reviewed this piece — thank you for sharing your note.</p>`
            : `<form onsubmit="submitReview(event,'${p.id}')">
                <label>Your rating</label>
                <div class="star-picker" id="star-picker">
                  ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-star="${n}" onmouseenter="hoverStars(${n})" onmouseleave="hoverStars(0)" onclick="pickStars(${n})" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}
                </div>
                <label>Your name (optional)</label>
                <input id="review-name" placeholder="${currentUser()?.name || "Your name"}">
                <label>Your review</label>
                <textarea id="review-text" placeholder="How does it wear? What did you notice?" required></textarea>
                <button class="btn btn-primary" type="submit" style="margin-top:16px;width:auto">Submit review</button>
              </form>`}
        </div>
      </div>
    </div>`;
  observeReveals();
}

function hoverStars(n) {
  $$("#star-picker .star-btn").forEach((btn) => {
    const v = Number(btn.dataset.star);
    btn.classList.toggle("filled", v <= (n || reviewDraftStars));
  });
}
function pickStars(n) {
  reviewDraftStars = n;
  hoverStars(0);
}
function submitReview(e, productId) {
  e.preventDefault();
  const p = findP(productId);
  if (!p) return;
  if (!reviewDraftStars) return toastMsg("Please select a star rating.");
  const text = ($("#review-text")?.value || "").trim();
  if (text.length < 8) return toastMsg("Tell us a little more about your experience.");
  if (MELVRA.hasReviewed(productId)) return toastMsg("You've already reviewed this piece.");
  const name = ($("#review-name")?.value || "").trim() || currentUser()?.name || "Verified buyer";
  MELVRA.addReview({
    id: "rv-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    productId,
    productName: p.name,
    name: name.slice(0, 60),
    stars: reviewDraftStars,
    text: text.slice(0, 600),
    at: new Date().toISOString(),
    device: MELVRA.deviceId()
  });
  reviewDraftStars = 0;
  toastMsg("Thank you — your review is live.");
  renderProduct();
}

function totals() {
  const s = settings();
  const sub = state.cart.reduce((a, i) => {
    const p = findP(i.id);
    return a + (p ? p.price * i.qty : 0);
  }, 0);
  const afterCoupon = Math.max(0, sub - (state.coupon?.discount || 0));
  const ship = afterCoupon === 0 || afterCoupon >= s.freeShip ? 0 : s.shipFee;
  return { sub, discount: state.coupon?.discount || 0, ship, total: afterCoupon + ship };
}

function tryCoupon() {
  const code = ($("#coupon-input")?.value || state.couponCode || "").trim();
  const sub = state.cart.reduce((a, i) => a + (findP(i.id)?.price || 0) * i.qty, 0);
  const res = MELVRA.applyCoupon(code, sub);
  if (!res.ok) {
    state.coupon = null;
    state.couponCode = "";
    toastMsg(res.reason);
  } else {
    state.coupon = res;
    state.couponCode = res.coupon.code;
    toastMsg(res.coupon.code + " applied · −" + inr(res.discount));
  }
  renderCart();
}
function clearCoupon() {
  state.coupon = null;
  state.couponCode = "";
  renderCart();
}

function cartRows() {
  if (!state.cart.length) return `<div class="empty"><div class="eyebrow">Bag</div><h2>Nothing here yet.</h2><p style="color:var(--muted);margin-bottom:22px">Cotton pieces, waiting to be chosen.</p><button class="btn btn-primary" onclick="setView('home');document.getElementById('shop').scrollIntoView({behavior:'smooth'})">Continue browsing</button></div>`;
  return state.cart.map((i) => {
    const p = findP(i.id);
    if (!p) return "";
    return `
      <div class="cart-item">
        <img src="${p.image}" alt="${p.name}" onclick="setView('product','${p.id}')">
        <div>
          <h4>${p.name}</h4>
          <div class="meta">${p.category} · ${inr(p.price)}</div>
          <div class="qty" style="height:36px">
            <button onclick="setQty('${p.id}', ${i.qty - 1})">−</button>
            <span>${i.qty}</span>
            <button onclick="setQty('${p.id}', ${i.qty + 1})">+</button>
          </div>
        </div>
        <div class="right">
          <b>${inr(p.price * i.qty)}</b>
          <button class="remove" onclick="removeItem('${p.id}')">Remove</button>
        </div>
      </div>`;
  }).join("");
}

function couponBox() {
  return `
    <div class="coupon-box">
      <label>Coupon</label>
      <div class="coupon-row">
        <input id="coupon-input" value="${state.couponCode}" placeholder="WELCOME10" ${state.coupon ? "disabled" : ""}>
        ${state.coupon
          ? `<button class="btn btn-ghost" type="button" onclick="clearCoupon()">Remove</button>`
          : `<button class="btn btn-ghost" type="button" onclick="tryCoupon()">Apply</button>`}
      </div>
    </div>`;
}

function renderCart() {
  const t = totals();
  const s = settings();
  if (state.ordered) {
    $("#view-cart").innerHTML = `
      <div class="success">
        <div class="mark">✓</div>
        <div class="eyebrow">Order confirmed</div>
        <h2>Thank you.</h2>
        <p style="color:var(--muted);max-width:420px;margin:10px auto 8px">Your pieces are being packed with care in Delhi. Order <b>${state.orderNo}</b>.</p>
        <p style="color:var(--muted);margin-bottom:26px">A note will arrive on email shortly. This is a demonstration checkout — no payment was taken.</p>
        <button class="btn btn-primary" onclick="state.ordered=false;setView('home')">Back to the atelier</button>
      </div>`;
    return;
  }
  if (state.checkout && state.cart.length) {
    $("#view-cart").innerHTML = `
      <div class="cart-page">
        <div class="crumb"><a href="#" onclick="state.checkout=false;renderCart();return false;">Bag</a> · Checkout</div>
        <div class="checkout">
          <form class="form" onsubmit="placeOrder(event)">
            <h3>Where should it go?</h3>
            <div class="two">
              <div><label>First name</label><input name="first" required placeholder="Aanya"></div>
              <div><label>Last name</label><input name="last" required placeholder="Mehra"></div>
            </div>
            <label>Email</label><input name="email" type="email" required placeholder="you@email.com">
            <label>Phone</label><input name="phone" required placeholder="+91">
            <label>Address</label><textarea name="address" required placeholder="House, street, area"></textarea>
            <div class="two">
              <div><label>City</label><input name="city" required placeholder="Delhi"></div>
              <div><label>PIN</label><input name="pin" required placeholder="302001"></div>
            </div>
            <label>Payment</label>
            <select name="pay">
              <option>UPI</option>
              <option>Card</option>
              <option>Cash on delivery</option>
            </select>
            <button class="btn btn-accent full" style="margin-top:20px" type="submit">Place order · ${inr(t.total)}</button>
          </form>
          <aside class="summary">
            <h3>On its way</h3>
            ${state.cart.map((i) => { const p = findP(i.id); return p ? `<div class="row"><span>${p.name} × ${i.qty}</span><span>${inr(p.price * i.qty)}</span></div>` : ""; }).join("")}
            ${t.discount ? `<div class="row"><span>Coupon ${state.couponCode}</span><span>−${inr(t.discount)}</span></div>` : ""}
            <div class="row"><span>Shipping</span><span>${t.ship ? inr(t.ship) : "Free"}</span></div>
            <div class="row total"><span>Total</span><span>${inr(t.total)}</span></div>
          </aside>
        </div>
      </div>`;
    return;
  }

  $("#view-cart").innerHTML = `
    <div class="cart-page">
      <div class="section-head" style="margin-bottom:28px">
        <h2>Your bag</h2>
        <p>${count()} piece${count() === 1 ? "" : "s"} · handmade, ready to pack.</p>
      </div>
      ${!state.cart.length ? cartRows() : `
      <div class="cart-layout">
        <div class="cart-list">${cartRows()}</div>
        <aside class="summary">
          <h3>Summary</h3>
          <div class="row"><span>Subtotal</span><span>${inr(t.sub)}</span></div>
          ${t.discount ? `<div class="row"><span>Coupon ${state.couponCode}</span><span>−${inr(t.discount)}</span></div>` : ""}
          <div class="row"><span>Shipping</span><span>${t.ship ? inr(t.ship) : "Free"}</span></div>
          <div class="row total"><span>Total</span><span>${inr(t.total)}</span></div>
          ${couponBox()}
          <button class="btn btn-primary full" style="margin-top:18px" onclick="state.checkout=true;renderCart();window.scrollTo({top:0,behavior:'smooth'})">Checkout</button>
          <button class="btn btn-ghost full" style="margin-top:8px" onclick="setView('home')">Keep looking</button>
          <p class="buy-note">Free shipping above ${inr(s.freeShip)}. Returns within 7 days if unworn.</p>
        </aside>
      </div>`}
    </div>`;
}

function placeOrder(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const t = totals();
  state.orderNo = "MEL-" + Math.floor(24000 + Math.random() * 70000);
  const items = state.cart.map((i) => {
    const p = findP(i.id);
    return { id: i.id, name: p?.name, qty: i.qty, price: p?.price, image: p?.image };
  });
  items.forEach((it) => MELVRA.adjustStock(it.id, -it.qty));
  if (state.couponCode) MELVRA.markCouponUsed(state.couponCode);
  const who = currentUser();
  MELVRA.addOrder({
    id: state.orderNo,
    at: new Date().toISOString(),
    name: (fd.get("first") || "") + " " + (fd.get("last") || ""),
    email: fd.get("email"),
    user: who?.username || "",
    phone: fd.get("phone"),
    address: [fd.get("address"), fd.get("city"), fd.get("pin")].filter(Boolean).join(", "),
    pay: fd.get("pay"),
    items,
    sub: t.sub,
    discount: t.discount,
    coupon: state.couponCode || "",
    ship: t.ship,
    total: t.total,
    status: "New"
  });
  state.cart = [];
  state.coupon = null;
  state.couponCode = "";
  save();
  updateBadge();
  state.ordered = true;
  state.checkout = false;
  renderCart();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDrawer() {
  const t = totals();
  $("#drawer-body").innerHTML = state.cart.length
    ? state.cart.map((i) => {
        const p = findP(i.id);
        if (!p) return "";
        return `<div class="cart-item" style="grid-template-columns:72px 1fr;margin-bottom:10px">
          <img src="${p.image}" alt="" style="width:72px;height:64px">
          <div>
            <h4 style="font-size:20px">${p.name}</h4>
            <div class="meta">${i.qty} × ${inr(p.price)}</div>
            <button class="remove" onclick="removeItem('${p.id}')">Remove</button>
          </div>
        </div>`;
      }).join("")
    : `<p style="color:var(--muted);padding:24px 8px">Your bag is empty.</p>`;
  $("#drawer-total").textContent = inr(t.total);
}

function openDrawer() {
  renderDrawer();
  $("#overlay").classList.add("show");
  $("#drawer").classList.add("show");
}
function closeDrawer() {
  $("#overlay").classList.remove("show");
  $("#drawer").classList.remove("show");
}
function closeMobile() { $("#mobile").style.display = "none"; }
function toggleMobile() {
  const m = $("#mobile");
  m.style.display = m.style.display === "block" ? "none" : "block";
}

function setFilter(f) {
  state.filter = f;
  $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.f === f));
  renderGrid();
}

function observeReveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        e.target.style.animationDelay = (i % 6) * 70 + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  $$(".reveal").forEach((el) => io.observe(el));
}

window.addEventListener("scroll", () => {
  $(".nav")?.classList.toggle("scrolled", window.scrollY > 8);
}, { passive: true });

function goShop() {
  setView("home");
  setTimeout(() => document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }), 60);
}

function currentUser() {
  if (MELVRA.hasSession()) return { role: "admin", name: "Studio", username: MELVRA.DEFAULT_USER };
  const c = MELVRA.customerSession();
  if (c) return { role: "customer", ...c };
  return null;
}

function paintNavAuth() {
  const u = currentUser();
  const label = !u ? "Login" : u.role === "admin" ? "Studio" : u.name.split(" ")[0];
  const action = !u ? "openAuth()" : u.role === "admin" ? "window.location.href='admin.html'" : "setView('account')";
  ["nav-login", "mob-login"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.setAttribute("onclick", action + ";return false;");
  });
}

function openAuth() {
  const u = currentUser();
  if (u?.role === "admin") { window.location.href = "admin.html"; return; }
  if (u?.role === "customer") { setView("account"); return; }
  setView("login");
}

function renderAnnounce() {
  const bar = $("#announce");
  if (!bar) return;
  const a = MELVRA.liveAnnouncement();
  if (!a || sessionStorage.getItem("melvra.hide.note") === a.id) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `<span>${a.text}</span><button type="button" aria-label="Dismiss" onclick="sessionStorage.setItem('melvra.hide.note','${a.id}');renderAnnounce()">×</button>`;
}

function renderAuth(mode) {
  const tab = mode || state.authTab || "in";
  state.authTab = tab;
  $("#view-auth").innerHTML = `
    <div class="auth-wrap">
      <div class="auth-copy">
        <div class="eyebrow">Your place here</div>
        <h1>${tab === "up" ? "Make a house name." : "Come back in."}</h1>
        <p>${tab === "up"
          ? "A customer account keeps your bag and orders. The atelier door is separate — only the studio key opens it."
          : "Customers enter with their own username. The studio key opens admin control. One door, two rooms."}</p>
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="chip ${tab === "in" ? "active" : ""}" onclick="renderAuth('in')">Login</button>
          <button class="chip ${tab === "up" ? "active" : ""}" onclick="renderAuth('up')">Create account</button>
        </div>
        ${tab === "up" ? `
          <form onsubmit="doRegister(event)">
            <label>Name</label><input name="name" required placeholder="Aanya Mehra">
            <label>Username</label><input name="username" required placeholder="aanya">
            <label>Password</label><input name="password" type="password" required>
            <div class="auth-err" id="auth-err"></div>
            <button class="btn btn-primary full" type="submit" style="margin-top:8px">Create account</button>
          </form>` : `
          <form onsubmit="doLogin(event)">
            <label>Username</label><input name="username" required placeholder="your name or studio">
            <label>Password</label><input name="password" type="password" required>
            <div class="auth-err" id="auth-err"></div>
            <button class="btn btn-primary full" type="submit" style="margin-top:8px">Enter</button>
          </form>`}
      </div>
    </div>`;
}

async function doLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const user = String(fd.get("username") || "").trim();
  const pass = String(fd.get("password") || "");
  const err = $("#auth-err");
  const admin = await MELVRA.checkLogin(user, pass);
  if (admin) {
    MELVRA.setSession();
    paintNavAuth();
    window.location.href = "admin.html";
    return;
  }
  const res = await MELVRA.loginCustomer(user, pass);
  if (!res.ok) {
    if (err) err.textContent = res.reason || "Could not enter.";
    return;
  }
  paintNavAuth();
  toastMsg("Welcome back, " + res.user.name);
  setView("account");
}

async function doRegister(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await MELVRA.registerUser({
    name: fd.get("name"),
    username: fd.get("username"),
    password: fd.get("password")
  });
  const err = $("#auth-err");
  if (!res.ok) {
    if (err) err.textContent = res.reason;
    return;
  }
  await MELVRA.loginCustomer(fd.get("username"), fd.get("password"));
  paintNavAuth();
  toastMsg("Account ready");
  setView("account");
}

function logoutUser() {
  MELVRA.clearCustomer();
  MELVRA.clearSession();
  paintNavAuth();
  toastMsg("Signed out");
  setView("home");
}

function renderAccount() {
  const u = currentUser();
  if (!u || u.role === "admin") {
    if (u?.role === "admin") { window.location.href = "admin.html"; return; }
    setView("login");
    return;
  }
  const mine = MELVRA.orders().filter((o) => o.email === u.username || o.user === u.username || o.name === u.name);
  $("#view-account").innerHTML = `
    <div class="account-page">
      <div class="eyebrow">House account</div>
      <div class="section-head">
        <h2>${u.name}</h2>
        <p>@${u.username} · customer</p>
      </div>
      <div class="qty-row" style="margin-bottom:28px">
        <button class="btn btn-ghost" onclick="setView('home')">Continue shopping</button>
        <button class="btn btn-ghost" onclick="logoutUser()">Sign out</button>
      </div>
      <h3 style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:500;margin-bottom:14px">Your orders</h3>
      ${mine.length ? `<div class="cart-list">${mine.map((o) => `
        <div class="cart-item" style="grid-template-columns:1fr auto">
          <div>
            <h4>${o.id}</h4>
            <div class="meta">${new Date(o.at).toLocaleDateString("en-IN")} · ${o.status || "New"}</div>
          </div>
          <b>${inr(o.total)}</b>
        </div>`).join("")}</div>` : `<p style="color:var(--muted)">No orders yet.</p>`}
    </div>`;
}

// Pushes the admin-editable brand name, tagline, business email and
// free-shipping threshold into the live DOM — these were previously only
// saved to settings and never actually rendered on the storefront.
function applyBrandSettings() {
  const s = settings();
  const brand = s.brand || "MELVRA";
  const tagline = s.tagline || "Handmade cotton";
  $$("#brand-name, #footer-brand-name").forEach((el) => { el.textContent = brand; });
  $$("#brand-tag, #footer-brand-tag").forEach((el) => { el.textContent = tagline; });
  const emailEl = $("#footer-email");
  if (emailEl && s.email) {
    emailEl.textContent = s.email;
    emailEl.href = "mailto:" + s.email;
  }
  const freeMetaEl = $("#meta-freeship");
  if (freeMetaEl) freeMetaEl.textContent = inr(s.freeShip) + "+";
  const freeNoteEl = $("#footer-freeship-note");
  if (freeNoteEl) freeNoteEl.textContent = `Free Shipping Across India on Orders Above ${inr(s.freeShip)}.`;
  const copyBrandEl = $("#footer-copy-brand");
  if (copyBrandEl) copyBrandEl.textContent = "© " + new Date().getFullYear() + " " + brand;
  document.title = brand + " — " + tagline;
}

// Establish a baseline history entry for the home screen, then listen for
// the browser's back/forward buttons and replay the matching in-app view
// instead of letting the browser navigate away from the page.
history.replaceState({ melvraView: "home", melvraId: null }, "", location.pathname + location.search);
window.addEventListener("popstate", (e) => {
  const s = e.state || { melvraView: "home", melvraId: null };
  setView(s.melvraView, s.melvraId, { fromPopState: true });
});

window.addEventListener("DOMContentLoaded", () => {
  applyBrandSettings();
  renderGrid();
  renderCategorySections();
  renderHomeReviews();
  renderSpotlight();
  updateBadge();
  observeReveals();
  paintNavAuth();
  renderAnnounce();
  setTimeout(() => $("#loader")?.classList.add("hide"), 900);

  // Live updates: when admin changes something in the studio, every open
  // shop tab reflects it automatically — no refresh needed.
  MELVRA.startSync((type) => {
    if (type === "catalog") {
      if (state.view === "home") { renderGrid(); renderCategorySections(); }
      if (state.view === "product") renderProduct();
      if (state.view === "cart") renderCart();
      renderSpotlight();
    }
    if (type === "categories") {
      if (state.view === "home") { renderFilterChips(); renderCategorySections(); }
    }
    if (type === "settings") {
      if (state.view === "cart" || state.view === "checkout") renderCart();
      renderSpotlight();
      applyBrandSettings();
    }
    if (type === "announcements") renderAnnounce();
    if (type === "reviews") {
      if (state.view === "home") renderHomeReviews();
      if (state.view === "product") renderProduct();
    }
  });
});
