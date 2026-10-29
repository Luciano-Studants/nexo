import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import { fmtDateTime, type Report } from './reports.js';

const NAVY = '#0A0D29';
const GOLD = '#DBB13B';
const label = (x: { name: string; number: string | null }) => (x.number && !x.name.includes(x.number) ? `${x.name} (${x.number})` : x.name);
const sim = (b: boolean) => (b ? 'Sim' : 'Não');
const pctText = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

// ------------------------------------------------------------------ XLSX
export async function renderXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NEXO';
  wb.created = r.generatedAt;

  const sheet = (name: string, columns: Array<{ header: string; key: string; width: number }>, rows: object[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns;
    ws.addRows(rows);
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFDBB13B' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0D29' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };

  // Resumo (chave/valor)
  const s = r.summary;
  const resumo: Array<[string, string | number]> = [
    ['Evento', r.event.name], ['Edição', r.event.edition ?? ''], ['Situação', r.event.status],
    ['Início programado', fmtDateTime(r.event.startsAt)], ['Término programado', fmtDateTime(r.event.endsAt)],
    ['Relatório gerado em', fmtDateTime(r.generatedAt)], ['Fuso horário', 'America/Sao_Paulo'],
    ['', ''],
    ['Participantes cadastrados', s.participants], ['Com ao menos 1 visita', s.withVisit], ['Sem nenhuma visita', s.withoutVisit],
    ['Concluíram (todos os obrigatórios)', s.completed], ['Taxa de conclusão (%)', s.completionPct],
    ['Total de visitas registradas', s.visits], ['Média de visitas por participante', s.avgVisits],
    ['Progresso médio nos obrigatórios (%)', s.avgProgressPct],
    ['Ambientes obrigatórios ativos', s.requiredRooms], ['Ambientes ativos', s.activeRooms],
    ['Primeira visita', fmtDateTime(s.firstVisit)], ['Última visita', fmtDateTime(s.lastVisit)],
  ];
  sheet('Resumo', [{ header: 'Indicador', key: 'k', width: 42 }, { header: 'Valor', key: 'v', width: 34 }], resumo.map(([k, v]) => ({ k, v })));

  sheet('Por piso', [
    { header: 'Piso', key: 'floor', width: 18 }, { header: 'Ambientes', key: 'rooms', width: 12 },
    { header: 'Ativos', key: 'activeRooms', width: 10 }, { header: 'Obrigatórios ativos', key: 'requiredRooms', width: 20 },
    { header: 'Visitas', key: 'visits', width: 10 }, { header: 'Visitantes únicos', key: 'uniqueVisitors', width: 18 },
    { header: 'Alcance (% dos participantes)', key: 'reachPct', width: 28 }, { header: 'Média de visitas por ambiente ativo', key: 'avgPerRoom', width: 34 },
  ], r.floors);

  sheet('Por ambiente', [
    { header: 'Posição', key: 'rank', width: 10 }, { header: 'Piso', key: 'floor', width: 16 },
    { header: 'Número', key: 'number', width: 10 }, { header: 'Ambiente', key: 'name', width: 38 },
    { header: 'Obrigatório', key: 'required', width: 13 }, { header: 'Ativo', key: 'active', width: 8 },
    { header: 'Visitas', key: 'visits', width: 10 }, { header: 'Alcance (% dos participantes)', key: 'reachPct', width: 28 },
    { header: 'Primeira visita', key: 'first', width: 20 }, { header: 'Última visita', key: 'last', width: 20 },
  ], r.rooms.map((x) => ({ ...x, number: x.number ?? '', required: sim(x.required), active: sim(x.active), first: fmtDateTime(x.firstVisit), last: fmtDateTime(x.lastVisit) })));

  sheet('Ranking', [
    { header: 'Grupo', key: 'g', width: 22 }, { header: 'Posição', key: 'p', width: 10 },
    { header: 'Ambiente', key: 'name', width: 38 }, { header: 'Piso', key: 'floor', width: 16 }, { header: 'Visitas', key: 'visits', width: 10 },
  ], [
    ...r.mostVisited.map((x, i) => ({ g: 'Mais visitados', p: i + 1, name: x.name, floor: x.floor, visits: x.visits })),
    ...r.leastVisited.map((x, i) => ({ g: 'Menos visitados', p: i + 1, name: x.name, floor: x.floor, visits: x.visits })),
  ]);

  sheet('Conclusão', [
    { header: 'Faixa de progresso (obrigatórios)', key: 'label', width: 36 }, { header: 'Participantes', key: 'count', width: 16 }, { header: '% do total', key: 'pct', width: 12 },
  ], r.distribution);

  sheet('Visitas por hora', [{ header: 'Dia/hora (Brasília)', key: 'hour', width: 22 }, { header: 'Visitas', key: 'visits', width: 10 }], r.hourly);

  sheet('Participantes', [
    { header: 'Nome', key: 'name', width: 40 }, { header: 'Cadastro', key: 'created', width: 20 }, { header: 'Último acesso', key: 'seen', width: 20 },
    { header: 'Visitas', key: 'visits', width: 10 }, { header: 'Obrigatórios visitados', key: 'requiredVisited', width: 22 },
    { header: 'Progresso (%)', key: 'progressPct', width: 14 }, { header: 'Concluiu', key: 'completed', width: 11 }, { header: 'Concluiu em', key: 'completedAt', width: 20 },
  ], r.participants.map((p) => ({ ...p, created: fmtDateTime(p.createdAt), seen: fmtDateTime(p.lastSeenAt), completed: sim(p.completed), completedAt: fmtDateTime(p.completedAt) })));

  sheet('Visitas (detalhe)', [
    { header: 'Data/hora', key: 'at', width: 20 }, { header: 'Participante', key: 'participant', width: 40 },
    { header: 'Piso', key: 'floor', width: 16 }, { header: 'Ambiente', key: 'room', width: 38 }, { header: 'Obrigatório', key: 'required', width: 13 },
  ], r.visits.map((v) => ({ ...v, at: fmtDateTime(v.at), required: sim(v.required) })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF
type Col = { title: string; w: number; align?: 'left' | 'right' | 'center' };

export function renderPdf(r: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Relatório NEXO — ${r.event.name}`, Author: 'NEXO' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40, W = 515, BOTTOM = 800;
    const ensure = (h: number) => { if (doc.y + h > BOTTOM) doc.addPage(); };
    const h2 = (t: string) => {
      ensure(60);
      doc.moveDown(0.8).fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(t, L, doc.y);
      doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(1.5).strokeColor(GOLD).stroke();
      doc.moveDown(0.6);
    };

    function table(cols: Col[], rows: string[][], opts: { fontSize?: number } = {}) {
      const fs = opts.fontSize ?? 9;
      const total = cols.reduce((a, c) => a + c.w, 0);
      const scale = W / total;
      const widths = cols.map((c) => c.w * scale);
      const header = () => {
        const y = doc.y;
        doc.rect(L, y, W, 18).fill(NAVY);
        let x = L;
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(fs);
        cols.forEach((c, i) => { doc.text(c.title, x + 4, y + 5, { width: widths[i]! - 8, align: c.align ?? 'left', lineBreak: false }); x += widths[i]!; });
        doc.y = y + 20;
      };
      header();
      rows.forEach((row, ri) => {
        doc.font('Helvetica').fontSize(fs);
        const h = Math.max(...row.map((cell, i) => doc.heightOfString(cell, { width: widths[i]! - 8 }))) + 6;
        if (doc.y + h > BOTTOM) { doc.addPage(); header(); }
        const y = doc.y;
        if (ri % 2 === 0) doc.rect(L, y, W, h).fill('#F4F2E8');
        let x = L;
        doc.fillColor('#1A1D3A');
        row.forEach((cell, i) => { doc.text(cell, x + 4, y + 3, { width: widths[i]! - 8, align: cols[i]!.align ?? 'left' }); x += widths[i]!; });
        doc.y = y + h;
      });
      doc.moveDown(0.5);
    }

    // Capa / cabeçalho
    doc.rect(0, 0, 595.28, 110).fill(NAVY);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(30).text('NEXO', L, 28, { characterSpacing: 5 });
    doc.fillColor('#FFFFFF').font('Helvetica').fontSize(12).text(`Relatório do evento — ${r.event.name}`, L, 68);
    doc.fontSize(9).fillColor('#C9CBE0').text(`Gerado em ${fmtDateTime(r.generatedAt)} (Brasília)`, L, 88);
    doc.y = 125;

    const s = r.summary;
    doc.fillColor('#1A1D3A').font('Helvetica').fontSize(10)
      .text(`Situação: ${r.event.status} · Início: ${fmtDateTime(r.event.startsAt) || 'não definido'} · Término: ${fmtDateTime(r.event.endsAt) || 'não definido'}`, L, doc.y);

    h2('Resumo geral');
    table([{ title: 'Indicador', w: 3 }, { title: 'Valor', w: 1.4, align: 'right' }], [
      ['Participantes cadastrados', String(s.participants)],
      ['Com ao menos 1 visita', `${s.withVisit} (${pctText((s.withVisit / (s.participants || 1)) * 100)})`],
      ['Sem nenhuma visita', String(s.withoutVisit)],
      ['Concluíram todos os obrigatórios', String(s.completed)],
      ['Taxa de conclusão', pctText(s.completionPct)],
      ['Total de visitas registradas', String(s.visits)],
      ['Média de visitas por participante', String(s.avgVisits).replace('.', ',')],
      ['Progresso médio nos obrigatórios', pctText(s.avgProgressPct)],
      ['Ambientes obrigatórios ativos / ativos', `${s.requiredRooms} / ${s.activeRooms}`],
      ['Primeira / última visita', `${fmtDateTime(s.firstVisit) || '—'} / ${fmtDateTime(s.lastVisit) || '—'}`],
    ], { fontSize: 10 });

    h2('Por piso');
    table(
      [{ title: 'Piso', w: 2 }, { title: 'Amb.', w: 1, align: 'right' }, { title: 'Obrig.', w: 1, align: 'right' }, { title: 'Visitas', w: 1, align: 'right' },
       { title: 'Visitantes', w: 1.3, align: 'right' }, { title: 'Alcance', w: 1.2, align: 'right' }, { title: 'Média/amb.', w: 1.4, align: 'right' }],
      r.floors.map((f) => [f.floor, `${f.activeRooms}/${f.rooms}`, String(f.requiredRooms), String(f.visits), String(f.uniqueVisitors), pctText(f.reachPct), String(f.avgPerRoom).replace('.', ',')]),
    );

    h2('Ranking de ambientes');
    const rk = (x: Report['rooms'][number], i: number) => [String(i + 1), label(x), x.floor, String(x.visits), pctText(x.reachPct)];
    const rkCols: Col[] = [{ title: '#', w: 0.6 }, { title: 'Ambiente', w: 4 }, { title: 'Piso', w: 1.6 }, { title: 'Visitas', w: 1, align: 'right' }, { title: 'Alcance', w: 1.2, align: 'right' }];
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Mais visitados', L, doc.y); doc.moveDown(0.3);
    table(rkCols, r.mostVisited.map(rk));
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Menos visitados', L, doc.y); doc.moveDown(0.3);
    table(rkCols, r.leastVisited.map(rk));

    h2('Conclusão: distribuição do progresso nos obrigatórios');
    table([{ title: 'Faixa', w: 3 }, { title: 'Participantes', w: 1.4, align: 'right' }, { title: '% do total', w: 1.2, align: 'right' }],
      r.distribution.map((d) => [d.label, String(d.count), pctText(d.pct)]));

    h2('Todos os ambientes (do mais ao menos visitado)');
    table(
      [{ title: '#', w: 0.6 }, { title: 'Ambiente', w: 3.6 }, { title: 'Piso', w: 1.5 }, { title: 'Obrig.', w: 1 }, { title: 'Ativo', w: 0.9 }, { title: 'Visitas', w: 1, align: 'right' }, { title: 'Alcance', w: 1.2, align: 'right' }],
      r.rooms.map((x) => [String(x.rank), label(x), x.floor, sim(x.required), sim(x.active), String(x.visits), pctText(x.reachPct)]),
    );

    if (r.hourly.length) {
      h2('Visitas por hora');
      table([{ title: 'Dia/hora (Brasília)', w: 3 }, { title: 'Visitas', w: 1, align: 'right' }], r.hourly.map((h) => [h.hour, String(h.visits)]));
    }

    h2(`Participantes (${r.participants.length})`);
    if (r.participants.length === 0) doc.font('Helvetica').fontSize(10).fillColor('#1A1D3A').text('Nenhum participante cadastrado.');
    else table(
      [{ title: 'Nome', w: 4 }, { title: 'Visitas', w: 1, align: 'right' }, { title: 'Obrig.', w: 1, align: 'right' }, { title: 'Progresso', w: 1.3, align: 'right' }, { title: 'Concluiu', w: 1.3 }],
      r.participants.map((p) => [p.name, String(p.visits), String(p.requiredVisited), pctText(p.progressPct), p.completed ? `Sim · ${fmtDateTime(p.completedAt)}` : 'Não']),
      { fontSize: 8 },
    );

    // Rodapé com paginação
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // permite escrever no rodapé sem abrir página nova
      doc.font('Helvetica').fontSize(8).fillColor('#6B6E88')
        .text(`NEXO · Contém nomes de participantes: uso restrito à organização · Página ${i + 1} de ${range.count}`, L, 815, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
