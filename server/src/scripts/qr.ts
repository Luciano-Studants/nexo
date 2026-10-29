import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { db } from '../db.js';
import { loadConfig } from '../config.js';
import { renderLabels } from '../services/labels.js';
import {
  activatePending,
  prepareVersions,
  selectRooms,
  versionsToPrint,
  type RoomSelector,
} from '../services/qrAdmin.js';

// Uso (a partir de /server):
//   npm run qr -- prepare  --required | --all | --slugs a,b     cria versões PENDENTES
//   npm run qr -- print    --status pending|active [--format a4|a6] [--out arquivo.pdf] + seletor
//   npm run qr -- activate --required | --all | --slugs a,b     ativa as pendentes e substitui as antigas
// Fluxo recomendado: prepare → print (pending) → colar e conferir no local → activate.
// Os PDFs contêm QR e códigos válidos: trate como material sensível.

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function selector(): RoomSelector {
  return {
    all: has('all'),
    required: has('required'),
    slugs: flag('slugs')?.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadConfig();
  const rooms = await selectRooms(config.eventSlug, selector());

  if (command === 'prepare') {
    const res = await prepareVersions(config.qrSecret, rooms.map((r) => r.id));
    for (const r of res) {
      const room = rooms.find((x) => x.id === r.roomId)!;
      console.log(`${r.created ? 'criada ' : 'já existe'} v${r.version} (pendente)  ${room.floorName} · ${room.name}`);
    }
    console.log('Agora imprima com: npm run qr -- print --status pending ... e confira no local antes de ativar.');
  } else if (command === 'activate') {
    const res = await activatePending(rooms.map((r) => r.id));
    for (const r of res) {
      const room = rooms.find((x) => x.id === r.roomId)!;
      console.log(`ativada v${r.version}${r.replaced ? ` (substitui v${r.replaced}, que deixa de valer)` : ''}  ${room.name}`);
    }
    if (res.length === 0) console.log('Nenhuma versão pendente para ativar.');
  } else if (command === 'print') {
    const status = flag('status') === 'pending' ? 'pending' : 'active';
    const format = flag('format') === 'a6' ? 'a6' : 'a4';
    const appUrl = process.env.PUBLIC_APP_URL;
    if (!appUrl || !/^https?:\/\//.test(appUrl)) {
      throw new Error('Defina PUBLIC_APP_URL (ex.: https://nexo.exemplo.com) para gravar nos QR Codes.');
    }
    const items = await versionsToPrint(rooms, status);
    if (items.length === 0) throw new Error(`Nenhuma versão ${status} para imprimir nos ambientes escolhidos.`);

    const ev = await db.query<{ name: string }>('SELECT name FROM events WHERE slug = $1', [config.eventSlug]);
    const pdf = await renderLabels(items, {
      format, secret: config.qrSecret, appUrl, eventName: ev.rows[0]?.name ?? 'NEXO',
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.resolve(flag('out') ?? `out/qr-${status}-${format}-${stamp}.pdf`);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, pdf);
    console.log(`${items.length} etiqueta(s) em ${out}  (material sensível: não versionar nem compartilhar)`);
  } else {
    throw new Error('Comando inválido. Use prepare, print ou activate.');
  }
}

main()
  .catch((error) => {
    console.error('Erro:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
