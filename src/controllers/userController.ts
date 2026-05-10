import { Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient, supabaseAdmin } from '../config/supabase';
import crypto from 'crypto';

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

/**
 * Pré-cadastro de usuário (sem envio de e-mail).
 * O admin cria o perfil + auth user silenciosamente.
 * O usuário completa o cadastro no primeiro acesso via tela de login.
 */
export const preRegisterUser = async (req: AuthRequest, res: Response) => {
  console.log('[Backend] Pré-cadastro de usuário:', req.body.email);
  try {
    const { email, full_name, role_title, access_level, cpf, phone } = req.body;

    if (!email || !full_name) {
      return res.status(400).json({ error: 'Email e nome completo são obrigatórios.' });
    }

    // Gera uma senha temporária aleatória (o usuário nunca saberá)
    const tempPassword = crypto.randomBytes(32).toString('hex');

    // 1. Cria o auth user silenciosamente (sem envio de email)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // Marca o e-mail como confirmado automaticamente
      user_metadata: { full_name }
    });

    if (authError) throw authError;

    // 2. Cria o perfil vinculado ao auth user
    const { error: profileError } = await supabaseAdmin
      .from('users_profiles')
      .upsert({
        id: authData.user.id,
        email,
        full_name,
        role_title,
        access_level,
        cpf,
        phone,
        active: true,
        password_set: false // Marca que o usuário ainda não definiu sua senha real
      });

    if (profileError) throw profileError;

    console.log('[Backend] Pré-cadastro concluído para:', email);
    return res.json({ success: true, user: authData.user });
  } catch (error: any) {
    console.error('[Backend] Erro no pré-cadastro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Endpoint PÚBLICO (sem autenticação).
 * Verifica se um e-mail existe em users_profiles com active=true e password_set=false.
 */
export const checkEmailForSignup = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório.' });
    }

    const { data, error } = await supabaseAdmin
      .from('users_profiles')
      .select('id, full_name, email, active, password_set')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) throw error;

    // Não encontrado ou inativo
    if (!data || !data.active) {
      return res.json({ authorized: false, message: 'E-mail não autorizado no sistema.' });
    }

    // Já completou o cadastro
    if (data.password_set) {
      return res.json({ authorized: false, message: 'Este usuário já possui cadastro ativo. Utilize a tela de login.' });
    }

    // Autorizado para primeiro acesso
    return res.json({
      authorized: true,
      profile: {
        id: data.id,
        full_name: data.full_name,
        email: data.email
      }
    });
  } catch (error: any) {
    console.error('[Backend] Erro ao verificar email:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Endpoint PÚBLICO (sem autenticação).
 * Completa o cadastro: atualiza a senha do auth user e marca password_set=true.
 */
export const completeSignup = async (req: Request, res: Response) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    // 1. Buscar o perfil para obter o auth user ID
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users_profiles')
      .select('id, active, password_set')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile || !profile.active) {
      return res.status(403).json({ error: 'E-mail não autorizado no sistema.' });
    }

    if (profile.password_set) {
      return res.status(400).json({ error: 'Este usuário já completou o cadastro.' });
    }

    // 2. Atualizar a senha do auth user
    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
      profile.id,
      { password }
    );

    if (authUpdateError) throw authUpdateError;

    // 3. Atualizar o perfil: password_set = true e nome (caso alterado)
    const { error: updateError } = await supabaseAdmin
      .from('users_profiles')
      .update({
        password_set: true,
        full_name: full_name || undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', profile.id);

    if (updateError) throw updateError;

    console.log('[Backend] Primeiro acesso concluído para:', email);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Backend] Erro ao completar cadastro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
