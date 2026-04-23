import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient } from '../config/supabase';

export const getAllServiceOrders = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('service_orders')
      .select('*, service_order_parts(*, parts(*))')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getServiceOrderById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('service_orders')
      .select('*, service_order_parts(*, parts(*))')
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createServiceOrder = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { parts, ...osData } = req.body;

    // 1. Create the Service Order
    const { data: os, error: osError } = await supabase
      .from('service_orders')
      .insert([osData])
      .select()
      .single();

    if (osError) throw osError;

    // 2. Update equipment status to 'Em Manutenção'
    if (osData.equipment_id) {
        await supabase
            .from('equipments')
            .update({ status: 'Em Manutenção' })
            .eq('id', osData.equipment_id);
    }

    // 3. Add parts if provided
    if (parts && Array.isArray(parts) && parts.length > 0) {
        const partsToInsert = parts.map(p => ({
            service_order_id: os.id,
            part_id: p.part_id,
            quantity_used: p.quantity_used,
            unit_value_at_use: p.unit_value_at_use
        }));

        const { error: partsError } = await supabase
            .from('service_order_parts')
            .insert(partsToInsert);

        if (partsError) throw partsError;

        // 4. Update parts stock
        for (const p of parts) {
            const { data: part } = await supabase.from('parts').select('quantity').eq('id', p.part_id).single();
            if (part) {
                await supabase
                    .from('parts')
                    .update({ quantity: part.quantity - p.quantity_used })
                    .eq('id', p.part_id);
            }
        }
    }

    return res.status(201).json(os);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateServiceOrderStatus = async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const supabase = getSupabaseUserClient(req.token!);
        
        const { data: os, error: osError } = await supabase
            .from('service_orders')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (osError) throw osError;

        // If OS is concluded, update equipment status back to 'Disponível' (or logic could be more complex)
        if (status === 'Concluída' && os.equipment_id) {
            await supabase
                .from('equipments')
                .update({ status: 'Disponível' })
                .eq('id', os.equipment_id);
        }

        return res.json(os);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const deleteServiceOrder = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { error } = await supabase
      .from('service_orders')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return res.status(204).send();
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
