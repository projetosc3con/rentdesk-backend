import { randomUUID } from 'crypto';

type Row = Record<string, any>;
type Predicate = (row: Row) => boolean;
type OpType = 'select' | 'insert' | 'update';

interface EmbedRelation {
  table: string;
  fk: string;
}

// Só as relações efetivamente usadas em selects embutidos (`alias:table(cols)`)
// dentro do escopo do módulo Financeiro (ver bill/payment controllers). O FK
// nem sempre segue o nome da tabela-alvo (payments.invoice_id -> rental_invoices),
// por isso o mapeamento é explícito em vez de inferido por convenção.
const EMBED_RELATIONS: Record<string, Record<string, EmbedRelation>> = {
  bills: {
    invoice: { table: 'rental_invoices', fk: 'rental_invoice_id' },
    client: { table: 'clients', fk: 'client_id' },
    payment: { table: 'payments', fk: 'payment_id' },
  },
  payments: {
    invoice: { table: 'rental_invoices', fk: 'invoice_id' },
  },
};

function matchOp(rowVal: any, op: string, val: any): boolean {
  if (op === 'in') {
    const list = typeof val === 'string' ? val.replace(/^\(|\)$/g, '').split(',') : val;
    return list.includes(rowVal);
  }
  // 'is' e 'eq' têm a mesma semântica de igualdade estrita pro que a suíte precisa.
  return rowVal === val;
}

function parseSelect(select: string): { plain: string[] | '*'; embeds: { alias: string; table: string; columns: string[] }[] } {
  const embeds: { alias: string; table: string; columns: string[] }[] = [];
  const embedRe = /(\w+):(\w+)\(([^)]*)\)/g;
  let rest = select;
  let m: RegExpExecArray | null;
  while ((m = embedRe.exec(select))) {
    embeds.push({ alias: m[1], table: m[2], columns: m[3].split(',').map((c) => c.trim()).filter(Boolean) });
    rest = rest.replace(m[0], '');
  }
  const hasStar = rest.includes('*');
  const plainCols = rest.split(',').map((c) => c.trim()).filter((c) => c && c !== '*');
  return { plain: hasStar ? '*' : plainCols, embeds };
}

export class FakeSupabaseDb {
  private tables: Record<string, Row[]> = {};
  private forcedErrors: { table: string; op: OpType; error: any; sideEffect?: () => void }[] = [];

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map((r) => ({ ...r }));
    return this;
  }

  getTable(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  clear() {
    this.tables = {};
    this.forcedErrors = [];
  }

  // Hook explícito pra simular falhas que não dá pra reproduzir só com dados
  // em memória (violação de constraint, erro de rede, etc.) — usado por
  // exemplo pra reproduzir a corrida documentada em createChargeForInvoice
  // (dois inserts simultâneos, o segundo recebe 23505 do Postgres). O
  // `sideEffect` opcional roda no exato momento em que o erro é consumido —
  // permite simular "a outra requisição da corrida terminou primeiro"
  // inserindo a linha vencedora só depois que a checagem de idempotência
  // inicial já rodou, sem precisar de concorrência real no teste.
  forceNextError(table: string, op: OpType, error: any, sideEffect?: () => void) {
    this.forcedErrors.push({ table, op, error, sideEffect });
    return this;
  }

  consumeForcedError(table: string, op: OpType): any {
    const idx = this.forcedErrors.findIndex((f) => f.table === table && f.op === op);
    if (idx === -1) return null;
    const [f] = this.forcedErrors.splice(idx, 1);
    f.sideEffect?.();
    return f.error;
  }

  projectRow(table: string, row: Row, selectStr: string): Row {
    const { plain, embeds } = parseSelect(selectStr);
    const base: Row = plain === '*' ? { ...row } : Object.fromEntries(plain.map((c) => [c, row[c]]));
    for (const embed of embeds) {
      const relation = EMBED_RELATIONS[table]?.[embed.alias];
      if (!relation) {
        base[embed.alias] = null;
        continue;
      }
      const fkVal = row[relation.fk];
      const targetRow = fkVal != null ? this.getTable(relation.table).find((r) => r.id === fkVal) : null;
      base[embed.alias] = targetRow ? Object.fromEntries(embed.columns.map((c) => [c, targetRow[c]])) : null;
    }
    return base;
  }

  client(): any {
    return { from: (table: string) => new FakeQueryBuilder(this, table) };
  }
}

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private predicates: Predicate[] = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private op: OpType = 'select';
  private payload: any = null;
  private selectStr: string | null = null;
  private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';

  constructor(private db: FakeSupabaseDb, private table: string) {}

  select(cols: string = '*') {
    this.selectStr = cols;
    return this;
  }
  insert(payload: any) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  eq(col: string, val: any) {
    this.predicates.push((r) => r[col] === val);
    return this;
  }
  gte(col: string, val: any) {
    this.predicates.push((r) => r[col] != null && r[col] >= val);
    return this;
  }
  lte(col: string, val: any) {
    this.predicates.push((r) => r[col] != null && r[col] <= val);
    return this;
  }
  is(col: string, val: any) {
    this.predicates.push((r) => matchOp(r[col], 'is', val));
    return this;
  }
  not(col: string, op: string, val: any) {
    this.predicates.push((r) => !matchOp(r[col], op, val));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderSpec = { column: col, ascending: opts.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = 'single';
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }

  private async execute(): Promise<{ data: any; error: any }> {
    const forced = this.db.consumeForcedError(this.table, this.op);
    if (forced) return { data: null, error: forced };

    const table = this.db.getTable(this.table);

    if (this.op === 'select') {
      let rows = table.filter((r) => this.predicates.every((p) => p(r)));
      if (this.orderSpec) {
        const { column, ascending } = this.orderSpec;
        rows = [...rows].sort((a, b) => {
          if (a[column] === b[column]) return 0;
          if (a[column] == null) return 1;
          if (b[column] == null) return -1;
          return ascending ? (a[column] < b[column] ? -1 : 1) : (a[column] > b[column] ? -1 : 1);
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      const projected = rows.map((r) => this.db.projectRow(this.table, r, this.selectStr ?? '*'));
      return this.finalize(projected);
    }

    if (this.op === 'insert') {
      const items: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: Row[] = [];
      for (const item of items) {
        const now = new Date().toISOString();
        const row: Row = { id: randomUUID(), created_at: now, updated_at: now, ...item };
        table.push(row);
        inserted.push(row);
      }
      if (!this.selectStr) return { data: null, error: null };
      const projected = inserted.map((r) => this.db.projectRow(this.table, r, this.selectStr!));
      return this.finalize(projected);
    }

    // update
    const matched = table.filter((r) => this.predicates.every((p) => p(r)));
    for (const row of matched) Object.assign(row, this.payload, { updated_at: new Date().toISOString() });
    if (!this.selectStr) return { data: null, error: null };
    const projected = matched.map((r) => this.db.projectRow(this.table, r, this.selectStr!));
    return this.finalize(projected);
  }

  private finalize(data: Row[]): { data: any; error: any } {
    if (this.singleMode === 'single') {
      if (data.length !== 1) {
        return {
          data: null,
          error: { code: data.length === 0 ? 'PGRST116' : 'MULTIPLE_ROWS', message: 'JSON object requested, multiple (or no) rows returned' },
        };
      }
      return { data: data[0], error: null };
    }
    if (this.singleMode === 'maybeSingle') {
      if (data.length > 1) return { data: null, error: { code: 'MULTIPLE_ROWS', message: 'multiple rows returned' } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }
}
