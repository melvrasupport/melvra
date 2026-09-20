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
  let cloudConfigured = false;
  const syncInfo = { configured: false, ready: false, lastError: "" };
  try {
    const cfg = global.MELVRA_FIREBASE_CONFIG;
    cloudConfigured = !!(cfg && cfg.apiKey && cfg.apiKey !== "PASTE_API_KEY_HERE");
    if (cloudConfigured && global.firebase) {
      global.firebase.initializeApp(cfg);
      fsdb = global.firebase.firestore();
      // ignoreUndefinedProperties: a missing field can never kill a whole write.
      // AutoDetectLongPolling: some mobile networks / ISPs / proxies block
      // Firestore's streaming connection, which made saves + live updates
      // silently hang on those devices. This lets it fall back automatically.
      try {
        fsdb.settings({ ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true });
      } catch (e) { console.warn("Firestore settings not applied:", e); }
      cloudReady = true;
    }
  } catch (e) {
    console.warn("MELVRA cloud sync not started:", e);
  }
  syncInfo.configured = cloudConfigured;
  syncInfo.ready = cloudReady;

  // Firestore rejects any field whose value is `undefined`. Strip them so a
  // missing product name/price/image never silently kills the whole write.
  function sanitize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(sanitize).filter((v) => v !== undefined);
    if (typeof obj === "object") {
      const out = {};
      for (const k in obj) {
        const v = sanitize(obj[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return obj;
  }

  const RES_OK = { ok: true };
  function friendlyError(e) {
    const code = (e && e.code) || "";
    if (code === "permission-denied") return "Firebase refused the request (Firestore Rules expired or too strict). Open Firebase Console → Firestore → Rules and allow read/write.";
    if (code === "resource-exhausted") return "Firebase free quota is used up for today, or the item is too big.";
    if (code === "invalid-argument") return "The data is too large/invalid for Firebase (usually too many or too heavy photos).";
    if (code === "unavailable" || code === "deadline-exceeded") return "Could not reach Firebase. Check the internet connection and try again.";
    if (code === "not-found") return "That record no longer exists in the cloud.";
    return (e && e.message) || "Unknown error";
  }
  // Every cloud write returns a Promise<{ok, message?}> instead of failing
  // silently, so the Studio can TELL the admin when something did not save.
  function guard(promise, label) {
    return promise.then(() => RES_OK).catch((e) => {
      console.error("Cloud write failed:", label, e);
      const message = friendlyError(e);
      syncInfo.lastError = message;
      return { ok: false, error: e, message };
    });
  }
  function cloudSet(path, data) {
    if (!fsdb) return Promise.resolve(RES_OK);
    return guard(fsdb.doc(path).set(sanitize(data)), path);
  }
  function cloudSetDoc(collection, id, data) {
    if (!fsdb) return Promise.resolve(RES_OK);
    return guard(fsdb.collection(collection).doc(String(id)).set(sanitize(data)), collection + "/" + id);
  }
  // update() (unlike set-with-merge) NEVER creates a document, so a late
  // status/stock change can't resurrect a deleted product/order as a broken
  // half-empty "ghost" record.
  function cloudUpdateDoc(collection, id, data) {
    if (!fsdb) return Promise.resolve(RES_OK);
    return guard(fsdb.collection(collection).doc(String(id)).update(data), collection + "/" + id);
  }
  function cloudDeleteDoc(collection, id) {
    if (!fsdb) return Promise.resolve(RES_OK);
    return guard(fsdb.collection(collection).doc(String(id)).delete(), collection + "/" + id);
  }

  // Firestore allows max ~1 MiB per document. Photos are stored inside the
  // product document, so measure BEFORE saving and refuse cleanly instead of
  // letting Firebase reject the write later (which made the product show up
  // for a moment and then vanish again).
  const MAX_DOC_BYTES = 950000;
  function docBytes(obj) {
    const json = JSON.stringify(obj);
    try { return new Blob([json]).size; } catch (e) { return json.length * 2; }
  }

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

  const loaded = { catalog: false };
  function catalogLoaded() { return !cloudReady || loaded.catalog; }

  // Seeding rules (fixes starter products re-appearing / catalog being
  // overwritten): we only ever seed when the SERVER confirms the data does not
  // exist (never from an unconfirmed local-cache "empty" snapshot), and the
  // catalog additionally checks a server-side flag that admin saves set.
  let seedingProducts = false;
  let metaMarked = false;
  function seedProductsIfNeverSetUp() {
    if (!fsdb || seedingProducts) return;
    seedingProducts = true;
    fsdb.doc("melvra/meta").get({ source: "server" }).then((m) => {
      if (m.exists && m.data() && m.data().productsSeeded) return; // shop was set up before → genuinely empty, leave it alone
      const batch = fsdb.batch();
      DEFAULT_PRODUCTS.forEach((p) => batch.set(fsdb.collection("products").doc(String(p.id)), sanitize(p)));
      batch.set(fsdb.doc("melvra/meta"), { productsSeeded: true }, { merge: true });
      return batch.commit();
    }).catch((e) => {
      console.error("Seed check failed:", e);
      seedingProducts = false;
    });
  }
  // Called whenever admin saves/deletes a product: records "this shop has been
  // set up", so an emptied catalog is never refilled with starter products.
  function markProductsSetUp() {
    if (!fsdb || metaMarked) return;
    metaMarked = true;
    fsdb.doc("melvra/meta").set({ productsSeeded: true }, { merge: true }).catch(() => { metaMarked = false; });
  }
  const seeded = { coupons: false, settings: false, notes: false, categories: false };

  function validProduct(p) { return p && typeof p === "object" && p.id && p.name; }

  /* startSync(onChange, opts)
       opts.admin   → also listen to ALL orders + bills (Studio only!).
                      The public shop must never download other customers'
                      names / phones / addresses.
       opts.onError → called with (what, error) when a listener fails
                      (e.g. Firestore rules expired). */
  function startSync(onChange, opts) {
    if (!fsdb) return false;
    opts = opts || {};
    const emit = (t) => { try { onChange && onChange(t); } catch (e) { console.error("Screen refresh failed for", t, e); } };
    const onErr = (what) => (e) => {
      console.error(what + " sync error:", e);
      syncInfo.lastError = friendlyError(e);
      try { opts.onError && opts.onError(what, e); } catch (x) { /* ignore */ }
    };

    // Products: one Firestore document per product (keeps big images from
    // ever hitting Firestore's 1MB-per-document limit on a single array doc).
    fsdb.collection("products").onSnapshot((snap) => {
      const fromServer = !snap.metadata.fromCache;
      if (snap.empty) {
        if (!fromServer) return;          // unconfirmed empty → ignore, keep what we have
        seedProductsIfNeverSetUp();
      }
      const list = snap.docs.map((d) => d.data()).filter(validProduct).map((p) => {
        const q = { ...p };
        if (!q.image && q.gallery && q.gallery.length) q.image = q.gallery[0];
        if (Number(q.stock) < 0) q.stock = 0;
        return q;
      });
      loaded.catalog = true;
      write(KEYS.catalog, list);
      emit("catalog");
    }, onErr("Catalog"));

    fsdb.doc("melvra/coupons").onSnapshot((doc) => {
      if (!doc.exists) {
        if (!doc.metadata.fromCache && !seeded.coupons) { seeded.coupons = true; cloudSet("melvra/coupons", { list: DEFAULT_COUPONS }); }
        return;
      }
      write(KEYS.coupons, doc.data().list || []);
      emit("coupons");
    }, onErr("Coupon"));

    fsdb.doc("melvra/settings").onSnapshot((doc) => {
      if (!doc.exists) {
        if (!doc.metadata.fromCache && !seeded.settings) { seeded.settings = true; cloudSet("melvra/settings", DEFAULT_SETTINGS); }
        return;
      }
      write(KEYS.settings, doc.data() || {});
      emit("settings");
    }, onErr("Settings"));

    fsdb.doc("melvra/categories").onSnapshot((doc) => {
      if (!doc.exists) {
        if (!doc.metadata.fromCache && !seeded.categories) {
          seeded.categories = true;
          const derived = deriveCategoryOrder();
          if (derived.length) cloudSet("melvra/categories", { list: derived });
        }
        return;
      }
      write(KEYS.categories, doc.data().list || []);
      emit("categories");
    }, onErr("Category"));

    fsdb.doc("melvra/announcements").onSnapshot((doc) => {
      if (!doc.exists) {
        if (!doc.metadata.fromCache && !seeded.notes) { seeded.notes = true; cloudSet("melvra/announcements", { list: [] }); }
        return;
      }
      write(KEYS.notes, doc.data().list || []);
      emit("announcements");
    }, onErr("Announcement"));

    // Reviews: one Firestore document per customer review, shared and
    // synced everywhere just like products. No seeding — starts empty.
    fsdb.collection("reviews").onSnapshot((snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => reviewTime(b) - reviewTime(a));
      write(KEYS.reviews, list);
      emit("reviews");
    }, onErr("Reviews"));

    if (opts.admin) {
      fsdb.collection("orders").onSnapshot((snap) => {
        const list = snap.docs.map((d) => d.data()).filter((o) => o && o.id).sort((a, b) => orderTime(b) - orderTime(a));
        write(KEYS.orders, list);
        purgeExpiredDeliveries();
        emit("orders");
      }, onErr("Orders"));

      // Bills: a permanent, append-only record of every order ever placed.
      // Unlike the "orders" collection (which admin can clean up), nothing
      // ever removes a document from here.
      fsdb.collection("bills").onSnapshot((snap) => {
        const list = snap.docs.map((d) => d.data()).filter((o) => o && o.id).sort((a, b) => orderTime(b) - orderTime(a));
        write(KEYS.bills, list);
        emit("bills");
      }, onErr("Bills"));
    }
    return true;
  }

  // Shop side: a logged-in customer only ever downloads THEIR OWN orders.
  let myOrdersWatching = "";
  function watchMyOrders(username, onChange) {
    if (!fsdb || !username || myOrdersWatching === username) return;
    myOrdersWatching = username;
    fsdb.collection("orders").where("user", "==", username).onSnapshot((snap) => {
      const cloud = snap.docs.map((d) => d.data()).filter((o) => o && o.id);
      const byId = {};
      read(KEYS.myOrders, []).forEach((o) => { byId[o.id] = o; });
      cloud.forEach((o) => { byId[o.id] = o; });
      write(KEYS.myOrders, Object.values(byId).sort((a, b) => orderTime(b) - orderTime(a)));
      try { onChange && onChange(); } catch (e) { console.error(e); }
    }, (e) => console.error("My orders sync error:", e));
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
    device: "melvra.device",
    myOrders: "melvra.myorders"
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

  // In-memory copy of everything we read/write. Two reasons:
  //  1) speed — the old code re-parsed the whole catalog (with photos, often
  //     several MB) from localStorage on EVERY lookup;
  //  2) safety — browsers cap localStorage at ~5 MB. When photos pushed the
  //     catalog past that, localStorage.setItem THREW, which aborted saves,
  //     aborted payment→order creation, and left stale/missing products.
  //     Now a full localStorage never breaks anything; memory stays correct.
  const mem = {};
  function read(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(mem, key)) return mem[key];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      mem[key] = val;
      return val;
    } catch {
      return fallback;
    }
  }
  function write(key, val) {
    mem[key] = val;
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn("Browser storage is full/blocked for " + key + " — kept in memory for this visit.");
      return false;
    }
  }
  // Another tab changed localStorage → forget our cached copy of that key.
  try {
    global.addEventListener("storage", (e) => { if (e.key) delete mem[e.key]; });
  } catch (e) { /* ignore */ }

  function catalog() {
    const saved = read(KEYS.catalog, null);
    if (Array.isArray(saved)) return saved;
    // Nothing saved on this device yet. With cloud sync on, wait for the real
    // catalog instead of flashing (and letting people buy) the demo pieces.
    if (cloudReady) return [];
    return DEFAULT_PRODUCTS.map((p) => ({ ...p }));
  }
  function saveCatalog(list) { write(KEYS.catalog, list); }
  function liveProducts() {
    return catalog().filter((p) => p.visible !== false);
  }
  function findProduct(id) {
    return catalog().find((p) => p.id === id);
  }
  // Returns a Promise<{ok, message?}>. Nothing is changed anywhere if the
  // product is too big for Firebase.
  function upsertProduct(prod) {
    const list = catalog().slice();
    const i = list.findIndex((p) => p.id === prod.id);
    const before = i >= 0 ? list[i] : null;
    const merged = i >= 0 ? { ...list[i], ...prod } : prod;
    const saved = sanitize(merged);
    // The cover photo is the first gallery photo. Storing it twice doubled the
    // size of every product, so the cloud copy keeps it only once (it is put
    // back automatically when products are loaded).
    const cloudDoc = { ...saved };
    if (cloudDoc.gallery && cloudDoc.gallery.length && cloudDoc.image === cloudDoc.gallery[0]) delete cloudDoc.image;
    const bytes = docBytes(cloudDoc);
    if (bytes > MAX_DOC_BYTES) {
      return Promise.resolve({
        ok: false,
        message: "This product is too heavy (" + Math.round(bytes / 1024) + " KB, limit ≈ " + Math.round(MAX_DOC_BYTES / 1024) + " KB). Remove a photo or two and save again."
      });
    }
    if (i >= 0) list[i] = saved; else list.push(saved);
    saveCatalog(list);
    if (saved.category) ensureCategory(saved.category);
    markProductsSetUp();
    return cloudSetDoc("products", saved.id, cloudDoc).then((r) => {
      // Firebase refused it → undo the local change too, so the product does
      // not sit on this device only and look "saved" when it is not.
      if (!r.ok) saveCatalog(before ? catalog().map((p) => (p.id === saved.id ? before : p)) : catalog().filter((p) => p.id !== saved.id));
      return r;
    });
  }
  function deleteProduct(id) {
    saveCatalog(catalog().filter((p) => p.id !== id));
    markProductsSetUp();
    return cloudDeleteDoc("products", id);
  }
  // Atomic on the server (increment), so two customers buying the same piece
  // at the same moment can no longer overwrite each other's stock change.
  function adjustStock(id, delta) {
    saveCatalog(catalog().map((p) => (p.id === id ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) + delta) } : p)));
    if (!fsdb) return Promise.resolve(RES_OK);
    return cloudUpdateDoc("products", id, { stock: global.firebase.firestore.FieldValue.increment(delta) });
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
    return cloudSet("melvra/categories", { list });
  }
  function ensureCategory(name) {
    if (!name) return;
    const list = categoryOrder().slice();
    if (!list.includes(name)) {
      list.unshift(name);
      saveCategoryOrder(list);
    }
  }
  function moveCategory(name, dir) {
    const list = categoryOrder().slice();
    const i = list.indexOf(name);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    return saveCategoryOrder(list);
  }
  function removeCategory(name) {
    return saveCategoryOrder(categoryOrder().filter((c) => c !== name));
  }

  function coupons() { return read(KEYS.coupons, DEFAULT_COUPONS.map((c) => ({ ...c }))); }
  function saveCoupons(list) { write(KEYS.coupons, list); }
  function upsertCoupon(c) {
    const list = coupons().slice();
    const i = list.findIndex((x) => x.id === c.id || x.code === c.code);
    if (i >= 0) list[i] = { ...list[i], ...c };
    else list.push(c);
    saveCoupons(list);
    return cloudSet("melvra/coupons", { list });
  }
  function deleteCoupon(id) {
    const list = coupons().filter((c) => c.id !== id);
    saveCoupons(list);
    return cloudSet("melvra/coupons", { list });
  }

  function applyCoupon(code, subtotal) {
    if (!code) return { ok: false, reason: "Enter a code" };
    const c = coupons().find((x) => String(x.code).toUpperCase() === String(code).trim().toUpperCase());
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
    const list = coupons().map((x) => ({ ...x }));
    const c = list.find((x) => String(x.code).toUpperCase() === String(code).toUpperCase());
    if (!c) return Promise.resolve(RES_OK);
    c.used = (c.used || 0) + 1;
    saveCoupons(list);
    return cloudSet("melvra/coupons", { list });
  }

  /* ---------------------------------------------------------------
     ORDERS (active/working list, shown in Studio → Orders) and
     BILLS (permanent record of every order ever placed, shown in
     Studio → Bills; never auto-deleted).
  --------------------------------------------------------------- */
  function orders() {
    return read(KEYS.orders, []).slice().sort((a, b) => orderTime(b) - orderTime(a));
  }
  function myOrders() {
    return read(KEYS.myOrders, []).slice().sort((a, b) => orderTime(b) - orderTime(a));
  }
  // Orders that were paid but could not be confirmed as saved online yet
  // (browser closed, network dropped right after paying, …). They are
  // re-sent automatically the next time the shop opens.
  const PENDING_KEY = "melvra.pendingOrders";
  function queueOrder(order) {
    const q = read(PENDING_KEY, []).slice();
    if (!q.some((o) => o.id === order.id)) { q.push(sanitize(order)); write(PENDING_KEY, q); }
  }
  function dequeueOrder(id) {
    write(PENDING_KEY, read(PENDING_KEY, []).filter((o) => o.id !== id));
  }
  function flushPendingOrders() {
    read(PENDING_KEY, []).slice().forEach((o) => {
      addOrder(o).then((r) => { if (r && r.ok) dequeueOrder(o.id); });
    });
  }
  // Writes the order and its permanent bill in ONE atomic batch: either both
  // exist or neither does. Returns Promise<{ok, message?}>.
  function addOrder(order) {
    const safe = sanitize(order) || {};
    const has = (l) => l.some((o) => o.id === safe.id);
    const mine = read(KEYS.myOrders, []).slice();
    if (!has(mine)) { mine.unshift(safe); write(KEYS.myOrders, mine); }
    if (!fsdb) {
      // Local-only mode (no Firebase): keep the working list + bills here.
      const list = orders();
      if (!has(list)) { list.unshift(safe); write(KEYS.orders, list); }
      const billList = bills();
      if (!has(billList)) { billList.unshift(safe); write(KEYS.bills, billList); }
      return Promise.resolve(RES_OK);
    }
    const batch = fsdb.batch();
    batch.set(fsdb.collection("orders").doc(String(safe.id)), safe);
    batch.set(fsdb.collection("bills").doc(String(safe.id)), safe);
    return guard(batch.commit(), "order " + safe.id);
  }
  function updateOrder(id, patch) {
    const next = { ...patch };
    if (patch.status === "Delivered") next.deliveredAt = new Date().toISOString();
    write(KEYS.orders, orders().map((o) => (o.id === id ? { ...o, ...next } : o)));
    // Keep the permanent bill record's status in sync too, without ever
    // removing the bill itself.
    write(KEYS.bills, bills().map((o) => (o.id === id ? { ...o, ...next } : o)));
    if (!fsdb) return Promise.resolve(RES_OK);
    const clean = sanitize(next);
    return Promise.all([
      cloudUpdateDoc("orders", id, clean),
      cloudUpdateDoc("bills", id, clean)
    ]).then((rs) => rs.find((r) => !r.ok) || RES_OK);
  }
  function deleteOrder(id) {
    write(KEYS.orders, orders().filter((o) => o.id !== id));
    // Bills are untouched on purpose — this only clears the working queue.
    return cloudDeleteDoc("orders", id);
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
    return cloudSet("melvra/settings", next);
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
    return cloudSet("melvra/announcements", { list });
  }
  function deleteAnnouncement(id) {
    const list = announcements().filter((a) => a.id !== id);
    saveAnnouncements(list);
    return cloudSet("melvra/announcements", { list });
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
    return cloudSetDoc("reviews", review.id, review);
  }
  function deleteReview(id) {
    write(KEYS.reviews, reviews().filter((r) => r.id !== id));
    return cloudDeleteDoc("reviews", id);
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

  // Wipes the catalog/coupons/settings back to the starter set. Bills (the
  // permanent record) and customer orders are never touched.
  function resetDemo() {
    localStorage.removeItem(KEYS.catalog);
    localStorage.removeItem(KEYS.coupons);
    localStorage.removeItem(KEYS.settings);
    localStorage.removeItem(KEYS.notes);
    localStorage.removeItem(KEYS.categories);
    [KEYS.catalog, KEYS.coupons, KEYS.settings, KEYS.notes, KEYS.categories].forEach((k) => { delete mem[k]; });

    if (!fsdb) return Promise.resolve(RES_OK);
    const defaultCats = [];
    DEFAULT_PRODUCTS.forEach((p) => { if (!defaultCats.includes(p.category)) defaultCats.push(p.category); });
    return fsdb.collection("products").get().then((snap) => {
      const batch = fsdb.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      DEFAULT_PRODUCTS.forEach((p) => batch.set(fsdb.collection("products").doc(String(p.id)), sanitize(p)));
      batch.set(fsdb.doc("melvra/meta"), { productsSeeded: true }, { merge: true });
      return batch.commit();
    }).then(() => Promise.all([
      cloudSet("melvra/coupons", { list: DEFAULT_COUPONS }),
      cloudSet("melvra/settings", DEFAULT_SETTINGS),
      cloudSet("melvra/announcements", { list: [] }),
      cloudSet("melvra/categories", { list: defaultCats })
    ])).then(() => RES_OK).catch((e) => {
      console.error("Reset failed:", e);
      return { ok: false, message: friendlyError(e) };
    });
  }

  global.MELVRA = {
    KEYS, DEFAULT_USER, DEFAULT_PRODUCTS,
    catalog, saveCatalog, liveProducts, findProduct, upsertProduct, deleteProduct, adjustStock, catalogLoaded, docBytes, MAX_DOC_BYTES,
    categoryOrder, saveCategoryOrder, ensureCategory, moveCategory, removeCategory,
    coupons, saveCoupons, upsertCoupon, deleteCoupon, applyCoupon, markCouponUsed,
    orders, myOrders, addOrder, updateOrder, deleteOrder, purgeExpiredDeliveries, bills,
    queueOrder, dequeueOrder, flushPendingOrders,
    DELIVERED_RETENTION_DAYS,
    settings, saveSettings,
    checkLogin, setSession, hasSession, clearSession, setPassword,
    users, findUser, registerUser, loginCustomer, customerSession, clearCustomer,
    announcements, saveAnnouncements, liveAnnouncement, upsertAnnouncement, deleteAnnouncement,
    deviceId, reviews, reviewsForProduct, hasReviewed, addReview, deleteReview, productRating, overallRating,
    slug, resetDemo, sha256,
    startSync, watchMyOrders, isCloudReady: () => cloudReady, syncInfo: () => ({ ...syncInfo })
  };
})(window);
