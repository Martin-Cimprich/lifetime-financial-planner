/* Builds planner-uk.html and planner-cz.html from one source tree.
   The engine bundle is regenerated from the ES modules on every run — never
   read from a cached artifact, or fixes silently fail to ship. */
import { readFileSync, writeFileSync } from 'node:fs';

const strip = (p) => readFileSync(p, 'utf8')
  .replace(/^import[^;]*;\s*$/gm, '')    // module wiring is not needed inline
  .replace(/^export\s+/gm, '');

const bundle = [
  '/* ==== generated at build time from lifetables/engine/countries ==== */',
  strip('lifetables.mjs'),
  strip('engine.mjs'),
  strip('countries.mjs'),
].join('\n');

// Fail loudly if the bundle is not self-consistent, rather than shipping it.
for (const [name, re] of [
  ['engine', /class Household/], ['life tables', /UK_LIFE_TABLE/],
  ['countries', /const UK = \{/], ['CZ pension', /czAccrualRate/],
]) if (!re.test(bundle)) throw new Error(`bundle is missing ${name}`);

const tpl  = readFileSync('app-template.html', 'utf8');
const i18n = readFileSync('i18n.js', 'utf8');
const app  = readFileSync('app.js', 'utf8');

const META = {
  UK: { lang:'en', file:'planner-uk.html', title:'Lifetime Financial Planner — UK',
        desc:'How much you can afford to spend, and how to invest it. UK tax, National Insurance, State Pension and ONS life tables.' },
  CZ: { lang:'cs', file:'planner-cz.html', title:'Finanční plán na celý život — ČR',
        desc:'Kolik si můžete dovolit utrácet a jak investovat. České daně, pojistné, starobní důchod a úmrtnostní tabulky ČSÚ.' },
};
for (const cc of Object.keys(META)) {
  const m = META[cc];
  const out = tpl
    .replace('__TITLE__', m.title)
    .replace('__DESC__', m.desc)
    .replace('__BUILD__', JSON.stringify({ country: cc, lang: m.lang }))
    .replace('__BUNDLE__', () => bundle)
    .replace('__I18N__', () => i18n)
    .replace('__APP__', () => app);
  writeFileSync(m.file, out);
  console.log(`${m.file}  ${(out.length/1024).toFixed(0)} KB`);
}
