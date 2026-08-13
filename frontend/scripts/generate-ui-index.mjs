/**
 * Régénère `src/shared/ui/index.js` — l'API publique du kit UI.
 *
 * Pourquoi un script : la couche compte des dizaines de composants shadcn et
 * près de 300 exports. Tenir la liste à la main after chaque
 * `npx shadcn@latest add` est une source d'oublis silencieux (un composant
 * installé mais non exporté est invisible pour le reste de l'application).
 *
 * Usage : npm run ui:index
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UI_DIR = process.argv[2] ?? "src/shared/ui";
const MAX_LINE = 92;

const files = (await readdir(UI_DIR)).filter((file) => file.endsWith(".jsx")).sort();

const owners = new Map();
const exportsByFile = new Map();

for (const file of files) {
  const source = await readFile(join(UI_DIR, file), "utf8");
  const names = new Set();

  // export { A, B as C }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const alias = cleaned.includes(" as ") ? cleaned.split(" as ")[1] : cleaned;
      names.add(alias.trim());
    }
  }

  // export function X / export const X / export class X
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g,
  )) {
    names.add(match[1]);
  }

  exportsByFile.set(file, [...names].filter(Boolean).sort());
  for (const name of names) {
    owners.set(name, [...(owners.get(name) ?? []), file]);
  }
}

const lines = [
  "/**",
  " * API publique du kit UI — socle shadcn/ui (style new-york).",
  " *",
  " * FICHIER GÉNÉRÉ par `npm run ui:index` à partir des exports réels de chaque",
  " * composant. Ne pas éditer à la main : relancer le script après un",
  " * `npx shadcn@latest add <composant>`.",
  " */",
  "",
];

for (const file of files) {
  const names = exportsByFile.get(file);
  if (!names.length) continue;

  const slug = file.replace(/\.jsx$/, "");
  const oneLine = `export { ${names.join(", ")} } from "./${slug}";`;

  if (oneLine.length <= MAX_LINE) {
    lines.push(oneLine);
  } else {
    lines.push("export {");
    for (const name of names) lines.push(`  ${name},`);
    lines.push(`} from "./${slug}";`);
  }
}

await writeFile(join(UI_DIR, "index.js"), `${lines.join("\n")}\n`, "utf8");

const collisions = [...owners.entries()].filter(([, sources]) => sources.length > 1);

console.log(`${files.length} composants, ${owners.size} exports.`);
if (collisions.length) {
  console.error(
    `Collisions de noms (${collisions.length}) — le baril en écraserait certains :`,
  );
  for (const [name, sources] of collisions) {
    console.error(`  ${name} <- ${sources.join(", ")}`);
  }
  process.exit(1);
}
console.log("Aucune collision de nom.");
