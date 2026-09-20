/* MELVRA — Razorpay connection
   ---------------------------------------------------
   Paste your Razorpay Key ID below (NOT the Key Secret — the secret
   must never go in a file that is uploaded to a website).

   Where to find it:
   Razorpay Dashboard → Settings → API Keys → Key ID
   Looks like: rzp_live_XXXXXXXXXXXXXX  (or rzp_test_... while testing)

   Until this is filled in, Checkout will show an alert asking the
   shop owner to add the key, instead of silently failing.
*/
window.MELVRA_RAZORPAY_CONFIG = {
  keyId: "PASTE_YOUR_RAZORPAY_KEY_ID_HERE",
  // Shown as the payment popup's business name / logo.
  businessName: "MELVRA",
  themeColor: "#2d2a26"
};
