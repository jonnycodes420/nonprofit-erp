// shared/stockPhotos.js · EDITOR-1. THERE IS ALWAYS A PHOTO.
//
// Pure: no DB, no network, no file reads. The server, the browser and the
// tests read the same catalog.
//
// About forty photos bundled with Steward (assets/stock/<group>/<slug>.jpg),
// grouped by what an organization does. A new giving page, a new event page
// and a new photo block start with one of them, chosen from the org's mission
// words and website, so nothing opens on an empty box. Every photo is under
// the Unsplash License (commercial use, no attribution required) and has its
// row, photographer and source in assets/stock/LICENSES.md; the check in
// tests/lib/stockPhotosCheck.js holds the folder and that file together.
//
// A stock photo becomes the org's own portal asset the first time it is used
// (POST /stock-photos/:id/use stores the bundled bytes through assetStore,
// content-addressed, so a second use is the same asset). Its picture meta
// carries `stock: true` until somebody replaces it, which is how the editor
// knows to say "Stock photo · Replace with yours".

export const STOCK_LICENSES = ["Unsplash License", "Pexels License"];

// The groups, in the order they win a tie (the more particular first), each
// with the words that point to it. A word matches at the start of a word in
// the mission ("therap" matches "therapeutic"); in a website's host name it
// matches anywhere, because a domain runs its words together.
export const GROUPS = [
  { key: "animals",   label: "Animals and horses", words: ["animal", "horse", "equine", "equestrian", "riding", "pony", "ponies", "dog", "cat", "pet", "wildlife", "humane", "spca", "veterinar", "canine", "feline", "livestock", "sanctuary", "rescue"] },
  { key: "food",      label: "Food and hunger",    words: ["food", "hunger", "hungry", "meal", "pantry", "pantries", "soup kitchen", "nutrition", "feeding", "grocer", "harvest"] },
  { key: "faith",     label: "Faith",              words: ["church", "faith", "ministry", "ministries", "parish", "congregation", "gospel", "christ", "god", "worship", "synagogue", "temple", "mosque", "jewish", "catholic", "lutheran", "methodist", "baptist", "presbyterian", "episcopal", "interfaith", "spiritual", "prayer", "diocese"] },
  { key: "health",    label: "Health",             words: ["health", "medical", "medicine", "clinic", "hospital", "disease", "cancer", "patient", "nurse", "nursing", "mental", "therap", "wellness", "hospice", "recovery", "addiction", "dental"] },
  { key: "arts",      label: "Arts",               words: ["art", "music", "theater", "theatre", "dance", "museum", "gallery", "paint", "creative", "choir", "orchestra", "symphony", "film", "poetry", "opera"] },
  { key: "kids",      label: "Kids and youth",     words: ["kid", "child", "youth", "teen", "young people", "student", "school", "mentor", "after-school", "afterschool", "camp", "scout", "boys", "girls"] },
  { key: "outdoors",  label: "Outdoors",           words: ["outdoor", "nature", "park", "trail", "land trust", "conservation", "conservancy", "environment", "forest", "river", "watershed", "garden", "climate", "wilderness", "open space", "preserve", "wetland"] },
  { key: "community", label: "Community",          words: ["community", "neighbor", "neighbour", "volunteer", "civic", "housing", "homeless", "shelter", "immigrant", "refugee", "senior"] },
];
export const FALLBACK_GROUP = "community";
export const GROUP_KEYS = GROUPS.map(g => g.key);

// The catalog. `id` is "<group>-<slug>", `file` is under assets/stock/.
export const STOCK_PHOTOS = [
  { id: "animals-horses-meadow-mountains", file: "animals/horses-meadow-mountains.jpg", group: "animals", alt: "Horses grazing in a wide meadow below mountains", photographer: "Holly Mandarich", source: "https://unsplash.com/photos/group-of-horses-standing-on-field-kCpCd6oQTCw", license: "Unsplash License" },
  { id: "animals-three-horses-field", file: "animals/three-horses-field.jpg", group: "animals", alt: "Three horses meeting in an open field", photographer: "Annika Treial", source: "https://unsplash.com/photos/three-horses-on-green-ground-e4WUwbcur7Y", license: "Unsplash License" },
  { id: "animals-white-horse-running", file: "animals/white-horse-running.jpg", group: "animals", alt: "A white horse running along the edge of a wood", photographer: "Helena Lopes", source: "https://unsplash.com/photos/running-white-horse-lIeqGEdvex0", license: "Unsplash License" },
  { id: "animals-dog-on-grass", file: "animals/dog-on-grass.jpg", group: "animals", alt: "A tan dog sitting on the grass, looking up", photographer: "Olga Nayda", source: "https://unsplash.com/photos/f6v_Q0WXEK8", license: "Unsplash License" },
  { id: "animals-horses-at-dawn", file: "animals/horses-at-dawn.jpg", group: "animals", alt: "Horses in a misty field at sunrise", photographer: "Janko Ferlič", source: "https://unsplash.com/photos/silhouette-of-horses-on-field-during-sunset--pP8Yy3ARaU", license: "Unsplash License" },
  { id: "kids-balloon-in-the-park", file: "kids/balloon-in-the-park.jpg", group: "kids", alt: "Two children chasing a red balloon on the grass", photographer: "Alaric Sim", source: "https://unsplash.com/photos/two-girls-playing-balloon-0N4UJja6jEU", license: "Unsplash License" },
  { id: "kids-rope-swing", file: "kids/rope-swing.jpg", group: "kids", alt: "A child on a rope swing in the woods", photographer: "Annie Spratt", source: "https://unsplash.com/photos/boy-holding-on-swing-bench-fBrGckWLQ0Q", license: "Unsplash License" },
  { id: "kids-running-in-spring", file: "kids/running-in-spring.jpg", group: "kids", alt: "A child running through a sunny field", photographer: "Stephen Andrews", source: "https://unsplash.com/photos/a-young-girl-is-running-in-the-grass-GthU0larYtA", license: "Unsplash License" },
  { id: "kids-hammock-in-the-woods", file: "kids/hammock-in-the-woods.jpg", group: "kids", alt: "Children playing in a rope hammock in the woods", photographer: "Alexandr Podvalny", source: "https://unsplash.com/photos/a-group-of-kids-sitting-in-a-hammock-in-the-woods-bh476ojZw2g", license: "Unsplash License" },
  { id: "kids-friends-in-tall-grass", file: "kids/friends-in-tall-grass.jpg", group: "kids", alt: "Three young children together in tall grass", photographer: "Laura Ohlman", source: "https://unsplash.com/photos/three-children-are-sitting-in-a-field-of-tall-grass-sW6TRpgZLMw", license: "Unsplash License" },
  { id: "food-tomatoes-shared", file: "food/tomatoes-shared.jpg", group: "food", alt: "One pair of hands passing a bowl of tomatoes to another", photographer: "Elaine Casap", source: "https://unsplash.com/photos/bowl-of-tomatoes-served-on-person-hand-qgHGDbbSNm8", license: "Unsplash License" },
  { id: "food-fresh-vegetables", file: "food/fresh-vegetables.jpg", group: "food", alt: "Baskets of carrots, cucumbers and peppers", photographer: "Megan Thomas", source: "https://unsplash.com/photos/bundle-of-assorted-vegetable-lot-xMh_ww8HN_Q", license: "Unsplash License" },
  { id: "food-sorting-donations", file: "food/sorting-donations.jpg", group: "food", alt: "Volunteers sorting donated food", photographer: "Joel Muniz", source: "https://unsplash.com/photos/volunteers-sorting-canned-food-donations-3k3l2brxmwQ", license: "Unsplash License" },
  { id: "food-packing-grocery-bags", file: "food/packing-grocery-bags.jpg", group: "food", alt: "Volunteers packing grocery bags under a canopy", photographer: "Ismael Paramo", source: "https://unsplash.com/photos/women-packing-food-bags-at-distribution-Cns0h4ypRyA", license: "Unsplash License" },
  { id: "food-bags-ready", file: "food/bags-ready.jpg", group: "food", alt: "Rows of filled paper grocery bags ready to go out", photographer: "Claudia Raya", source: "https://unsplash.com/photos/a-large-amount-of-brown-paper-bags-1VOx-Ffbd9w", license: "Unsplash License" },
  { id: "faith-sunday-service", file: "faith/sunday-service.jpg", group: "faith", alt: "A congregation gathered in a stone church", photographer: "Josh Applegate", source: "https://unsplash.com/photos/people-sitting-on-chair-in-church-ToKSfdmznKg", license: "Unsplash License" },
  { id: "faith-white-nave", file: "faith/white-nave.jpg", group: "faith", alt: "The long white nave of a church", photographer: "Justin Main", source: "https://unsplash.com/photos/cathedral-interior-UEesKwR8ccY", license: "Unsplash License" },
  { id: "faith-stained-glass-light", file: "faith/stained-glass-light.jpg", group: "faith", alt: "Light through stained glass windows", photographer: "Daniel McCullough", source: "https://unsplash.com/photos/stained-glass-installed-in-wall-yJj-x3bBSao", license: "Unsplash License" },
  { id: "faith-wooden-chapel", file: "faith/wooden-chapel.jpg", group: "faith", alt: "Wooden pews under a timber roof", photographer: "Debby Hudson", source: "https://unsplash.com/photos/cathedral-interior-sgdyBq6kheQ", license: "Unsplash License" },
  { id: "faith-quiet-pews", file: "faith/quiet-pews.jpg", group: "faith", alt: "Empty pews in a quiet church", photographer: "Mateus Campos Felipe", source: "https://unsplash.com/photos/wooden-church-pews-in-church-go_b8XV21f0", license: "Unsplash License" },
  { id: "arts-first-painting", file: "arts/first-painting.jpg", group: "arts", alt: "A child painting at an easel", photographer: "Mike Fox", source: "https://unsplash.com/photos/Ym301WfcEkE", license: "Unsplash License" },
  { id: "arts-brushes-and-color", file: "arts/brushes-and-color.jpg", group: "arts", alt: "Paintbrushes and bright paint on canvas", photographer: "Anna Kolosyuk", source: "https://unsplash.com/photos/D5nh6mCW52c", license: "Unsplash License" },
  { id: "arts-painting-outdoors", file: "arts/painting-outdoors.jpg", group: "arts", alt: "A painter at work on a landscape", photographer: "Jade Stephens", source: "https://unsplash.com/photos/WhVO1xKiDVw", license: "Unsplash License" },
  { id: "arts-palette", file: "arts/palette.jpg", group: "arts", alt: "A paint palette with brushes", photographer: "Andres Perez", source: "https://unsplash.com/photos/se0GXEsgtPk", license: "Unsplash License" },
  { id: "arts-art-table", file: "arts/art-table.jpg", group: "arts", alt: "A table covered in paintings and art supplies", photographer: "Liana S", source: "https://unsplash.com/photos/2lAF0SmCEKM", license: "Unsplash License" },
  { id: "health-nurse-on-the-ward", file: "health/nurse-on-the-ward.jpg", group: "health", alt: "A nurse with a stethoscope on a hospital ward", photographer: "JESHOOTS.COM", source: "https://unsplash.com/photos/l0j0DHVWcIE", license: "Unsplash License" },
  { id: "health-heart-stethoscope", file: "health/heart-stethoscope.jpg", group: "health", alt: "A stethoscope held in the shape of a heart", photographer: "Patty Brito", source: "https://unsplash.com/photos/Y-3Dt0us7e0", license: "Unsplash License" },
  { id: "health-checkup", file: "health/checkup.jpg", group: "health", alt: "A health worker checking a woman's blood pressure", photographer: "CDC", source: "https://unsplash.com/photos/Y2lUjUiay-o", license: "Unsplash License" },
  { id: "health-care-team", file: "health/care-team.jpg", group: "health", alt: "Two clinicians in scrubs and a white coat", photographer: "Nappy", source: "https://unsplash.com/photos/vkqr2zpOPhQ", license: "Unsplash License" },
  { id: "health-scrubs-and-stethoscope", file: "health/scrubs-and-stethoscope.jpg", group: "health", alt: "A clinician in blue scrubs with a stethoscope", photographer: "Nappy", source: "https://unsplash.com/photos/6LV3V1gLrP8", license: "Unsplash License" },
  { id: "community-painting-together", file: "community/painting-together.jpg", group: "community", alt: "A volunteer painting a wall, smiling", photographer: "Amélie Aronson", source: "https://unsplash.com/photos/sh-pZunoprQ", license: "Unsplash License" },
  { id: "community-volunteer-sign-in", file: "community/volunteer-sign-in.jpg", group: "community", alt: "Volunteers checking a clipboard during a cleanup", photographer: "Vitaly Gariev", source: "https://unsplash.com/photos/x2j6lj09DhM", license: "Unsplash License" },
  { id: "community-forest-cleanup", file: "community/forest-cleanup.jpg", group: "community", alt: "Volunteers picking up litter in a forest", photographer: "Vitaly Gariev", source: "https://unsplash.com/photos/3V7uOi0XzoU", license: "Unsplash License" },
  { id: "community-park-cleanup", file: "community/park-cleanup.jpg", group: "community", alt: "Volunteers cleaning a park with blue bags", photographer: "Vitaly Gariev", source: "https://unsplash.com/photos/U20gjfPjtuI", license: "Unsplash License" },
  { id: "community-volunteer-tent", file: "community/volunteer-tent.jpg", group: "community", alt: "Volunteers organizing supplies under a tent", photographer: "Hayes", source: "https://unsplash.com/photos/StrmusT8d9Y", license: "Unsplash License" },
  { id: "outdoors-misty-forest-light", file: "outdoors/misty-forest-light.jpg", group: "outdoors", alt: "Sun rays through a misty forest", photographer: "Dale Nibbe", source: "https://unsplash.com/photos/6mU7uCAO64I", license: "Unsplash License" },
  { id: "outdoors-pine-trail", file: "outdoors/pine-trail.jpg", group: "outdoors", alt: "A dirt path through green undergrowth and pines", photographer: "Maksim Shutov", source: "https://unsplash.com/photos/H8vhhepiiaU", license: "Unsplash License" },
  { id: "outdoors-green-woods", file: "outdoors/green-woods.jpg", group: "outdoors", alt: "Sunlight in a green woodland", photographer: "Michael Krahn", source: "https://unsplash.com/photos/5G2G59V6IXg", license: "Unsplash License" },
  { id: "outdoors-shaded-path", file: "outdoors/shaded-path.jpg", group: "outdoors", alt: "A path between green trees", photographer: "Tim Mossholder", source: "https://unsplash.com/photos/9UjEyzA6pP4", license: "Unsplash License" },
  { id: "outdoors-red-earth-trail", file: "outdoors/red-earth-trail.jpg", group: "outdoors", alt: "A trail through tall pines", photographer: "Grant Durr", source: "https://unsplash.com/photos/vY62Ee_LpdQ", license: "Unsplash License" },
];

const BY_ID = new Map(STOCK_PHOTOS.map(p => [p.id, p]));
export const stockById = id => BY_ID.get(String(id || "")) || null;
export const groupLabel = key => (GROUPS.find(g => g.key === key) || {}).label || "";
// The thumbnail the picker shows, under assets/stock/thumbs/.
export const thumbFile = p => "thumbs/" + p.file;

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// How many of a group's words the text has. Mission words match from the
// start of a word; a host name's letters match anywhere.
function score(group, mission, host) {
  let n = 0;
  for (const w of group.words) {
    if (mission && new RegExp("(^|[^a-z])" + escRe(w), "i").test(mission)) n++;
    else if (host && w.length >= 4 && !w.includes(" ") && host.includes(w)) n++;
  }
  return n;
}

// THE GROUP FOR AN ORG. The group with the most matching words wins; a tie
// goes to the group listed first in GROUPS (the more particular one), so
// "therapeutic riding for kids with disabilities" is Animals and horses
// (riding, therap, kids each score once, and Animals comes first). Nothing
// matching is Community.
export function missionGroup(mission, website) {
  const m = String(mission || "").toLowerCase();
  let host = "";
  try { host = website ? new URL(/^https?:\/\//i.test(website) ? website : "https://" + website).hostname.toLowerCase().replace(/^www\./, "").replace(/\.[a-z]+$/, "") : ""; }
  catch { host = ""; }
  let best = null, bestN = 0;
  for (const g of GROUPS) {
    const n = score(g, m, host);
    if (n > bestN) { best = g.key; bestN = n; }
  }
  return best || FALLBACK_GROUP;
}

// The first n photos of a group, falling back to Community for a group it
// does not know.
export function stockFor(group, n = 5) {
  const g = GROUP_KEYS.includes(group) ? group : FALLBACK_GROUP;
  return STOCK_PHOTOS.filter(p => p.group === g).slice(0, Math.max(0, n));
}

// One photo of a group, steady for a given seed (a page id, a block's key),
// so two new pages of the same org do not open on the same picture but the
// same page always gets the same one.
export function pickStock(group, seed = "") {
  const list = stockFor(group, 99);
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// EMAIL-1 photo blocks: the stock photo a NEW photo block starts with, for an
// org whose mission and website are known. The editor stores it through
// POST /stock-photos/:id/use and sets the block's image and alt to what that
// answers.
export function stockForNewBlock({ mission, website, seed } = {}) {
  return pickStock(missionGroup(mission, website), seed || "");
}
