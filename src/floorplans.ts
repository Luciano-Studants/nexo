// Geometria dos três pisos, reconstruída das plantas oficiais aprovadas (esquemas 2D).
// Coordenadas relativas, sem escala arquitetônica. Banheiros, elevador e escadas são só desenho.

export type Cell = {
  id: string;
  // Presente só nos ambientes visitáveis; casa com `slug` do banco.
  slug?: string;
  kind: 'room' | 'structure';
  label: string[];
  x: number;
  y: number;
  w: number;
  h: number;
};

// Porta numa parede vertical: dobradiça em (x, y); `s` = lado para onde abre (+1 direita, -1 esquerda);
// `v` = 'down' (folha desce a partir da dobradiça) ou 'up' (sobe).
export type Door = { x: number; y: number; s: 1 | -1; v: 'down' | 'up' };

export type FloorPlan = {
  order: number;
  title: string;
  width: number;
  height: number;
  doorRadius: number;
  fontSize: number;
  cells: Cell[];
  doors: Door[];
  // Faixa de entrada (só no 1º piso).
  entrance?: { x: number; w: number; y: number };
  // Rótulo do corredor central.
  corridor: { x: number; y: number };
};

const room = (slug: string, label: string[], x: number, y: number, w: number, h: number): Cell => ({
  id: slug, slug, kind: 'room', label, x, y, w, h,
});
const struct = (id: string, label: string[], x: number, y: number, w: number, h: number): Cell => ({
  id, kind: 'structure', label, x, y, w, h,
});

export const FLOOR_PLANS: FloorPlan[] = [
  {
    order: 1,
    title: '1º piso',
    width: 677,
    height: 800,
    doorRadius: 28,
    fontSize: 19,
    corridor: { x: 355, y: 400 },
    entrance: { x: 318, w: 68, y: 785 },
    cells: [
      struct('wc-1a', ['WC'], 0, 0, 58, 193),
      struct('wc-1b', ['WC'], 58, 0, 78, 82),
      struct('wc-1c', ['WC'], 136, 0, 78, 82),
      struct('elevador-1', ['Elevador'], 214, 0, 283, 82),
      room('a-nomear-topo-direita', ['A nomear'], 497, 37, 180, 196),
      room('laboratorio-multidisciplinar', ['Laboratório', 'Multidisciplinar'], 497, 233, 180, 210),
      room('biblioteca', ['Biblioteca'], 497, 443, 180, 342),
      room('tecnicas-radiologicas', ['Técnicas', 'Radiológicas'], 0, 193, 214, 108),
      room('laboratorio-anatomia', ['Laboratório', 'de Anatomia'], 0, 301, 214, 132),
      room('laboratorio-enfermagem', ['Laboratório', 'de Enfermagem'], 0, 433, 214, 170),
      room('direcao', ['Direção'], 0, 603, 214, 182),
      struct('escada-1a', ['Escadas', '2º piso'], 214, 696, 80, 89),
      struct('escada-1b', ['Escadas', '2º piso'], 416, 696, 81, 89),
    ],
    doors: [
      { x: 214, y: 308, s: -1, v: 'down' },
      { x: 214, y: 436, s: -1, v: 'down' },
      { x: 214, y: 606, s: -1, v: 'down' },
      { x: 497, y: 232, s: 1, v: 'up' },
      { x: 497, y: 292, s: 1, v: 'up' },
      { x: 497, y: 598, s: 1, v: 'down' },
      { x: 497, y: 658, s: 1, v: 'up' },
    ],
  },
  {
    order: 2,
    title: '2º piso',
    width: 479,
    height: 795,
    doorRadius: 22,
    fontSize: 14,
    corridor: { x: 238, y: 400 },
    cells: [
      room('sala-201', ['201'], 0, 0, 80, 94),
      struct('elevador-2', ['Elevador'], 140, 0, 121, 48),
      struct('wc-2a', ['WC'], 261, 0, 137, 48),
      room('sala-202', ['202'], 398, 0, 81, 94),
      struct('wc-2b', ['WC'], 233, 94, 99, 138),
      room('circuitos', ['Circuitos'], 0, 94, 145, 173),
      room('laboratorio-desenvolvimento', ['Laboratório de', 'Desenvolvimento'], 0, 267, 145, 172),
      room('programacao-1', ['Programação 1'], 0, 439, 145, 172),
      room('sala-de-jogos', ['Sala de Jogos'], 0, 611, 145, 122),
      room('imagem', ['Imagem'], 332, 94, 147, 173),
      room('laboratorio-desenvolvimento-internet', ['Laboratório de', 'Desenvolvimento', 'para Internet'], 332, 267, 147, 172),
      room('infraestrutura', ['Infraestrutura'], 332, 439, 147, 172),
      room('programacao-2', ['Programação 2'], 332, 611, 147, 122),
      struct('escada-2a', ['Escadas', '3º'], 145, 733, 52, 62),
      struct('escada-2b', ['Escadas', '1º piso'], 197, 733, 81, 62),
      struct('escada-2c', ['Escadas', '3º'], 278, 733, 54, 62),
    ],
    doors: [
      { x: 145, y: 268, s: -1, v: 'up' },
      { x: 145, y: 268, s: -1, v: 'down' },
      { x: 145, y: 441, s: -1, v: 'down' },
      { x: 145, y: 613, s: -1, v: 'down' },
      { x: 332, y: 267, s: 1, v: 'up' },
      { x: 332, y: 267, s: 1, v: 'down' },
      { x: 332, y: 441, s: 1, v: 'down' },
      { x: 332, y: 613, s: 1, v: 'down' },
    ],
  },
  {
    order: 3,
    title: '3º piso',
    width: 457,
    height: 780,
    doorRadius: 22,
    fontSize: 14,
    corridor: { x: 228, y: 400 },
    cells: [
      room('sala-302', ['302'], 0, 0, 142, 95),
      room('sala-303', ['303'], 0, 95, 142, 164),
      room('sala-304', ['304'], 0, 259, 142, 172),
      room('sala-305', ['305'], 0, 431, 142, 133),
      room('sala-306', ['306'], 0, 564, 142, 133),
      room('nde-e-cpa', ['NDE e CPA'], 0, 697, 142, 83),
      struct('elevador-3', ['Elevador'], 142, 0, 73, 42),
      room('sala-301', ['301'], 215, 0, 242, 98),
      room('sala-de-ti', ['Sala de TI'], 215, 98, 100, 139),
      room('auditorio', ['Auditório'], 315, 98, 142, 268),
      room('sala-300', ['300'], 315, 366, 142, 157),
      room('laboratorio-fisica', ['Laboratório', 'de Física'], 315, 523, 142, 174),
      room('sala-dos-professores', ['Sala dos', 'Professores'], 315, 697, 142, 83),
      struct('escada-3', ['Escadas', '2º piso'], 188, 722, 82, 58),
    ],
    doors: [
      { x: 142, y: 231, s: -1, v: 'down' },
      { x: 142, y: 399, s: -1, v: 'down' },
      { x: 142, y: 534, s: -1, v: 'down' },
      { x: 142, y: 664, s: -1, v: 'down' },
      { x: 215, y: 62, s: 1, v: 'down' },
      { x: 315, y: 270, s: 1, v: 'down' },
      { x: 315, y: 326, s: 1, v: 'up' },
      { x: 315, y: 497, s: 1, v: 'down' },
      { x: 315, y: 553, s: 1, v: 'up' },
    ],
  },
];

export const planForFloor = (order: number): FloorPlan | undefined =>
  FLOOR_PLANS.find((p) => p.order === order);

// Caminho SVG da porta: folha aberta + arco de giro.
export function doorPath(d: Door, r: number): string {
  const y2 = d.v === 'down' ? d.y + r : d.y - r;
  const tipX = d.x + d.s * r;
  // sweep: 1 = sentido horário na tela.
  const sweep = (d.s === 1) === (d.v === 'down') ? 1 : 0;
  return `M ${d.x} ${d.y} L ${tipX} ${d.y} A ${r} ${r} 0 0 ${sweep} ${d.x} ${y2}`;
}
