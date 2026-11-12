// scripts/ops/sales-staging-prospects.js · SALES-2. STAGING'S MADE-UP PROSPECT LIST.
//
// Called by sales-staging-seed.js after it has wiped the sales_ tables, so Muse can walk
// call mode: one list, "KY, OH and TN prospects (made-up)", of 40 organizations across
// Kentucky, Ohio and Tennessee, each with an executive director and a development director.
// Some have no phone at all (every 7th org), and some only a main line (every 5th), so the
// queue's skips and the fit line's misses show. Every name is invented; every domain is
// under example.org; every phone number is a 555-01xx number.
"use strict";

const ACTOR = ["system:staging-seed", "Staging seed (made-up sales CRM)"];
const PLACES = [["Louisville", "KY", "502"], ["Lexington", "KY", "859"], ["Bowling Green", "KY", "270"], ["Columbus", "OH", "614"], ["Dayton", "OH", "937"],
  ["Cincinnati", "OH", "513"], ["Akron", "OH", "330"], ["Nashville", "TN", "615"], ["Knoxville", "TN", "865"], ["Chattanooga", "TN", "423"]];
const WORDS = ["Ashgrove", "Bellwether", "Cairnfield", "Dovecote", "Emberly", "Foxglove", "Greystone", "Hollowell", "Ironwood", "Juniper", "Kestrel", "Lindenhall",
  "Millbrook", "Northwind", "Oakhaven", "Pinecrest", "Quillfeather", "Rosemead", "Stonebridge", "Thistledown"];
const KINDS = [["Youth Choir", "A6"], ["Food Pantry", "K31"], ["Literacy Project", "B92"], ["Arts Collective", "A20"]];
const FIRST = ["Adair", "Bettina", "Caspian", "Delphine", "Evander", "Fenella", "Gideon", "Honora", "Isidore", "Jessamy", "Lorcan", "Mireille", "Niall", "Odessa", "Perrin", "Rosalind"];
const LAST = ["Ainsley", "Blackwood", "Carrow", "Delacey", "Everard", "Fairweather", "Granger", "Holloway", "Inchley", "Jessop", "Kittering", "Loxley", "Merriweather", "Northcott", "Oakley", "Penhallow"];
const CRMS = ["none", "spreadsheet", "Bloomerang", "Little Green Light", null];

async function seedProspects(q, owner) {
  await q(`INSERT INTO sales_lists (id,name,config,created_by,created_by_name) VALUES ('sls_stg_prospects','KY, OH and TN prospects (made-up)','{"sort":{"key":"fit_met","dir":"desc"}}'::jsonb,$1,$2)`, ACTOR);
  for (let i = 0; i < 40; i++) {
    const [city, state, area] = PLACES[i % PLACES.length];
    const [kind, ntee] = KINDS[i % KINDS.length];
    const name = `${WORDS[i % WORDS.length]} ${kind}${i >= 20 ? " of " + city : ""}`;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    const noPhones = i % 7 === 3, mainOnly = i % 5 === 4;
    const revenue = [85000, 140000, 420000, 900000, 1600000, 2600000][i % 6];
    await q(`INSERT INTO sales_orgs (id,name,domain,website,phone,city,state,revenue,current_crm,nonprofit_type,ein,owner_id,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [`sor_stg_p${i}`, name, `${slug}.example.org`, `https://${slug}.example.org`, noPhones ? null : `${area}-555-01${String(i).padStart(2, "0")}`, city, state, revenue,
        CRMS[i % CRMS.length], ntee, `${60 + (i % 30)}-${5550100 + i}`, owner, ...ACTOR]);
    await q(`INSERT INTO sales_list_members (list_id,org_id,created_by,created_by_name) VALUES ('sls_stg_prospects',$1,$2,$3)`, [`sor_stg_p${i}`, ...ACTOR]);
    for (const [k, role, title] of [[0, "ED", "Executive Director"], [1, "Development Director", "Development Director"]]) {
      const first = FIRST[(i * 2 + k) % FIRST.length], last = LAST[(i + k * 5) % LAST.length];
      const phone = noPhones || mainOnly ? null : `${area}-555-01${String((i * 2 + k) % 100).padStart(2, "0")}`;
      const id = `sco_stg_p${i}_${k}`;
      await q(`INSERT INTO sales_contacts (id,first_name,last_name,title,emails,phones,role,owner_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)`,
        [id, first, last, title, JSON.stringify([`${first.toLowerCase()}@${slug}.example.org`]), JSON.stringify(phone && !(k === 1 && i % 3 === 0) ? [phone] : []), role, owner, ...ACTOR]);
      await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,is_primary,created_by,created_by_name) VALUES ($1,'contact',$2,'org',$3,true,$4,$5)`, [`sli_stg_p${i}_${k}`, id, `sor_stg_p${i}`, ...ACTOR]);
    }
  }
  return { list: "sls_stg_prospects", orgs: 40, contacts: 80 };
}

module.exports = { seedProspects };
