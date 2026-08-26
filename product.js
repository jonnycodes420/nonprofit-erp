// The product's own identity — one constant, baked into the code (never an env
// var, which can be misconfigured). It is surfaced on GET /health, and every
// write script (via scripts/lib/prodGuard.js) asserts /health.product against
// this value before writing a single row. This is the guard that "loopback is
// not identity" demands: a server answering on localhost may belong to a
// DIFFERENT product entirely (a near-miss that has happened), and a host/port
// check cannot tell them apart — only this identity can. This value MUST be
// unique to this product; never let it match another product's id.
module.exports = { PRODUCT_ID: "steward" };
