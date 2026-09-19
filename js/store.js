/* MELVRA shared store — catalog, coupons, orders, bills, categories, settings */
(function (global) {
  /* ---------------------------------------------------------------
     CLOUD SYNC (Firebase Firestore)
     If js/firebase-config.js has real keys, every admin change is
     pushed to Firestore and every open tab/device listens for
     changes and updates its local copy automatically.
     If no config is set, everything falls back to browser-only
     storage exactly like before — nothing breaks.
  --------------------------------------------------------------- */
  let fsdb = null;
  let cloudReady = false;
  try {
    const cfg = global.MELVRA_FIREBASE_CONFIG;
    if (cfg && cfg.apiKey && cfg.apiKey !== "PASTE_API_KEY_HERE" && global.firebase) {
      global.firebase.initializeApp(cfg);
      fsdb = global.firebase.firestore();
      cloudReady = true;
    }
  } catch (e) {
    console.warn("MELVRA cloud sync not started:", e);
  }

  function cloudSet(path, data) {
    if (!fsdb) return;
    fsdb.doc(path).set(data).catch((e) => console.error("Cloud save failed:", path, e));
  }
  function cloudSetDoc(collection, id, data) {
    if (!fsdb) return;
    fsdb.collection(collection).doc(String(id)).set(data).catch((e) => console.error("Cloud save failed:", collection, id, e));
  }
  function cloudMergeDoc(collection, id, data) {
    if (!fsdb) return;
    fsdb.collection(collection).doc(String(id)).set(data, { merge: true }).catch((e) => console.error("Cloud update failed:", collection, id, e));
  }
  function cloudDeleteDoc(collection, id) {
    if (!fsdb) return;
    fsdb.collection(collection).doc(String(id)).delete().catch((e) => console.error("Cloud delete failed:", collection, id, e));
  }

  const seeded = { products: false, coupons: false, settings: false, notes: false, categories: false };

  // Order timestamps can be an ISO string (new Date().toISOString()) — always
  // compare them as real Date objects, never subtract the raw strings.
  function orderTime(o) {
    const t = new Date(o && o.at).getTime();
    return isNaN(t) ? 0 : t;
  }
  function reviewTime(r) {
    const t = new Date(r && r.at).getTime();
    return isNaN(t) ? 0 : t;
  }

  function startSync(onChange) {
    if (!fsdb) return false;

    // Products: one Firestore document per product (keeps big images from
    // ever hitting Firestore's 1MB-per-document limit on a single array doc).
    fsdb.collection("products").onSnapshot((snap) => {
      if (snap.empty && !seeded.products) {
        seeded.products = true;
        DEFAULT_PRODUCTS.forEach((p) => cloudSetDoc("products", p.id, p));
        return;
      }
      // Always mirror the live Firestore state locally — including an empty
      // list — once seeding has happened once. Skipping the write when the
      // list is empty is what made deleted products "come back": the local
      // copy kept the old data and catalog() treated an empty save as "no
      // save yet" and re-served the defaults.
      const list = snap.docs.map((d) => d.data());
      write(KEYS.catalog, list);
      onChange && onChange("catalog");
    }, (e) => console.error("Catalog sync error:", e));

    fsdb.doc("melvra/coupons").onSnapshot((doc) => {
      if (!doc.exists && !seeded.coupons) {
        seeded.coupons = true;
        cloudSet("melvra/coupons", { list: DEFAULT_COUPONS });
        return;
      }
      if (doc.exists) {
        write(KEYS.coupons, doc.data().list || []);
        onChange && onChange("coupons");
      }
    }, (e) => console.error("Coupon sync error:", e));

    fsdb.doc("melvra/settings").onSnapshot((doc) => {
      if (!doc.exists && !seeded.settings) {
        seeded.settings = true;
        cloudSet("melvra/settings", DEFAULT_SETTINGS);
        return;
      }
      if (doc.exists) {
        write(KEYS.settings, doc.data() || {});
        onChange && onChange("settings");
      }
    }, (e) => console.error("Settings sync error:", e));

    fsdb.doc("melvra/categories").onSnapshot((doc) => {
      if (!doc.exists && !seeded.categories) {
        seeded.categories = true;
        cloudSet("melvra/categories", { list: deriveCategoryOrder() });
        return;
      }
      if (doc.exists) {
        write(KEYS.categories, doc.data().list || []);
        onChange && onChange("categories");
      }
    }, (e) => console.error("Category sync error:", e));

    fsdb.doc("melvra/announcements").onSnapshot((doc) => {
      if (!doc.exists && !seeded.notes) {
        seeded.notes = true;
        cloudSet("melvra/announcements", { list: [] });
        return;
      }
      if (doc.exists) {
        write(KEYS.notes, doc.data().list || []);
        onChange && onChange("announcements");
      }
    }, (e) => console.error("Announcement sync error:", e));

    fsdb.collection("orders").onSnapshot((snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => orderTime(b) - orderTime(a));
      write(KEYS.orders, list);
      purgeExpiredDeliveries();
      onChange && onChange("orders");
    }, (e) => console.error("Orders sync error:", e));

    // Bills: a permanent, append-only record of every order ever placed.
    // Unlike the "orders" collection (which admin can clean up), nothing
    // ever removes a document from here.
    fsdb.collection("bills").onSnapshot((snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => orderTime(b) - orderTime(a));
      write(KEYS.bills, list);
      onChange && onChange("bills");
    }, (e) => console.error("Bills sync error:", e));

    // Reviews: one Firestore document per customer review, shared and
    // synced everywhere just like products. No seeding — starts empty.
    fsdb.collection("reviews").onSnapshot((snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => reviewTime(b) - reviewTime(a));
      write(KEYS.reviews, list);
      onChange && onChange("reviews");
    }, (e) => console.error("Reviews sync error:", e));

    return true;
  }

  const KEYS = {
    catalog: "melvra.catalog",
    coupons: "melvra.coupons",
    orders: "melvra.orders",
    bills: "melvra.bills",
    categories: "melvra.categories",
    settings: "melvra.settings",
    pass: "melvra.admin.pass",
    session: "melvra.admin.session",
    users: "melvra.users",
    customer: "melvra.customer.session",
    notes: "melvra.announcements",
    reviews: "melvra.reviews",
    device: "melvra.device"
  };

  const DEFAULT_PASS_SHA = "a64a9b3cc1f78f6c4d9ee8b2320dfea633b7ae2c3ee6140335982a7b5ea7d656";
  const DEFAULT_USER = "studio";

  // How long a Delivered order stays in the active Orders tab before it is
  // auto-removed. The full record survives forever in Bills.
  const DELIVERED_RETENTION_DAYS = 10;

  const DEFAULT_PRODUCTS = [
    { id: "dune-knot", name: "Dune Knot", category: "Bracelet", price: 649, compare: 799, rating: 0, reviewCount: 0, tag: "Bestseller", image: "images/qmOsP.jpg", gallery: ["images/qmOsP.jpg", "images/gtZvn.jpg", "images/wJAeE.jpg", "images/5Mm9H.jpg"], blurb: "A double-cord knot in sun-washed sand. Tied by hand, worn every day.", desc: "The Dune Knot is our quiet signature — two strands of hand-finished cotton, gathered with a sliding knot that sits soft against the wrist. No clasp. No shine that shouts. Just the kind of piece you forget is there until someone asks about it.", specs: { Material: "Hand-spun cotton cord", Finish: "Waxed sliding knot", Size: "Adjustable 14–20 cm", Origin: "Made in Delhi" }, stock: 28, visible: true },
    { id: "olive-braid", name: "Olive Braid", category: "Bracelet", price: 729, compare: 890, rating: 0, reviewCount: 0, tag: "New", image: "images/wFUCU.jpg", gallery: ["images/wFUCU.jpg", "images/wJAeE.jpg", "images/gtZvn.jpg", "images/5Mm9H.jpg"], blurb: "A dense three-strand braid in deep olive. Weight you can feel.", desc: "Braided slowly so each ridge holds. Olive Braid is thicker than our thread pieces — a small architecture of cotton that darkens slightly with wear and time. Finished with a sailor knot and two gathered ends.", specs: { Material: "Braided cotton rope", Finish: "Sailor knot + ball ends", Size: "Adjustable 15–21 cm", Origin: "Made in Delhi" }, stock: 18, visible: true },
    { id: "ivory-thread", name: "Ivory Thread", category: "Bracelet", price: 549, compare: 649, rating: 0, reviewCount: 0, tag: "Everyday", image: "images/bTn7N.jpg", gallery: ["images/bTn7N.jpg", "images/gtZvn.jpg", "images/qmOsP.jpg", "images/5Mm9H.jpg"], blurb: "A single ivory line and one small brass bead. Almost not there.", desc: "The lightest piece we make. A fine cotton thread, a brushed brass cylinder, and a knot that disappears under a cuff. Meant to be stacked or worn alone against bare skin.", specs: { Material: "Fine cotton thread + brass", Finish: "Brushed bead, sliding knot", Size: "Adjustable 14–20 cm", Origin: "Made in Delhi" }, stock: 40, visible: true },
    { id: "clay-twin", name: "Clay Twin", category: "Bracelet", price: 679, compare: 820, rating: 0, reviewCount: 0, tag: "Limited", image: "images/5LXUn.jpg", gallery: ["images/5LXUn.jpg", "images/gtZvn.jpg", "images/qmOsP.jpg", "images/5Mm9H.jpg"], blurb: "Two terracotta cords, one knot. Warm as fired clay.", desc: "Clay Twin is dyed in small batches so no two coils read the same rust. The double wrap sits close, the knot rides the outside of the wrist. A colour that looks like late light on sandstone.", specs: { Material: "Twin cotton cord", Finish: "Plant-dyed terracotta", Size: "Adjustable 14–20 cm", Origin: "Made in Delhi" }, stock: 14, visible: true },
    { id: "night-slide", name: "Night Slide", category: "Bracelet", price: 799, compare: 980, rating: 0, reviewCount: 0, tag: "Editor's", image: "images/16WlU.jpg", gallery: ["images/16WlU.jpg", "images/EPRmw.jpg", "images/bTn7N.jpg", "images/5Mm9H.jpg"], blurb: "Charcoal cord, a single brass slide. Evening, simplified.", desc: "Night Slide is the piece we reach for after dark. A charcoal cotton loop running through a hollow brass cylinder — the metal warms to the skin within minutes. Clean. Almost architectural.", specs: { Material: "Waxed cotton + brass slide", Finish: "Matte charcoal, brushed metal", Size: "Adjustable 15–21 cm", Origin: "Made in Delhi" }, stock: 11, visible: true },
    { id: "linen-fob", name: "Linen Fob", category: "Keychain", price: 399, compare: 499, rating: 0, reviewCount: 0, tag: "Utility", image: "images/NNa1D.jpg", gallery: ["images/NNa1D.jpg", "images/EPRmw.jpg", "images/5Mm9H.jpg", "images/16WlU.jpg"], blurb: "A short cotton strap and an aged brass ring. Pocket-quiet.", desc: "Cut from the same cotton we use on the bench, folded once and stitched. The Linen Fob is a small useful object — keys, a studio keycard, nothing more. Hardware is unlacquered brass that will cloud with use.", specs: { Material: "Woven cotton webbing", Finish: "Aged brass ring", Size: "8 cm drop", Origin: "Made in Delhi" }, stock: 32, visible: true },
    { id: "tide-charm", name: "Tide Charm", category: "Keychain", price: 449, compare: 560, rating: 0, reviewCount: 0, tag: "Gift", image: "images/EPRmw.jpg", gallery: ["images/EPRmw.jpg", "images/NNa1D.jpg", "images/16WlU.jpg", "images/5Mm9H.jpg"], blurb: "Ivory and ink, twisted into a loop. A charm that holds keys.", desc: "Two cords — cream and charcoal — twisted until they become one loop. Tide Charm hangs from a lobster clasp and a short brass chain. It knocks softly against a door, which is the point.", specs: { Material: "Twisted cotton + brass hardware", Finish: "Antique clasp", Size: "11 cm overall", Origin: "Made in Delhi" }, stock: 22, visible: true },
    { id: "trio-stack", name: "Trio Stack", category: "Set", price: 1290, compare: 1640, rating: 0, reviewCount: 0, tag: "Set", image: "images/wJAeE.jpg", gallery: ["images/wJAeE.jpg", "images/gtZvn.jpg", "images/qmOsP.jpg", "images/wFUCU.jpg"], blurb: "Ivory, olive, sand. Three bracelets, one quiet stack.", desc: "The way we wear them in the atelier. Three braided cords in ivory, olive and sand, sold together so the mix is already decided. Save against buying them apart. Tie once, leave on.", specs: { Material: "Three braided cotton bracelets", Finish: "Mixed earth tones", Size: "Each adjustable 14–20 cm", Origin: "Made in Delhi" }, stock: 9, visible: true }
  ];

  const DEFAULT_COUPONS = [
    { id: "c1", code: "WELCOME10", type: "percent", value: 10, min: 499, maxUses: 200, used: 0, active: true, note: "First-order courtesy" },
    { id: "c2", code: "MELVRA200", type: "flat", value: 200, min: 999, maxUses: 80, used: 0, active: true, note: "Free-shipping companion" },
    { id: "c3", code: "STUDIO50", type: "flat", value: 50, min: 400, maxUses: 500, used: 0, active: true, note: "Atelier drop" }
  ];

  const DEFAULT_SETTINGS = {
    brand: "MELVRA",
    tagline: "Handmade Cotton",
    freeShip: 599,
    shipFee: 79,
    email: "hello@melvra.in",
    spotlightProductId: "trio-stack",
    spotlightLabel: "Ivory · sand · clay"
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function catalog() {
    const saved = read(KEYS.catalog, null);
    // IMPORTANT: only fall back to the starter catalog when nothing has ever
    // been saved (saved === null). An explicitly emptied catalog (saved is
    // an array of length 0, because every product was deleted) must stay
    // empty — treating "[]" the same as "never saved" was the bug that made
    // deleted products reappear.
    return saved && Array.isArray(saved) ? saved : DEFAULT_PRODUCTS.map((p) => ({ ...p }));
  }
  function saveCatalog(list) { write(KEYS.catalog, list); }
  function liveProducts() {
    return catalog().filter((p) => p.visible !== false);
  }
  function findProduct(id) {
    return catalog().find((p) => p.id === id);
  }
  function upsertProduct(prod) {
    const list = catalog();
    const i = list.findIndex((p) => p.id === prod.id);
    let saved;
    if (i >= 0) { list[i] = { ...list[i], ...prod }; saved = list[i]; }
    else { list.push(prod); saved = prod; }
    saveCatalog(list);
    cloudSetDoc("products", saved.id, saved);
    if (saved.category) ensureCategory(saved.category);
    return list;
  }
  function deleteProduct(id) {
    saveCatalog(catalog().filter((p) => p.id !== id));
    cloudDeleteDoc("products", id);
  }
  function adjustStock(id, delta) {
    const list = catalog();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    p.stock = Math.max(0, (p.stock || 0) + delta);
    saveCatalog(list);
    cloudMergeDoc("products", id, { stock: p.stock });
  }

  /* ---------------------------------------------------------------
     CATEGORIES — controls which homepage sections exist and in what
     order. A brand-new category (typed as "Custom" on a product) is
     placed at the very top; existing ones keep their relative order
     underneath.
  --------------------------------------------------------------- */
  function deriveCategoryOrder() {
    const seen = [];
    catalog().forEach((p) => { if (p.category && !seen.includes(p.category)) seen.push(p.category); });
    return seen;
  }
  function categoryOrder() {
    const saved = read(KEYS.categories, null);
    if (saved && Array.isArray(saved) && saved.length) return saved;
    return deriveCategoryOrder();
  }
  function saveCategoryOrder(list) {
    write(KEYS.categories, list);
    cloudSet("melvra/categories", { list });
  }
  function ensureCategory(name) {
    if (!name) return;
    const list = categoryOrder();
    if (!list.includes(name)) {
      list.unshift(name);
      saveCategoryOrder(list);
    }
  }
  function moveCategory(name, dir) {
    const list = categoryOrder();
    const i = list.indexOf(name);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    saveCategoryOrder(list);
  }
  function removeCategory(name) {
    saveCategoryOrder(categoryOrder().filter((c) => c !== name));
  }

  function coupons() { return read(KEYS.coupons, DEFAULT_COUPONS.map((c) => ({ ...c }))); }
  function saveCoupons(list) { write(KEYS.coupons, list); }
  function upsertCoupon(c) {
    const list = coupons();
    const i = list.findIndex((x) => x.id === c.id || x.code === c.code);
    if (i >= 0) list[i] = { ...list[i], ...c };
    else list.push(c);
    saveCoupons(list);
    cloudSet("melvra/coupons", { list });
  }
  function deleteCoupon(id) {
    const list = coupons().filter((c) => c.id !== id);
    saveCoupons(list);
    cloudSet("melvra/coupons", { list });
  }

  function applyCoupon(code, subtotal) {
    if (!code) return { ok: false, reason: "Enter a code" };
    const c = coupons().find((x) => x.code.toUpperCase() === String(code).trim().toUpperCase());
    if (!c) return { ok: false, reason: "Code not found" };
    if (!c.active) return { ok: false, reason: "Code is paused" };
    if (c.maxUses && c.used >= c.maxUses) return { ok: false, reason: "Code is exhausted" };
    if (subtotal < (c.min || 0)) return { ok: false, reason: "Minimum order ₹" + (c.min || 0) };
    const discount = c.type === "percent"
      ? Math.round(subtotal * (c.value / 100))
      : Math.min(c.value, subtotal);
    return { ok: true, coupon: c, discount };
  }
  function markCouponUsed(code) {
    const list = coupons();
    const c = list.find((x) => x.code.toUpperCase() === String(code).toUpperCase());
    if (c) {
      c.used = (c.used || 0) + 1;
      saveCoupons(list);
      cloudSet("melvra/coupons", { list });
    }
  }

  /* ---------------------------------------------------------------
     ORDERS (active/working list, shown in Studio → Orders) and
     BILLS (permanent record of every order ever placed, shown in
     Studio → Bills; never auto-deleted).
  --------------------------------------------------------------- */
  function orders() {
    return read(KEYS.orders, []).slice().sort((a, b) => orderTime(b) - orderTime(a));
  }
  function addOrder(order) {
    const list = orders();
    list.unshift(order);
    write(KEYS.orders, list);
    cloudSetDoc("orders", order.id, order);
    // Also record it permanently in Bills — this copy is never removed by
    // the delivered-order cleanup below.
    const billList = bills();
    billList.unshift(order);
    write(KEYS.bills, billList);
    cloudSetDoc("bills", order.id, order);
  }
  function updateOrder(id, patch) {
    const next = { ...patch };
    if (patch.status === "Delivered") next.deliveredAt = new Date().toISOString();
    const list = orders().map((o) => (o.id === id ? { ...o, ...next } : o));
    write(KEYS.orders, list);
    cloudMergeDoc("orders", id, next);
    // Keep the permanent bill record's status in sync too, without ever
    // removing the bill itself.
    const billList = bills().map((o) => (o.id === id ? { ...o, ...next } : o));
    write(KEYS.bills, billList);
    cloudMergeDoc("bills", id, next);
  }
  function deleteOrder(id) {
    write(KEYS.orders, orders().filter((o) => o.id !== id));
    cloudDeleteDoc("orders", id);
    // Bills are untouched on purpose — this only clears the working queue.
  }
  // Removes Delivered orders from the active queue once they have sat there
  // for DELIVERED_RETENTION_DAYS. Their full record stays in Bills forever.
  function purgeExpiredDeliveries() {
    const cutoff = Date.now() - DELIVERED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const list = orders();
    const stale = list.filter((o) => o.status === "Delivered" && new Date(o.deliveredAt || o.at).getTime() <= cutoff);
    if (!stale.length) return false;
    stale.forEach((o) => deleteOrder(o.id));
    return true;
  }

  function bills() {
    return read(KEYS.bills, []).slice().sort((a, b) => orderTime(b) - orderTime(a));
  }

  function settings() { return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }; }
  function saveSettings(s) {
    const next = { ...settings(), ...s };
    write(KEYS.settings, next);
    cloudSet("melvra/settings", next);
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function checkLogin(user, pass) {
    if (String(user).trim().toLowerCase() !== DEFAULT_USER) return false;
    const hash = await sha256(pass);
    const stored = localStorage.getItem(KEYS.pass) || DEFAULT_PASS_SHA;
    return hash === stored;
  }
  function setSession() {
    const token = Date.now() + "." + Math.random().toString(36).slice(2);
    sessionStorage.setItem(KEYS.session, token);
    return token;
  }
  function hasSession() { return !!sessionStorage.getItem(KEYS.session); }
  function clearSession() { sessionStorage.removeItem(KEYS.session); }
  async function setPassword(next) {
    localStorage.setItem(KEYS.pass, await sha256(next));
  }

  function slug(name) {
    return String(name || "piece")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  }

  function users() { return read(KEYS.users, []); }
  function saveUsers(list) { write(KEYS.users, list); }
  function findUser(username) {
    return users().find((u) => u.username.toLowerCase() === String(username || "").trim().toLowerCase());
  }
  async function registerUser({ name, username, password }) {
    const uname = String(username || "").trim().toLowerCase();
    if (!uname || uname.length < 3) return { ok: false, reason: "Username must be at least 3 letters." };
    if (uname === DEFAULT_USER) return { ok: false, reason: "That name is reserved." };
    if (findUser(uname)) return { ok: false, reason: "That username is already taken." };
    if (!password || password.length < 4) return { ok: false, reason: "Password must be at least 4 characters." };
    const list = users();
    list.push({
      id: "u-" + Date.now(),
      name: String(name || uname).trim(),
      username: uname,
      pass: await sha256(password),
      at: new Date().toISOString()
    });
    saveUsers(list);
    return { ok: true, user: { name: String(name || uname).trim(), username: uname } };
  }
  async function loginCustomer(username, password) {
    const u = findUser(username);
    if (!u) return { ok: false, reason: "No account with that username." };
    const hash = await sha256(password);
    if (hash !== u.pass) return { ok: false, reason: "Wrong password." };
    const sess = { name: u.name, username: u.username, at: Date.now() };
    sessionStorage.setItem(KEYS.customer, JSON.stringify(sess));
    return { ok: true, user: sess };
  }
  function customerSession() {
    try { return JSON.parse(sessionStorage.getItem(KEYS.customer) || "null"); }
    catch { return null; }
  }
  function clearCustomer() { sessionStorage.removeItem(KEYS.customer); }

  function announcements() { return read(KEYS.notes, []); }
  function saveAnnouncements(list) { write(KEYS.notes, list); }
  function liveAnnouncement() {
    return announcements().find((a) => a.active) || null;
  }
  function upsertAnnouncement(a) {
    const list = announcements();
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) list[i] = { ...list[i], ...a };
    else list.unshift(a);
    saveAnnouncements(list);
    cloudSet("melvra/announcements", { list });
  }
  function deleteAnnouncement(id) {
    const list = announcements().filter((a) => a.id !== id);
    saveAnnouncements(list);
    cloudSet("melvra/announcements", { list });
  }

  /* ---------------------------------------------------------------
     REVIEWS — real customer ratings + written notes, one per
     product per device (basic spam/duplicate guard). Ratings shown
     anywhere on the shop are always calculated live from this list;
     nothing here is pre-seeded or fake.
  --------------------------------------------------------------- */
  function deviceId() {
    let id = localStorage.getItem(KEYS.device);
    if (!id) {
      id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEYS.device, id);
    }
    return id;
  }
  function reviews() {
    return read(KEYS.reviews, []).slice().sort((a, b) => reviewTime(b) - reviewTime(a));
  }
  function reviewsForProduct(productId) {
    return reviews().filter((r) => r.productId === productId);
  }
  function hasReviewed(productId) {
    const id = deviceId();
    return reviewsForProduct(productId).some((r) => r.device === id);
  }
  function addReview(review) {
    const list = reviews();
    list.unshift(review);
    write(KEYS.reviews, list);
    cloudSetDoc("reviews", review.id, review);
  }
  function deleteReview(id) {
    write(KEYS.reviews, reviews().filter((r) => r.id !== id));
    cloudDeleteDoc("reviews", id);
  }
  // Live rating for one product — never a stored/static number.
  function productRating(productId) {
    const list = reviewsForProduct(productId);
    if (!list.length) return { avg: 0, count: 0 };
    const sum = list.reduce((a, r) => a + (Number(r.stars) || 0), 0);
    return { avg: Math.round((sum / list.length) * 10) / 10, count: list.length };
  }
  // Live storewide average, used on the homepage reviews hero.
  function overallRating() {
    const list = reviews();
    if (!list.length) return { avg: 0, count: 0 };
    const sum = list.reduce((a, r) => a + (Number(r.stars) || 0), 0);
    return { avg: Math.round((sum / list.length) * 10) / 10, count: list.length };
  }

  function resetDemo() {
    localStorage.removeItem(KEYS.catalog);
    localStorage.removeItem(KEYS.coupons);
    localStorage.removeItem(KEYS.orders);
    localStorage.removeItem(KEYS.settings);
    localStorage.removeItem(KEYS.notes);
    localStorage.removeItem(KEYS.categories);
    // Bills are the permanent record — a reset intentionally does not
    // touch KEYS.bills.
  }

  global.MELVRA = {
    KEYS, DEFAULT_USER, DEFAULT_PRODUCTS,
    catalog, saveCatalog, liveProducts, findProduct, upsertProduct, deleteProduct, adjustStock,
    categoryOrder, saveCategoryOrder, ensureCategory, moveCategory, removeCategory,
    coupons, saveCoupons, upsertCoupon, deleteCoupon, applyCoupon, markCouponUsed,
    orders, addOrder, updateOrder, deleteOrder, purgeExpiredDeliveries, bills,
    DELIVERED_RETENTION_DAYS,
    settings, saveSettings,
    checkLogin, setSession, hasSession, clearSession, setPassword,
    users, findUser, registerUser, loginCustomer, customerSession, clearCustomer,
    announcements, saveAnnouncements, liveAnnouncement, upsertAnnouncement, deleteAnnouncement,
    deviceId, reviews, reviewsForProduct, hasReviewed, addReview, deleteReview, productRating, overallRating,
    slug, resetDemo, sha256,
    startSync, isCloudReady: () => cloudReady
  };
})(window);
