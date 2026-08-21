import { SupabaseClient } from '@supabase/supabase-js';

export interface StockMovementPayload {
  part_id: string;
  movement_type: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
  quantity: number;
  unit_value?: number;
  previous_stock: number;
  new_stock: number;
  reference_type: 'NFE_IMPORT' | 'SERVICE_ORDER' | 'MANUAL_ADJUSTMENT';
  reference_id?: string | null;
  reference_label?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

export async function recordStockMovement(
  supabase: SupabaseClient,
  payload: StockMovementPayload
) {
  try {
    const movementData = {
      part_id: payload.part_id,
      movement_type: payload.movement_type,
      quantity: Number(payload.quantity),
      unit_value: payload.unit_value != null ? Number(payload.unit_value) : 0,
      previous_stock: Number(payload.previous_stock),
      new_stock: Number(payload.new_stock),
      reference_type: payload.reference_type,
      reference_id: payload.reference_id || null,
      reference_label: payload.reference_label || null,
      notes: payload.notes || null,
      created_by: payload.created_by || null,
    };

    const { data, error } = await supabase
      .from('stock_movements')
      .insert(movementData)
      .select()
      .single();

    if (error) {
      console.error('[recordStockMovement] Erro ao gravar movimentação de estoque:', error);
      throw error;
    }

    return data;
  } catch (err: any) {
    console.error('[recordStockMovement] Falha na auditoria de movimentação:', err);
    // Do not crash the entire request if audit logging fails, but log clearly
    return null;
  }
}

export async function getStockMovements(
  supabase: SupabaseClient,
  filters: { part_id?: string; reference_type?: string; limit?: number } = {}
) {
  let query = supabase
    .from('stock_movements')
    .select('*, part:parts(internal_code, description, category, unit), creator:users_profiles(id, full_name, email)')
    .order('created_at', { ascending: false });

  if (filters.part_id) {
    query = query.eq('part_id', filters.part_id);
  }

  if (filters.reference_type) {
    query = query.eq('reference_type', filters.reference_type);
  }

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
