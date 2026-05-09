import { Request, Response, NextFunction } from 'express';
import { supabase, getSupabaseUserClient } from '../config/supabase';

export interface AuthRequest extends Request {
  user?: any;
  profile?: any;
  token?: string;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch user profile to get access_level using the user's JWT
    const userClient = getSupabaseUserClient(token);
    const { data: profile, error: profileError } = await userClient
      .from('users_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[Auth] Erro ao buscar perfil:', profileError);
      return res.status(403).json({ error: 'User profile not found' });
    }

    req.user = user;
    req.profile = profile;
    req.token = token;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Authentication error' });
  }
};

export const authorize = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.profile || !req.profile.access_level) {
      return res.status(403).json({ error: 'Access level not defined for this user' });
    }

    if (!allowedRoles.includes(req.profile.access_level)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};
