MELVRA — Handmade Cotton
========================

Shop: open index.html

Admin / Studio (private): open admin.html
This page is NOT linked from the shop.

Default keys
  Identity : studio
  Key      : Melvra#4410

Change the password from Studio → Settings after first login.

Admin can
- Add / edit / hide / delete products
- Set price, stock, category, description, image
- Create coupon codes (percent or flat)
- Pause or delete coupons
- See checkout orders and update status
- Set free-shipping threshold

Starter coupons
  WELCOME10   10% off, min ₹499
  MELVRA200   ₹200 off, min ₹999
  STUDIO50    ₹50 off, min ₹400

Data lives in the browser until you add a real server.

SHARED DATA ACROSS ALL DEVICES (Firebase setup)
================================================
By default the site still works exactly like before — each browser
keeps its own copy of the data. To make admin's changes (products,
prices, images, coupons, stock, orders, settings) visible to every
visitor on every device automatically, connect a free Firebase project:

1. Go to https://console.firebase.google.com and sign in with any
   Google account.
2. Click "Add project", give it any name (e.g. "melvra-shop"), finish
   the wizard (Google Analytics can be skipped/off).
3. In the left sidebar, open "Build → Firestore Database" → "Create
   database" → choose "Start in test mode" → pick any location →
   Enable.
   (Test mode is open for anyone to read/write, which is fine for a
   quick launch. Before going fully public/long-term, tighten the
   rules under Firestore → Rules — ask Claude if you want help with
   this later.)
4. In the left sidebar, click the gear icon → "Project settings".
   Under "Your apps", click the </> (Web) icon, register the app
   (any nickname), and it will show a code block with a config
   object like:
     const firebaseConfig = {
       apiKey: "...",
       authDomain: "...",
       projectId: "...",
       storageBucket: "...",
       messagingSenderId: "...",
       appId: "..."
     };
5. Open js/firebase-config.js in this folder and paste those exact
   values in place of the PASTE_... placeholders. Save the file.
6. Re-upload/deploy the site (or just refresh if testing locally).
   The very first time it loads with a real config, it will seed
   Firestore with the starting products, coupons, and settings —
   after that, every admin change syncs to every visitor's screen
   automatically, in real time, without anyone refreshing.

Note: this preview/export only works once the site is hosted
somewhere real (e.g. Netlify, GitHub Pages, your own server) — opening
index.html directly as a local file, or viewing it inside Claude's
artifact preview, will not load the Firebase scripts because of
browser/security restrictions in those environments.

WHAT'S NEW (this update)
=========================
- Orders now always sort newest-first, in the Studio and on the
  dashboard (a date-sorting bug was making them appear out of order).
- A Delivered order automatically disappears from Orders 10 days
  after being marked Delivered. Its full record is kept forever in
  the new Bills tab.
- New "Bills" section in the Studio sidebar: a permanent log of every
  order ever placed (who, what, when, coupon used, totals) — nothing
  here is ever auto-deleted.
- In Orders/Bills → Details: the email opens Gmail compose, the phone
  number opens the dialer, and the address has an "Open in Google
  Maps" link.
- Product editor's Category field now offers every category already
  in use, plus "+ Custom category…" to type a brand-new one.
- Fixed a glitch where deleting every product from the catalog would
  bring the original starter products back. Deleting all products now
  correctly leaves the catalog empty.
- The homepage now shows one section per category (a "Latest" or
  "Trending" section, for example) with a "See more" button once a
  category has more than 8 pieces. A brand-new category you create
  automatically appears as the top section; reorder sections anytime
  from Studio → Products → "Homepage sections".
