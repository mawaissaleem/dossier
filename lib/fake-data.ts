// Pure fake-application generator (task 4.4): given a track's columns and a PRNG, returns rows of raw cell values.
// No DB or UI imports; scripts/seed-fake.ts writes the result. Values are raw input for parseCell (the app's own validation).
import type { CellScalar } from "./cells";
import type { ColumnType } from "./db/schema";
import { chance, pick, randInt, shuffle, type Rng } from "./prng";
import { isPriority } from "./priority";

export type FakeColumn = { id: number; name: string; type: ColumnType; isStatus: boolean; options: { id: number }[] };
// cells holds only non-blank values: a missing key is blank (FR-1.4).
export type FakeRow = { title: string; archived: boolean; cells: Record<number, CellScalar> };

export const DEFAULT_BASE = "2026-11-07"; // fixed, so the same seed gives the same data on any day
export const KNOWN_COMPANIES = ["Acme Robotics", "Globex Systems", "Initech Labs", "Umbrella Analytics", "Hooli Cloud"];
export const KNOWN_UNIVERSITIES = ["University of Northvale", "Westbrook Institute of Technology", "Lakeshore University"];

const ADJ = ["Blue", "Bright", "Copper", "Crimson", "Delta", "Ember", "Falcon", "Granite", "Harbor", "Iron", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Orbit", "Pine", "Quartz", "Raven", "Silver", "Tidal", "Umber", "Vertex", "Willow", "Zenith"];
const NOUN = ["Analytics", "Dynamics", "Foundry", "Health", "Labs", "Logistics", "Mobility", "Networks", "Robotics", "Software", "Systems", "Works", "Energy", "Security", "Media", "Payments"];
const ROLES = ["Backend Engineer", "Frontend Engineer", "Data Scientist", "Machine Learning Engineer", "DevOps Engineer", "Product Analyst", "Research Engineer", "Site Reliability Engineer", "Mobile Developer", "Security Engineer", "Data Engineer", "QA Engineer", "Solutions Architect", "Software Engineer"];
const CITIES = ["Berlin, Germany", "Amsterdam, Netherlands", "London, UK", "Zurich, Switzerland", "Remote", "Toronto, Canada", "Stockholm, Sweden", "Dublin, Ireland", "Munich, Germany", "Lisbon, Portugal", "Copenhagen, Denmark", "Hybrid, Paris"];
// The known universities' places are left out so a search for "Northvale" etc. finds exactly one row (AT-12).
const PLACES = ["Ridgemont", "Eastfield", "Stonebridge", "Ashford", "Kingsmere", "Redhill", "Oakhaven", "Fairmont", "Highgate", "Brightwater", "Cedarvale", "Dunmore", "Elmstead", "Foxmoor", "Glenrock", "Hollowell", "Ironwood", "Larkfield", "Millbrook", "Northgate", "Pinecrest", "Queensbury", "Rosewood", "Silverlake", "Thornbury", "Valemount", "Whitby", "Yarrow", "Ambergate", "Bramley", "Coldwater"];
const UNI_KINDS = ["University of", "Institute of Technology,", "State University,", "College of Science,"];
const PROGRAMS = ["PhD in Computer Science", "PhD in Machine Learning", "PhD in Robotics", "PhD in Data Science", "PhD in Statistics", "PhD in Human-Computer Interaction", "PhD in Bioinformatics", "PhD in Electrical Engineering"];
const SURNAMES = ["Adler", "Baptiste", "Chen", "Dasgupta", "Eriksen", "Fontaine", "Gupta", "Hartmann", "Ivanova", "Jansen", "Kovacs", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov"];
const TITLES = ["Prof.", "Dr."];
const FUNDING = ["Fully funded", "Stipend 2,400 EUR/month", "Scholarship, tuition waived", "Self-funded", "Research assistantship", "Unclear"];
const WORDS = ["pending", "recruiter", "referral", "remote", "relocation", "panel", "portfolio", "follow up", "deadline", "visa", "contract", "team", "stack", "interview", "feedback"];

const lc = (s: string) => s.trim().toLowerCase();
// Share of rows with a blank cell, per column name. Everything else uses DEFAULT_BLANK.
const DEFAULT_BLANK = 0.15;
const BLANK: Record<string, number> = { "follow-up date": 0.6, supervisor: 0.3, funding: 0.35, link: 0.2 };
const TITLE_COLS = ["company", "role", "university", "program"]; // never blank; the title is built from them

// Distinct-looking names in a seeded order, known searchable ones first (AT-12), then ADJ x NOUN (400 combos) or
// PLACES x UNI_KINDS (124 combos), cycling past that.
function companyPool(rng: Rng): string[] {
  const generated = ADJ.flatMap((a) => NOUN.map((n) => `${a} ${n}`)).filter((n) => !KNOWN_COMPANIES.includes(n));
  return [...KNOWN_COMPANIES, ...shuffle(rng, generated)];
}
function universityPool(rng: Rng): string[] {
  const generated = PLACES.flatMap((p) => UNI_KINDS.map((k) => (k.endsWith("of") ? `${k} ${p}` : `${p} ${k.replace(/,$/, "")}`)));
  return [...KNOWN_UNIVERSITIES, ...shuffle(rng, generated)];
}

const addDays = (base: string, days: number) => new Date(Date.parse(`${base}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Generates `count` rows for one track. Coverage first: when the track has a status and a Priority single-select, row i takes the
// (i mod S*P)-th status x priority pair, so every combination appears once count >= S*P (the rest are random). Then ~5% archived.
export function generateApplications(cols: FakeColumn[], count: number, rng: Rng, base = DEFAULT_BASE): FakeRow[] {
  const companies = companyPool(rng);
  const universities = universityPool(rng);
  const status = cols.find((c) => c.isStatus && c.type === "single_select" && c.options.length);
  const prio = cols.find((c) => c !== status && isPriority(c) && c.options.length);
  const combos = status && prio ? status.options.flatMap((s) => prio.options.map((p) => [s.id, p.id] as const)) : [];
  const order = shuffle(rng, combos); // coverage in a seeded, not column, order

  const text = (c: FakeColumn, i: number): string => {
    switch (lc(c.name)) {
      case "company": return companies[i % companies.length];
      case "university": return universities[i % universities.length];
      case "role": return pick(rng, ROLES);
      case "program": return pick(rng, PROGRAMS);
      case "location": return pick(rng, CITIES);
      case "supervisor": return `${pick(rng, TITLES)} ${pick(rng, SURNAMES)}`;
      case "funding": return pick(rng, FUNDING);
      default: return `${pick(rng, WORDS)} ${pick(rng, WORDS)}`;
    }
  };
  const value = (c: FakeColumn, i: number): CellScalar => {
    switch (c.type) {
      case "text": return text(c, i);
      case "number": return randInt(rng, 100);
      case "checkbox": return chance(rng, 0.4);
      case "date": return addDays(base, randInt(rng, 366) - 183); // +-6 months
      case "link": return `https://example.com/${slug(c.name)}/${i + 1}-${randInt(rng, 9000) + 1000}`;
      case "single_select": return pick(rng, c.options).id;
    }
  };

  return Array.from({ length: count }, (_, i) => {
    const cells: Record<number, CellScalar> = {};
    for (const c of cols) {
      const forced = c === status || (c === prio && i < order.length) || TITLE_COLS.includes(lc(c.name));
      if (c.type === "single_select" && !c.options.length) continue; // nothing to choose
      if (!forced && chance(rng, BLANK[lc(c.name)] ?? DEFAULT_BLANK)) continue;
      cells[c.id] = value(c, i);
    }
    if (i < order.length) [cells[status!.id], cells[prio!.id]] = order[i];
    const named = cols.filter((c) => TITLE_COLS.includes(lc(c.name)) && typeof cells[c.id] === "string").map((c) => cells[c.id]);
    return { title: named.length ? named.join(" - ") : `Application ${i + 1}`, archived: chance(rng, 0.05), cells };
  });
}
