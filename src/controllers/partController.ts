import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient } from '../config/supabase';

export const getAllParts = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .order('internal_code', { ascending: true });

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getPartById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createPart = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { part_number, internal_code } = req.body;

    const conditions = [];
    if (part_number) conditions.push(`part_number.eq.${part_number}`);
    if (internal_code) conditions.push(`internal_code.eq.${internal_code}`);

    if (conditions.length > 0) {
      const { data: existingParts, error: searchError } = await supabase
        .from('parts')
        .select('internal_code, description, part_number')
        .or(conditions.join(','));

      if (searchError) throw searchError;

      if (existingParts && existingParts.length > 0) {
        const existing = existingParts[0];
        return res.status(400).json({
          error: `Uma peça já existe com esses dados:\nCódigo: ${existing.internal_code} | PN: ${existing.part_number || 'N/A'} | ${existing.description}`
        });
      }
    }

    const { data, error } = await supabase
      .from('parts')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updatePart = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('parts')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const deletePart = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { error } = await supabase
      .from('parts')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return res.status(204).send();
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
