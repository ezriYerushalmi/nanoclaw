import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [groupDir, codexSharedDir] = process.argv.slice(2);
if (!groupDir || !codexSharedDir || !fs.existsSync(path.join(groupDir, 'whatsapp-interaction.json')))
  throw new Error('Usage: tsx apps/robi-vision/init.ts <configured Robi group directory> <Codex shared directory>');
const destination = path.join(codexSharedDir, 'skills', 'robi-image-understanding');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-skill', 'SKILL.md'),
  path.join(destination, 'SKILL.md'),
);
fs.writeFileSync(path.join(groupDir, 'vision-enabled'), 'Native Codex image tools enabled\n');
console.log('Robi vision skill and scoped tool opt-in installed');
