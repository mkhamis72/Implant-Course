// The Implant Passport as a react-pdf document: A4 portrait, header and footer on every page, sections in the
// model's print order. All copy comes from the model (labels.ts); this file only lays it out.
// Labels and values are separate Text elements so neutral punctuation next to Arabic keeps its place (bidi).
// Page breaks: a table row, a part and a card's title block never split; a heading always travels with the first
// thing under it (see Flow).
// Drawn in the user's browser (src/lib/passport/client.ts), from the model the data route sends as JSON.
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { PASSPORT_LABELS as L } from './labels';
import { PASSPORT_FONT_STACK } from './fonts';
import { PassportChart, CHART_COLORS } from './chart';
import type { CaseDetail, Field, ImplantDetail, Part, PassportModel } from './model';

const INK = '#17262b';
const MUTED = '#55666b';
const LINE = '#d9e2df';
const SUNKEN = '#eaf0ee';
const ZEBRA = '#f7faf9';
const ACCENT = CHART_COLORS.accentStrong;

const PAGE_X = 36;
const HEADER_TOP = 22;
const HEADER_H = 58;
const FOOTER_H = 34;
/** A4 width less the side margins. */
export const CONTENT_WIDTH = 595.28 - 2 * PAGE_X;

// Every text style sets its own lineHeight: react-pdf inherits a resolved one (in points), not a ratio.
const s = StyleSheet.create({
  page: {
    fontFamily: PASSPORT_FONT_STACK, fontSize: 9, color: INK,
    paddingTop: HEADER_TOP + HEADER_H + 10, paddingBottom: FOOTER_H + 22, paddingHorizontal: PAGE_X,
  },
  header: {
    position: 'absolute', top: HEADER_TOP, left: PAGE_X, right: PAGE_X, height: HEADER_H,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1.5, borderBottomColor: ACCENT, paddingBottom: 6,
  },
  brand: { flexDirection: 'row', alignItems: 'center', maxWidth: '58%' },
  logo: { height: 36, maxWidth: 96, objectFit: 'contain', marginRight: 10 },
  clinic: { fontSize: 11.5, fontWeight: 700, lineHeight: 1.25 },
  headRight: { alignItems: 'flex-end', flexShrink: 0 },
  title: { fontSize: 16, fontWeight: 700, color: ACCENT, lineHeight: 1.2, marginBottom: 3 },
  headLine: { flexDirection: 'row', fontSize: 8.5, lineHeight: 1.35 },
  headLabel: { color: MUTED, marginRight: 4 },
  headValue: { fontWeight: 700 },
  footer: {
    position: 'absolute', bottom: 18, left: PAGE_X, right: PAGE_X, height: FOOTER_H,
    flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 5,
  },
  footNote: { flex: 1, fontSize: 7, lineHeight: 1.35, color: MUTED, marginRight: 16 },
  // No lineHeight: react-pdf 4.9 draws nothing for a page-number (render) Text that has one. The page numbers cost
  // about 0.6 s on the large passport (react-pdf lays each page out again for them).
  pageNo: { width: 70, fontSize: 8, color: MUTED, textAlign: 'right' },
  heading: {
    fontSize: 12, fontWeight: 700, lineHeight: 1.25, color: ACCENT, marginTop: 12, marginBottom: 6, paddingBottom: 2,
    borderBottomWidth: 0.75, borderBottomColor: LINE,
  },
  subheading: { fontSize: 8.5, fontWeight: 700, lineHeight: 1.3, color: ACCENT, marginTop: 5, marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { paddingRight: 8, marginBottom: 4 },
  label: { fontSize: 6.8, lineHeight: 1.3, color: MUTED },
  value: { fontSize: 8.8, lineHeight: 1.3 },
  missing: { color: MUTED },
  empty: { color: MUTED, fontSize: 9, lineHeight: 1.3 },
  counts: { flexDirection: 'row', marginBottom: 6 },
  count: { flex: 1, borderWidth: 0.75, borderColor: LINE, borderRadius: 3, paddingVertical: 4, paddingHorizontal: 5, marginRight: 4 },
  countValue: { fontSize: 14, fontWeight: 700, lineHeight: 1.2, marginBottom: 1 },
  chart: { alignItems: 'center', marginTop: 4 },
  note: { fontSize: 7.5, lineHeight: 1.3, color: MUTED, marginTop: 4, textAlign: 'center' },
  row: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: LINE, borderLeftWidth: 0.75, borderLeftColor: LINE, borderRightWidth: 0.75, borderRightColor: LINE },
  headRow: { flexDirection: 'row', backgroundColor: SUNKEN, borderWidth: 0.75, borderColor: LINE },
  cell: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 8.5, lineHeight: 1.3 },
  headCell: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 7.5, lineHeight: 1.3, fontWeight: 700, color: MUTED },
  cardTitle: {
    flexDirection: 'row', backgroundColor: SUNKEN, borderRadius: 2,
    paddingVertical: 3, paddingHorizontal: 6, fontSize: 10, fontWeight: 700, lineHeight: 1.3,
  },
  cardBody: { paddingTop: 5, paddingHorizontal: 6 },
  part: { borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 3, marginTop: 1 },
  partHead: { flexDirection: 'row', marginBottom: 2 },
  partName: { fontSize: 8.8, fontWeight: 700, lineHeight: 1.3, marginRight: 6 },
  partRole: { fontSize: 7.5, lineHeight: 1.6, color: MUTED },
  replaced: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 3, marginTop: 1 },
  replacedName: { width: '20%', paddingRight: 6, fontSize: 8.5, fontWeight: 700, lineHeight: 1.3 },
  replacedFields: { width: '80%' },
});

type Style = ComponentProps<typeof View>['style'];

const isMissing = (v: string) => v === L.notRecorded || v === L.noneRecorded;

/** Label above value, `columns` to a row; `wideFirst` gives the first field (a product name) two columns. */
function Fields({ fields, columns, wideFirst = false }: { fields: Field[]; columns: number; wideFirst?: boolean }) {
  // Rounded down: six columns of 16.666…% add up to just over 100% and the last one wraps.
  const col = Math.floor(10000 / columns) / 100;
  return (
    <View style={s.grid}>
      {fields.map((f, i) => (
        <View key={`${f.label}-${i}`} style={[s.field, { width: `${wideFirst && i === 0 ? 2 * col : col}%` }]}>
          <Text style={s.label}>{f.label}</Text>
          <Text style={isMissing(f.value) ? [s.value, s.missing] : s.value}>{f.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

/**
 * The page body as a flat run of unbreakable blocks, all direct children of the Page. react-pdf 4.9 paginates a flat
 * list reliably; an unbreakable block nested inside breakable views was drawn piled up at the foot of a page.
 * `lead` keeps a heading with the first block under it: queued nodes go into the next block.
 */
class Flow {
  readonly blocks: ReactNode[] = [];
  private queued: ReactNode[] = [];

  lead(node: ReactNode): this {
    this.queued.push(node);
    return this;
  }

  block(node: ReactNode, style?: Style): this {
    const k = this.blocks.length;
    this.blocks.push(
      <View key={k} wrap={false} style={style}>
        {this.queued.map((q, i) => <Fragment key={`q${i}`}>{q}</Fragment>)}
        {node}
      </View>,
    );
    this.queued = [];
    return this;
  }
}

function Header({ header }: { header: PassportModel['header'] }) {
  // A PNG or JPEG data URL (printableLogo): react-pdf decodes it itself, no Buffer needed in the browser.
  const logo = header.logo && /^data:image\/(png|jpeg);base64,/.test(header.logo) ? header.logo : null;
  return (
    <View style={s.header} fixed>
      <View style={s.brand}>
        {/* react-pdf draws PNG and JPEG only: a WebP logo is left out rather than failing the passport. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img: it takes no alt. */}
        {logo && <Image style={s.logo} src={logo} />}
        <Text style={s.clinic}>{header.clinicName}</Text>
      </View>
      <View style={s.headRight}>
        <Text style={s.title}>{header.title}</Text>
        <View style={s.headLine}>
          <Text style={s.headLabel}>{L.passportNumber}</Text>
          <Text style={s.headValue}>{header.number}</Text>
        </View>
        <View style={s.headLine}>
          <Text style={s.headLabel}>{L.generatedOn}</Text>
          <Text style={s.headValue}>{header.generatedOn}</Text>
        </View>
      </View>
    </View>
  );
}

function Footer({ note }: { note: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footNote}>{note}</Text>
      <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${L.page} ${pageNumber} ${L.of} ${totalPages}`} />
    </View>
  );
}

function Counts({ counts }: { counts: Field[] }) {
  return (
    <View style={s.counts}>
      {counts.map((c, i) => (
        <View key={c.label} style={i === counts.length - 1 ? [s.count, { marginRight: 0 }] : s.count}>
          <Text style={s.countValue}>{c.value}</Text>
          <Text style={s.label}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

const TABLE_WIDTHS = ['8%', '14%', '25%', '16%', '12%', '13%', '12%'];

function TableRow({ cells, head, odd }: { cells: string[]; head?: boolean; odd?: boolean }) {
  return (
    <View style={head ? s.headRow : odd ? [s.row, { backgroundColor: ZEBRA }] : s.row}>
      {cells.map((c, i) => (
        <Text key={i} style={[head ? s.headCell : s.cell, ...(isMissing(c) ? [s.missing] : []), { width: TABLE_WIDTHS[i] }]}>{c}</Text>
      ))}
    </View>
  );
}

/** A current part (or a case's prosthetic screw): name and role, then its fields across the full width. */
function PartBlock({ part, role, columns = 6 }: { part: Part; role?: string; columns?: number }) {
  return (
    <View style={s.part}>
      <View style={s.partHead}>
        <Text style={s.partName}>{part.name}</Text>
        {role && role !== part.name && <Text style={s.partRole}>{role}</Text>}
      </View>
      <Fields fields={part.fields} columns={columns} wideFirst />
    </View>
  );
}

/** A replaced part: one line, its name beside its fields. */
function ReplacedRow({ part }: { part: Part }) {
  return (
    <View style={s.replaced}>
      <Text style={s.replacedName}>{part.name}</Text>
      <View style={s.replacedFields}><Fields fields={part.fields} columns={4} /></View>
    </View>
  );
}

const CARD_TOP = { marginTop: 8 };
const IN_CARD = { paddingHorizontal: 6 };

function CardTitle({ title }: { title: string }) {
  return <View style={s.cardTitle}><Text>{title}</Text></View>;
}

/** An implant: its title and fields, then its parts. */
function implantBlocks(flow: Flow, implant: ImplantDetail): void {
  flow.lead(<CardTitle title={implant.title} />).lead(<View style={s.cardBody}><Fields fields={implant.fields} columns={4} /></View>);
  const c = implant.components;
  if (!c) {
    flow.block(null, CARD_TOP);
    return;
  }
  // Title and fields stay together (with "None recorded" when nothing is fitted); the parts follow, indented to the card
  // body, and each heading goes with the first part under it.
  if (c.empty) {
    flow.block(<View style={IN_CARD}><Text style={s.subheading}>{c.heading}</Text><Empty text={c.empty} /></View>, CARD_TOP);
    return;
  }
  flow.block(null, CARD_TOP).lead(<Text style={s.subheading}>{c.heading}</Text>);
  for (const g of c.current) for (const p of g.parts) flow.block(<PartBlock part={p} role={g.role} />, IN_CARD);
  c.replaced.forEach((p, i) => {
    if (i === 0) flow.lead(<Text style={s.subheading}>{L.replacedParts}</Text>);
    flow.block(<ReplacedRow part={p} />, IN_CARD);
  });
}

function caseBlocks(flow: Flow, c: CaseDetail): void {
  flow.block(
    <>
      <CardTitle title={c.title} />
      <View style={s.cardBody}>
        <Fields fields={c.fields} columns={3} />
        <Text style={s.subheading}>{L.stages}</Text>
        <Fields fields={c.stages} columns={3} />
      </View>
    </>,
    CARD_TOP,
  );
  flow.lead(<Text style={s.subheading}>{L.prostheticScrews}</Text>);
  if (c.screwsEmpty) flow.block(<Empty text={c.screwsEmpty} />, IN_CARD);
  // Six fields: the product over two columns and the rest on one line.
  for (const p of c.screws) flow.block(<PartBlock part={p} columns={7} />, IN_CARD);
}

export function PassportDocument({ model }: { model: PassportModel }) {
  const { header, patient, medical, overview, implantsTable, implants, restorations, fullArch, footer } = model;
  const flow = new Flow();
  const heading = (text: string) => flow.lead(<Heading>{text}</Heading>);

  heading(patient.heading).block(<Fields fields={patient.fields} columns={4} />);

  if (medical) {
    heading(medical.heading).block(medical.empty ? <Empty text={medical.empty} /> : <Fields fields={medical.fields} columns={3} />);
  }

  heading(overview.heading).block(<Counts counts={overview.counts} />);
  if (overview.chart) {
    flow.block(
      <>
        <PassportChart drawing={overview.chart.drawing} width={CONTENT_WIDTH} />
        <Text style={s.note}>{overview.chart.note}</Text>
      </>,
      s.chart,
    );
  }

  heading(implantsTable.heading);
  if (implantsTable.empty) flow.block(<Empty text={implantsTable.empty} />);
  else {
    // The column heads go with the first row; a row never splits.
    flow.lead(<TableRow cells={implantsTable.columns} head />);
    implantsTable.rows.forEach((r, i) => flow.block(<TableRow cells={r.cells} odd={i % 2 === 1} />));
  }

  if (implants.length) {
    heading(L.implantDetailsHeading);
    for (const imp of implants) implantBlocks(flow, imp);
  }

  heading(restorations.heading);
  if (restorations.empty) flow.block(<Empty text={restorations.empty} />);
  for (const r of restorations.items) {
    flow.block(<><CardTitle title={r.title} /><View style={s.cardBody}><Fields fields={r.fields} columns={4} /></View></>, CARD_TOP);
  }

  heading(fullArch.heading);
  if (fullArch.empty) flow.block(<Empty text={fullArch.empty} />);
  for (const c of fullArch.cases) caseBlocks(flow, c);

  return (
    <Document title={`${header.title} ${header.number}`} author={header.clinicName} language="en">
      <Page size="A4" style={s.page}>
        <Header header={header} />
        <Footer note={footer.note} />
        {flow.blocks}
      </Page>
    </Document>
  );
}
