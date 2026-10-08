/** Opt-in held-out synthetic skill selection probe. Never sends private Craft notes. */
import { pickSkills } from "../../src/lib/skill-picker.ts";
const items = [
  { id: "invoice", name: "prepare-invoices", title: "Prepare invoices", description: "Use to convert billable work into monthly customer invoices, check rates, totals and billing records.", tags: ["finance", "billing"], status: "published" },
  { id: "release", name: "verify-release", title: "Verify release", description: "Use to verify package versions, release artifacts, installation and GitHub release notes.", tags: ["release", "software"], status: "published" },
  { id: "board", name: "tend-board", title: "Tend board", description: "Use to update a project tracking board, task ownership, status and progress evidence.", tags: ["tasks"], status: "published" },
];
const cases = [
  { request: "Prepare monthly customer invoices and verify billing totals", expected: ["invoice"] },
  { request: "Turn recorded billable hours into customer statements and check contract rates", expected: ["invoice"] },
  { request: "Подготовь счета клиентам за месяц и проверь суммы", expected: ["invoice"] },
  { request: "Verify the package installation and publish its release notes", expected: ["release"] },
  { request: "Prepare invoices then check the software release installation", expected: ["invoice", "release"] },
  { request: "Plan a mountain hike and identify edible plants", expected: [] },
];
const key = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
const results = [];
for (const c of cases) {
  const keyword = await pickSkills({ items, rejected: [] }, c.request, { maxOutput: 5 });
  const jev = key ? await pickSkills({ items, rejected: [] }, c.request, { maxOutput: 5, jev: true, key }) : undefined;
  const exact = (ids: string[]) => JSON.stringify(ids.sort()) === JSON.stringify([...c.expected].sort());
  results.push({ ...c, keywords: keyword.items.map(e => e.id), keywordExact: exact(keyword.items.map(e => e.id)), jev: jev?.items.map(e => e.id), jevExact: jev && exact(jev.items.map(e => e.id)), scores: jev?.items.map(e => ({ id: e.id, score: e.score })) });
}
console.log(JSON.stringify({ model: "jev-1.13.0", threshold: 0.55, synthetic: true, frozenBeforeRun: true, results }, null, 2));
