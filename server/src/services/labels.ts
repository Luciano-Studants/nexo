import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { deriveManualCode, deriveToken, formatManualCode } from './qr.js';
import type { PrintItem } from './qrAdmin.js';

// A6 = 105 x 148 mm em pontos. Quatro etiquetas A6 formam exatamente uma folha A4.
const A6 = { w: 297.64, h: 419.53 };
const A4 = { w: 595.28, h: 841.89 };
const NAVY = '#0A0D29';
const GOLD = '#DBB13B';

export type LabelOptions = {
  format: 'a4' | 'a6';
  secret: string;
  appUrl: string;
  eventName: string;
};

async function drawLabel(doc: PDFKit.PDFDocument, x: number, y: number, item: PrintItem, o: LabelOptions) {
  const w = A6.w;
  const token = deriveToken(o.secret, item.id, item.version);
  const code = formatManualCode(deriveManualCode(o.secret, item.id, item.version));
  const url = `${o.appUrl.replace(/\/+$/, '')}/q/${token}`;

  // Cabeçalho
  doc.rect(x, y, w, 64).fill(NAVY);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(26).text('NEXO', x + 20, y + 14, { characterSpacing: 4 });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(9).text(o.eventName, x + 20, y + 44, { width: w - 40 });

  // Ambiente
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20)
    .text(item.name, x + 20, y + 82, { width: w - 40, align: 'center' });
  const sub = `${item.floorName}${item.number ? ` · Sala ${item.number}` : ''}`;
  doc.fillColor('#2B2E4A').font('Helvetica').fontSize(11).text(sub, x + 20, doc.y + 2, { width: w - 40, align: 'center' });

  // QR (alta correção de erro para sobreviver a dobras/sujeira)
  const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'Q', margin: 1, width: 640 });
  const qr = 176;
  doc.image(png, x + (w - qr) / 2, y + 150, { width: qr, height: qr });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11)
    .text('Escaneie para registrar sua visita', x + 20, y + 332, { width: w - 40, align: 'center' });

  // Código manual
  doc.fillColor('#2B2E4A').font('Helvetica').fontSize(8)
    .text('Sem câmera? No NEXO, toque em "Ler QR Code" e depois em "Digitar código":', x + 20, y + 352, { width: w - 40, align: 'center' });
  doc.fillColor(NAVY).font('Courier-Bold').fontSize(17).text(code, x + 20, y + 374, { width: w - 40, align: 'center', characterSpacing: 1 });
  doc.fillColor('#6B6E88').font('Helvetica').fontSize(7)
    .text(`Versão ${item.version} · ${item.status === 'pending' ? 'AINDA NÃO ATIVA' : 'ativa'}`, x + 20, y + 402, { width: w - 40, align: 'center' });
}

function cutLines(doc: PDFKit.PDFDocument) {
  doc.save().lineWidth(0.5).strokeColor('#999999').dash(4, { space: 4 });
  doc.moveTo(A6.w, 0).lineTo(A6.w, A4.h).stroke();
  doc.moveTo(0, A6.h).lineTo(A4.w, A6.h).stroke();
  doc.restore();
}

export async function renderLabels(items: PrintItem[], o: LabelOptions): Promise<Buffer> {
  const doc = new PDFDocument({
    size: o.format === 'a6' ? [A6.w, A6.h] : 'A4',
    margin: 0,
    autoFirstPage: false,
    info: { Title: 'NEXO · etiquetas de QR Code', Author: 'NEXO' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  if (o.format === 'a6') {
    for (const item of items) {
      doc.addPage();
      await drawLabel(doc, 0, 0, item, o);
    }
  } else {
    for (let i = 0; i < items.length; i += 4) {
      doc.addPage();
      cutLines(doc);
      for (let j = 0; j < 4 && i + j < items.length; j++) {
        await drawLabel(doc, (j % 2) * A6.w, Math.floor(j / 2) * A6.h, items[i + j]!, o);
      }
    }
  }
  if (items.length === 0) doc.addPage();
  doc.end();
  return done;
}

// ---- QR de entrada do evento (o que o visitante lê para abrir o NEXO) ----

export function entryUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, '') + '/';
}

export function entryQrPng(appUrl: string, width = 1024): Promise<Buffer> {
  return QRCode.toBuffer(entryUrl(appUrl), { errorCorrectionLevel: 'Q', margin: 4, width });
}

// Cartaz A4 vertical para imprimir e fixar na entrada.
export async function renderEntryPoster(o: { appUrl: string; eventName: string; sample?: boolean }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'NEXO · QR de entrada', Author: 'NEXO' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = A4.w;

  doc.rect(0, 0, W, 190).fill(NAVY);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(64).text('NEXO', 0, 52, { width: W, align: 'center', characterSpacing: 10 });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(16).text('Explore espaços. Descubra possibilidades.', 0, 138, { width: W, align: 'center' });

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(30).text(o.eventName, 50, 222, { width: W - 100, align: 'center' });
  doc.fillColor('#2B2E4A').font('Helvetica').fontSize(18).text('Aponte a câmera do celular para o QR Code e comece a explorar.', 90, doc.y + 12, { width: W - 180, align: 'center' });

  const size = 320;
  const png = await entryQrPng(o.appUrl, 1200);
  const x = (W - size) / 2;
  const y = 335;
  doc.roundedRect(x - 16, y - 16, size + 32, size + 32, 14).lineWidth(4).strokeColor(GOLD).stroke();
  doc.image(png, x, y, { width: size, height: size });

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('Sem câmera ou o QR não abriu? Digite no navegador:', 50, y + size + 36, { width: W - 100, align: 'center' });
  doc.fillColor(NAVY).font('Courier-Bold').fontSize(20).text(entryUrl(o.appUrl).replace(/\/$/, ''), 50, doc.y + 8, { width: W - 100, align: 'center' });
  doc.fillColor('#6B6E88').font('Helvetica').fontSize(11).text('Informe seu nome completo e use o mapa para visitar os ambientes. Em cada sala, leia o QR Code da porta.', 90, 785, { width: W - 180, align: 'center' });

  if (o.sample) {
    doc.save().rotate(-30, { origin: [W / 2, 420] }).fillColor('#C0392B').opacity(0.18).font('Helvetica-Bold').fontSize(90)
      .text('EXEMPLO', 0, 380, { width: W, align: 'center' }).restore();
  }
  doc.end();
  return done;
}
