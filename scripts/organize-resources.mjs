import { readdir, mkdir, rename, readFile, writeFile, mkdtemp, rm, copyFile, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const RESOURCE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.jpg', '.jpeg', '.zip', '.epub', '.xls', '.xlsx']);
const GENERAL_CATEGORY = 'General - Unclassified';
const SAMPLE_UNEB_CATEGORY = 'Sample UNEB Papers';
const CATALOG_FILENAME = 'resource-catalog.json';
const RAW_BASE_URL = 'https://raw.githubusercontent.com/trustjonathan/STUDT-HUB-RESOURCES-2026/main';

const MOCK_BODIES = [
  { label: 'WAKISSHA Joint Examinations Board', aliases: ['WAKISSHA', 'WAKISHA'] },
  { label: 'ACEITEKA', aliases: ['ACEITEKA', 'Association of Catholic Education Institutions'] },
  { label: 'JJEB', aliases: ['JJEB', 'Jinja Joint Examinations Board'] },
  { label: 'KAMSSA', aliases: ['KAMSSA', 'Kampala Metropolitan Secondary Schools Headteachers Association'] },
  { label: 'APEX Mock Board', aliases: ['APEX'] },
  { label: 'UTEC', aliases: ['UTEC', 'Uganda Secondary Schools Teachers Examination Committee'] },
  { label: 'Matigo Examinations Board', aliases: ['MATIGO'] },
  { label: 'NEREB', aliases: ['NEREB', 'National Education Research and Examinations Bureau'] },
  { label: 'UMTA Mock Board', aliases: ['UMTA', 'Uganda Muslim Teachers Association'] },
  { label: 'ASSHU Regional Boards', aliases: ['ASSHU', 'Association of Secondary School Headteachers of Uganda'] },
  { label: 'UITA', aliases: ['UITA', 'Uganda ICT Teachers Association'] },
  { label: 'UPTA', aliases: ['UPTA', 'Uganda Physics Teachers Association'] },
  { label: 'UAM', aliases: ['UAM', 'Uganda Association of Mathematics Teachers'] },
  { label: 'UBTA', aliases: ['UBTA', 'Uganda Biology Teachers Association'] },
  { label: 'UCTA', aliases: ['UCTA', 'Uganda Chemistry Teachers Association'] },
  { label: 'KASSEC - KASSHIPA', aliases: ['KASSEC', 'KASSHIPA'] },
  { label: 'Mukono District Joint Mock Examinations Board', aliases: ['Mukono District Joint Mock', 'Mukono'] },
  { label: 'Luweero District Secondary Schools Examinations Board', aliases: ['Luweero', 'Luwero'] },
  { label: 'Masaka Joint Mock Board', aliases: ['Masaka'] },
  { label: 'Mbarara Joint Secondary Schools Mock Board', aliases: ['Mbarara'] },
  { label: 'Gulu Regional Joint Examinations Board', aliases: ['Gulu'] },
  { label: 'Lango Secondary Schools Mock Examination Association', aliases: ['Lango'] },
  { label: 'Mbale City Joint Secondary Examinations Board', aliases: ['Mbale'] },
  { label: 'Bushenyi Secondary Schools Examinations Committee', aliases: ['Bushenyi'] },
  { label: 'Central Schools Academic Alliance (CSAA)', aliases: ['CSAA', 'Central Schools Academic Alliance'] },
  { label: 'USTAA Academic Board', aliases: ['USTAA'] },
  { label: 'WAKATA Mock Board', aliases: ['WAKATA'] },
].map((body) => ({
  ...body,
  folder: body.label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-'),
}));

const SUBJECT_RULES = [
  { label: 'Mathematics', aliases: ['mathematics', 'maths', 'math', 'mtc'] },
  { label: 'Biology', aliases: ['biology', 'bio'] },
  { label: 'Chemistry', aliases: ['chemistry', 'chem'] },
  { label: 'Physics', aliases: ['physics', 'phys', 'phy'] },
  { label: 'Geography', aliases: ['geography', 'geog'] },
  { label: 'History', aliases: ['history'] },
  { label: 'Economics', aliases: ['economics', 'economy'] },
  { label: 'Agriculture', aliases: ['agriculture', 'agric'] },
  { label: 'English', aliases: ['english'] },
  { label: 'Literature', aliases: ['literature'] },
  { label: 'ICT', aliases: ['ict', 'computer studies'] },
];

function normalizeWords(value) {
  return value.toLocaleUpperCase('en').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function hasPhrase(text, phrase) {
  const normalizedText = ` ${normalizeWords(text)} `;
  const normalizedPhrase = normalizeWords(phrase);
  return normalizedPhrase !== '' && normalizedText.includes(` ${normalizedPhrase} `);
}

function classifyBody(filename) {
  const matches = MOCK_BODIES
    .flatMap((body) => body.aliases.map((alias) => ({ body, alias })))
    .filter(({ alias }) => hasPhrase(filename, alias))
    .sort((left, right) => normalizeWords(right.alias).length - normalizeWords(left.alias).length);
  return matches[0]?.body ?? { label: GENERAL_CATEGORY, folder: GENERAL_CATEGORY };
}

function extractYear(filename, relativeDirectory) {
  const matches = filename.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g);
  if (matches?.length) return matches.at(-1);
  const directoryYear = relativeDirectory
    .split(/[\\/]/)
    .reverse()
    .find((part) => /^(?:19|20)\d{2}$/.test(part));
  return directoryYear ?? 'Undated';
}

function classifyClasses(filename) {
  const normalized = normalizeWords(filename);
  const keys = new Set();
  for (const match of normalized.matchAll(/(?:^|\s)P\s*([1-7])(?=\s|$)/g)) {
    keys.add(`p${match[1]}`);
  }
  for (const match of normalized.matchAll(/(?:^|\s)S\s*([1-6])(?=\s|$)/g)) {
    keys.add(`s${match[1]}`);
  }
  if (hasPhrase(filename, 'UCE')) keys.add('s4');
  if (hasPhrase(filename, 'UACE')) {
    keys.add('s5');
    keys.add('s6');
  }
  return [...keys].sort();
}

function classifySubject(filename) {
  for (const subject of SUBJECT_RULES) {
    if (subject.aliases.some((alias) => hasPhrase(filename, alias))) return subject.label;
  }
  return 'General';
}

function isSampleUnebPaper(filename) {
  return hasPhrase(filename, 'sample')
    && ['UNEB', 'UCE', 'UACE'].some((exam) => hasPhrase(filename, exam));
}

function classifyType(filename) {
  if (['guide', 'marking', 'scoring', 'answer'].some((word) => hasPhrase(filename, word))) return 'Marking Guides';
  if (['note', 'notes', 'syllabus', 'textbook', 'revision'].some((word) => hasPhrase(filename, word))) return 'Notes';
  return 'Study Resources';
}

function isResource(filename) {
  return RESOURCE_EXTENSIONS.has(path.extname(filename).toLocaleLowerCase('en'));
}

async function findResources(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const resources = [];

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.resource-organizer-')) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      resources.push(...await findResources(absolutePath, relativePath));
    } else if (entry.isFile() && isResource(entry.name)) {
      resources.push({ absolutePath, relativePath, filename: entry.name });
    }
  }

  return resources;
}

function categorize(resource) {
  const body = classifyBody(resource.filename);
  const year = extractYear(resource.filename, path.dirname(resource.relativePath));
  const classKeys = classifyClasses(resource.filename);
  if (!classKeys.length) classKeys.push('unsorted');
  const category = isSampleUnebPaper(resource.filename) ? SAMPLE_UNEB_CATEGORY : body.label;
  const folder = category === SAMPLE_UNEB_CATEGORY ? SAMPLE_UNEB_CATEGORY : body.folder;
  const relativePath = path.join(folder, year, resource.filename);
  return {
    ...resource,
    body: body.label,
    category,
    year,
    classKeys,
    subject: classifySubject(resource.filename),
    type: classifyType(resource.filename),
    targetPath: relativePath,
  };
}

function makeCatalog(resources) {
  const items = resources.map((resource) => {
    const relativePath = resource.targetPath.split(path.sep).join('/');
    const rawPath = relativePath.split('/').map(encodeURIComponent).join('/');
    return {
      title: path.basename(resource.filename, path.extname(resource.filename)),
      filename: resource.filename,
      path: relativePath,
      url: `${RAW_BASE_URL}/${rawPath}`,
      category: resource.category,
      body: resource.body,
      year: resource.year,
      classKeys: resource.classKeys,
      subject: resource.subject,
      type: resource.type,
      extension: path.extname(resource.filename).slice(1).toLocaleLowerCase('en'),
    };
  }).sort((left, right) => {
    const yearOrder = right.year.localeCompare(left.year, 'en', { numeric: true });
    return yearOrder || left.body.localeCompare(right.body, 'en') || left.filename.localeCompare(right.filename, 'en');
  });

  const countBy = (key) => Object.fromEntries(
    [...items.reduce((counts, item) => counts.set(item[key], (counts.get(item[key]) ?? 0) + 1), new Map())]
      .sort(([left], [right]) => String(left).localeCompare(String(right), 'en'))
  );

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    repository: 'https://github.com/trustjonathan/STUDT-HUB-RESOURCES-2026',
    count: items.length,
    trending2026Count: items.filter((item) => item.year === '2026').length,
    countsByBody: countBy('body'),
    countsByCategory: countBy('category'),
    countsByYear: countBy('year'),
    resources: items,
  };
}

function sameResources(existing, expected) {
  return JSON.stringify(existing.resources) === JSON.stringify(expected.resources)
    && existing.count === expected.count
    && existing.trending2026Count === expected.trending2026Count;
}

async function moveResourcesOnWindows(moves) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'study-hub-resource-moves-'));
  const planPath = path.join(temporaryDirectory, 'moves.json');
  const scriptPath = path.join(temporaryDirectory, 'move-resources.ps1');
  const plan = moves.map((resource) => ({
    source: resource.absolutePath,
    destination: path.resolve(root, resource.targetPath),
  }));
  const script = [
    "param([string]$PlanPath)",
    "$ErrorActionPreference = 'Stop'",
    "$items = ConvertFrom-Json ([System.IO.File]::ReadAllText($PlanPath, [System.Text.Encoding]::UTF8))",
    "foreach ($item in $items) {",
    "  if ([System.IO.File]::Exists($item.destination) -or [System.IO.Directory]::Exists($item.destination)) {",
    "    throw \"Destination already exists: $($item.destination)\"",
    "  }",
    "  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($item.destination)) | Out-Null",
    "  [System.IO.File]::Move($item.source, $item.destination)",
    "}",
  ].join('\r\n');

  try {
    await writeFile(planPath, JSON.stringify(plan), 'utf8');
    await writeFile(scriptPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script, 'utf8')]));
    const powershellPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershellPath, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      planPath,
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `PowerShell exited with status ${result.status}.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function fileHash(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function importResources(importDirectory, existingResources) {
  const sources = await findResources(importDirectory);

  const counts = { imported: 0, reclassified: 0, replaced: 0, reused: 0, skippedEmpty: 0 };

  for (const source of sources) {
    const sourceStat = await stat(source.absolutePath);
    if (sourceStat.size === 0) {
      counts.skippedEmpty += 1;
      console.warn(`Skipping empty source file: ${source.relativePath}`);
      continue;
    }

    const sourceRelativePath = path.join('2026', source.relativePath);
    const categorized = categorize({ ...source, relativePath: sourceRelativePath });
    const destination = path.resolve(root, categorized.targetPath);
    const sourceHash = await fileHash(source.absolutePath);
    const stem = path.basename(source.filename, path.extname(source.filename)).toLocaleLowerCase('en');
    const extension = path.extname(source.filename).toLocaleLowerCase('en');
    const siblings = existingResources.filter((item) => {
      const filename = item.filename.toLocaleLowerCase('en');
      return filename === source.filename.toLocaleLowerCase('en')
        || filename.startsWith(`${stem} (2026 import)${extension}`);
    });
    const existingDestination = siblings.find((item) => path.resolve(root, item.relativePath) === destination);

    if (existingDestination) {
      const destinationStat = await stat(existingDestination.absolutePath);
      if (destinationStat.size > 0 && await fileHash(existingDestination.absolutePath) === sourceHash) {
        counts.reused += 1;
        continue;
      }

      if (destinationStat.size === 0) {
        await copyFile(source.absolutePath, existingDestination.absolutePath);
        counts.replaced += 1;
        for (const sibling of siblings) {
          if (sibling === existingDestination || !sibling.filename.toLocaleLowerCase('en').startsWith(`${stem} (2026 import)${extension}`)) continue;
          if (await fileHash(sibling.absolutePath) === sourceHash) {
            await unlink(sibling.absolutePath);
          }
        }
        continue;
      }
    }

    const matchingExisting = [];
    for (const candidate of siblings) {
      if (path.resolve(root, candidate.relativePath) === destination) continue;
      if (await fileHash(candidate.absolutePath) === sourceHash) matchingExisting.push(candidate);
    }
    const reusable = matchingExisting.find((candidate) => !existingDestination);
    if (reusable) {
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(reusable.absolutePath, destination);
      counts.reclassified += 1;
      continue;
    }
    if (matchingExisting.length) {
      counts.reused += 1;
      continue;
    }

    const importFilename = `${path.basename(source.filename, path.extname(source.filename))} (2026 import)${path.extname(source.filename)}`;
    const importPath = path.join(path.dirname(categorized.targetPath), importFilename);
    const importDestination = path.resolve(root, importPath);
    let destinationExists = true;
    try {
      await stat(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      destinationExists = false;
    }
    if (destinationExists) {
      try {
        const existingImport = await readFile(importDestination);
        if (createHash('sha256').update(existingImport).digest('hex') === sourceHash) {
          counts.reused += 1;
          continue;
        }
        throw new Error(`2026 import destination already contains different content: ${importPath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await copyFile(source.absolutePath, importDestination);
    } else {
      await copyFile(source.absolutePath, destination);
    }
    counts.imported += 1;
  }

  return counts;
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const rootArgument = args.indexOf('--root');
const importArgument = args.indexOf('--import-dir');
const root = rootArgument >= 0
  ? path.resolve(args[rootArgument + 1] ?? '')
  : REPOSITORY_ROOT;
if (rootArgument >= 0 && !args[rootArgument + 1]) {
  throw new Error('Provide a directory after --root.');
}
if (importArgument >= 0 && !args[importArgument + 1]) {
  throw new Error('Provide a directory after --import-dir.');
}
if (checkOnly && importArgument >= 0) {
  throw new Error('--check cannot be combined with --import-dir.');
}

let discovered = await findResources(root);
if (importArgument >= 0) {
  const importDirectory = path.resolve(args[importArgument + 1]);
  const importCounts = await importResources(importDirectory, discovered);
  console.log(`2026 source import: ${importCounts.imported} added, ${importCounts.reclassified} reclassified, ${importCounts.replaced} repaired, ${importCounts.reused} already present, ${importCounts.skippedEmpty} empty skipped.`);
  discovered = await findResources(root);
}
const resources = discovered.map(categorize);
const destinations = new Set();

for (const resource of resources) {
  const targetPath = path.resolve(root, resource.targetPath);
  const normalizedTarget = targetPath.toLocaleLowerCase('en');
  if (destinations.has(normalizedTarget)) {
    throw new Error(`Multiple resources would use the same destination: ${resource.targetPath}`);
  }
  destinations.add(normalizedTarget);
}

const moves = resources.filter((resource) => path.resolve(root, resource.relativePath) !== path.resolve(root, resource.targetPath));
if (checkOnly && moves.length) {
  throw new Error(`Found ${moves.length} resource(s) that are not in their expected body/year folders. Run the script without --check to organize them.`);
}

if (!checkOnly) {
  if (process.platform === 'win32') {
    await moveResourcesOnWindows(moves);
  } else {
    for (const resource of moves) {
      const destination = path.resolve(root, resource.targetPath);
      try {
        const existingNames = await readdir(path.dirname(destination));
        if (existingNames.includes(path.basename(destination))) {
          throw new Error(`Destination already exists: ${resource.targetPath}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(resource.absolutePath, destination);
    }
  }
}

const organized = (await findResources(root)).map(categorize);
for (const resource of organized) {
  if (path.resolve(root, resource.relativePath) !== path.resolve(root, resource.targetPath)) {
    throw new Error(`Resource is not in its expected folder: ${resource.relativePath}`);
  }
}

const catalog = makeCatalog(organized);
const catalogPath = path.join(root, CATALOG_FILENAME);
if (checkOnly) {
  let existing;
  try {
    existing = JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${CATALOG_FILENAME} is missing. Run the script without --check to generate it.`);
    throw error;
  }
  if (!sameResources(existing, catalog)) {
    throw new Error(`${CATALOG_FILENAME} is stale. Run the script without --check to regenerate it.`);
  }
} else {
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

console.log(`${checkOnly ? 'Verified' : 'Organized'} ${catalog.count} resources.`);
console.log(`2026 trending resources: ${catalog.trending2026Count}.`);
console.log(`Resource catalog: ${path.relative(root, catalogPath)}`);
