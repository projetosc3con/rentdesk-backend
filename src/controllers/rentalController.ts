import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient } from '../config/supabase';

export const getAllInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('rental_invoices')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getInvoiceById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('rental_invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    
    // Business logic: Calculate total value if provided individual costs
    const { 
      cost_rental = 0, 
      cost_insurance = 0, 
      cost_freight = 0, 
      cost_rcd = 0, 
      cost_third_party = 0, 
      cost_training = 0 
    } = req.body;

    const total_value = 
      Number(cost_rental) + 
      Number(cost_insurance) + 
      Number(cost_freight) + 
      Number(cost_rcd) + 
      Number(cost_third_party) + 
      Number(cost_training);

    const invoiceData = {
      ...req.body,
      total_value: total_value
    };

    const { data, error } = await supabase
      .from('rental_invoices')
      .insert([invoiceData])
      .select()
      .single();

    if (error) throw error;

    // Side effect: If return_date is set, update equipment status to 'Disponível'
    if (invoiceData.return_date && invoiceData.equipment_id) {
        await supabase
            .from('equipments')
            .update({ status: 'Disponível' })
            .eq('id', invoiceData.equipment_id);
    } else if (invoiceData.equipment_id) {
        // If it's a new rental without return date, equipment becomes 'Locado'
        await supabase
            .from('equipments')
            .update({ status: 'Locado' })
            .eq('id', invoiceData.equipment_id);
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    
    // Recalculate total if costs changed
    const { 
      cost_rental, 
      cost_insurance, 
      cost_freight, 
      cost_rcd, 
      cost_third_party, 
      cost_training 
    } = req.body;

    let updateData = { ...req.body };

    if (cost_rental !== undefined || cost_insurance !== undefined || cost_freight !== undefined) {
        // Fetch current values for missing ones
        const { data: current } = await supabase.from('rental_invoices').select('*').eq('id', id).single();
        if (current) {
            const total_value = 
              Number(cost_rental ?? current.cost_rental ?? 0) + 
              Number(cost_insurance ?? current.cost_insurance ?? 0) + 
              Number(cost_freight ?? current.cost_freight ?? 0) + 
              Number(cost_rcd ?? current.cost_rcd ?? 0) + 
              Number(cost_third_party ?? current.cost_third_party ?? 0) + 
              Number(cost_training ?? current.cost_training ?? 0);
            updateData.total_value = total_value;
        }
    }

    const { data, error } = await supabase
      .from('rental_invoices')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Side effect logic for equipment status
    if (updateData.return_date && data.equipment_id) {
        await supabase
            .from('equipments')
            .update({ status: 'Disponível' })
            .eq('id', data.equipment_id);
    }

    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { error } = await supabase
      .from('rental_invoices')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return res.status(204).send();
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
