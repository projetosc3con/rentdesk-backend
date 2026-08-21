import { FakeSupabaseDb } from './fakeSupabase';

// Cada arquivo de teste precisa do próprio `vi.mock('.../config/supabase', ...)`
// literal (hoisting do vitest exige isso no arquivo que importa o módulo
// mockado) — este helper só reduz o boilerplate de conectar esse mock a uma
// FakeSupabaseDb nova por teste, dado os mocks (`getSupabaseUserClient`,
// `supabaseAdmin`) já importados do módulo mockado.
//
// Uso típico no topo do arquivo de teste:
//   vi.mock('../../config/supabase', () => ({
//     getSupabaseUserClient: vi.fn(),
//     supabaseAdmin: { from: vi.fn() },
//     supabase: {},
//   }));
//   import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
//   ...
//   beforeEach(() => { db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin }); });
// Tipado frouxamente de propósito: `getSupabaseUserClient`/`supabaseAdmin`
// importados num arquivo de teste mantêm o tipo real do módulo (SupabaseClient),
// não o tipo de mock — o vi.mock só troca a implementação em runtime, não a
// assinatura vista pelo TypeScript. Quem chama já sabe que são mocks (o
// arquivo de teste fez `vi.mock('.../config/supabase', ...)` logo acima).
export function installFakeSupabase(mocks: { getSupabaseUserClient: any; supabaseAdmin: any }): FakeSupabaseDb {
  const db = new FakeSupabaseDb();
  const client = db.client();
  mocks.getSupabaseUserClient.mockReturnValue(client);
  mocks.supabaseAdmin.from.mockImplementation(client.from);
  return db;
}
