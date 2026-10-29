// Cria server/.env para uso local, com segredos aleatórios. Não sobrescreve um .env existente.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = path.join(root, '.env');

if (existsSync(target)) {
  console.log('server/.env já existe: nada foi alterado.');
} else {
  const secret = () => randomBytes(24).toString('hex');
  const text = readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace(/^IP_HASH_SECRET=.*$/m, `IP_HASH_SECRET=${secret()}`)
    .replace(/^QR_SECRET=.*$/m, `QR_SECRET=${secret()}`)
    .replace(/^PUBLIC_APP_URL=.*$/m, 'PUBLIC_APP_URL=http://localhost:5173');
  writeFileSync(target, text);
  console.log('server/.env criado com segredos aleatórios para teste local.');
}
