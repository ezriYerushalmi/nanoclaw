import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [groupDirectory, sessionsDirectory, image] = process.argv.slice(2);
if (!groupDirectory || !sessionsDirectory || !image)
  throw new Error('usage: init.ts GROUP_DIR ROBI_SESSIONS_DIR INSTALLED_IMAGE');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = join(root, '.env');
const group = resolve(groupDirectory);
const authorityDirectory = resolve(root, '../../data/robi-health');
const authorityFile = join(authorityDirectory, 'trusted-whatsapp.json');
if (!existsSync(join(group, 'whatsapp-interaction.json')) || !existsSync(sessionsDirectory))
  throw new Error('existing_robi_workspace_required');
mkdirSync(authorityDirectory, { recursive: true, mode: 0o700 });
if (!existsSync(authorityFile))
  writeFileSync(authorityFile, readFileSync(join(group, 'whatsapp-interaction.json')), { mode: 0o600, flag: 'wx' });
if (!existsSync(env)) {
  const lines = {
    ROBI_DB_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
    ROBI_DB_PASSWORD: randomBytes(32).toString('hex'),
    ROBI_GROUP_DIR: group,
    ROBI_AUTHORITY_FILE: authorityFile,
    ROBI_SESSIONS_DIR: resolve(sessionsDirectory),
    ROBI_IMAGE: image,
    ROBI_API_PORT: '18765',
  };
  if (Object.values(lines).some((value) => /[\r\n$"'`]/.test(value)))
    throw new Error('unsupported_configuration_value');
  writeFileSync(
    env,
    Object.entries(lines)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
}
const config = join(group, 'health-data.json');
if (!existsSync(config))
  writeFileSync(config, readFileSync(join(root, 'health-data.example.json')), { mode: 0o600, flag: 'wx' });
// Current installation uses Codex's native per-group persistent skill directory.
const skillDirectory = join(resolve(sessionsDirectory), '.codex-shared', 'skills', 'robi-health-data');
mkdirSync(skillDirectory, { recursive: true });
const skillFile = join(skillDirectory, 'SKILL.md');
if (!existsSync(skillFile))
  writeFileSync(skillFile, readFileSync(join(root, 'agent-skill', 'SKILL.md')), { mode: 0o600, flag: 'wx' });
console.info(JSON.stringify({ event: 'robi_local_configuration_initialized', credentialsPrinted: false }));
