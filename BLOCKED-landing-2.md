# BLOCKED · LANDING-2 · the part of the demo form that needs app code

Everything else in LANDING-2 shipped. This is the one piece that would need a
server change, which the brief rules out for this build.

**What works today, with no app code.** `/demo` posts to the existing
`POST /lost-and-found/lead` with `ref: "book-a-demo"`. The request lands in
`lost_and_found_leads`, the table super-admin's Lost & Found view reads, and it
shows there with source `book-a-demo`. The route emails Jonathan only
(`FOUNDER_EMAIL`, reply-to set to the prospect); the prospect is never emailed.

**What needs app code (routes/billing.js):**

1. The form's two optional fields, *Active donors* (a band) and *Where are your
   donors today?*, are shown but not stored. The lead route picks exactly
   name, email, organization and ref out of the body by name and drops the rest,
   by design. Storing them needs two columns on `lost_and_found_leads` (or a
   demo-specific table) and two more named picks in the route.
2. The founder notification for every lead reads "They ran the audit and
   downloaded the report." For a `book-a-demo` lead that sentence is wrong. It
   should branch on `ref`.

Neither blocks shipping: Jonathan still gets name, email and organization for
every request, and the reply-to goes straight to the person.
