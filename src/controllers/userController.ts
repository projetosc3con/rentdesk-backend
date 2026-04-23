import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient, supabaseAdmin } from '../config/supabase';

export const getAllUserProfiles = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('users_profiles')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getCurrentUserProfile = async (req: AuthRequest, res: Response) => {
  console.log('[Backend] Recebida requisição GET /users/me para o usuário:', req.user.id);
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('users_profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateUserProfile = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('users_profiles')
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

export const inviteUser = async (req: AuthRequest, res: Response) => {
  console.log('[Backend] Recebida solicitação de convite para:', req.body.email);
  try {
    const { email, full_name, role_title, access_level, cpf, phone, redirectTo } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // 1. Convidar o usuário usando o cliente administrativo
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: redirectTo
    });

    if (inviteError) throw inviteError;

    // 2. Criar ou atualizar o perfil do usuário
    const { error: profileError } = await supabaseAdmin
      .from('users_profiles')
      .upsert({
        id: inviteData.user.id,
        email,
        full_name,
        role_title,
        access_level,
        cpf,
        phone,
        active: true
      });

    if (profileError) throw profileError;

    console.log('[Backend] Convite enviado e perfil criado para:', email);
    return res.json({ success: true, user: inviteData.user });
  } catch (error: any) {
    console.error('[Backend] Erro no convite:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
