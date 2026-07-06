import { Request, Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';

export const getPositions = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    // Fetch positions
    const { data: positions, error: positionsError } = await supabase
      .from('hr_positions')
      .select('*')
      .eq('active', true)
      .order('title');

    if (positionsError) throw positionsError;

    // Fetch salary ranges to get levels for each position
    const { data: salaryRanges, error: salaryRangesError } = await supabase
      .from('hr_salary_ranges')
      .select('position_id, hr_job_levels(name)');

    if (salaryRangesError) throw salaryRangesError;

    // Fetch employee counts per position
    const { data: employeePositions, error: empPosError } = await supabase
      .from('hr_employee_positions')
      .select('position_id')
      .is('end_date', null);

    if (empPosError) throw empPosError;

    // Process data to match frontend expectations
    const formattedPositions = positions.map((pos: any) => {
      // Find levels for this position
      const posLevels = salaryRanges
        .filter((sr: any) => sr.position_id === pos.id && sr.hr_job_levels)
        .map((sr: any) => sr.hr_job_levels.name);

      // Distinct levels
      const uniqueLevels = [...new Set(posLevels)];

      // Count employees
      const employeeCount = employeePositions.filter((ep: any) => ep.position_id === pos.id).length;

      return {
        id: pos.id,
        name: pos.title,
        department: pos.department,
        levels: uniqueLevels,
        employees: employeeCount
      };
    });

    res.json(formattedPositions);
  } catch (error: any) {
    console.error('Error fetching HR positions:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getLevels = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { data: levels, error } = await supabase
      .from('hr_job_levels')
      .select('*')
      .order('created_at');

    if (error) throw error;

    res.json(levels);
  } catch (error: any) {
    console.error('Error fetching HR levels:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getEmployees = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    // Fetch active users
    const { data: users, error: usersError } = await supabase
      .from('users_profiles')
      .select('id, full_name, email, role_title, photo_url')
      .eq('active', true);

    if (usersError) throw usersError;

    // Fetch current positions for all users
    const { data: currentPositions, error: positionsError } = await supabase
      .from('hr_employee_positions')
      .select('user_id, hr_positions(title, department), hr_job_levels(name)')
      .is('end_date', null)
      .returns<any[]>();

    if (positionsError) throw positionsError;

    // Map users with their positions
    const formattedEmployees = users.map((user: any) => {
      const currentPos = currentPositions.find((cp: any) => cp.user_id === user.id);
      
      return {
        id: user.id,
        name: user.full_name,
        email: user.email,
        photo_url: user.photo_url,
        positionTitle: currentPos?.hr_positions?.title || null,
        department: currentPos?.hr_positions?.department || null,
        levelName: currentPos?.hr_job_levels?.name || null,
      };
    });

    res.json(formattedEmployees);
  } catch (error: any) {
    console.error('Error fetching HR employees:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getRecentActivities = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { data: activities, error } = await supabase
      .from('hr_employee_positions')
      .select('id, start_date, created_at, change_reason, users_profiles!hr_employee_positions_user_id_fkey(full_name), hr_positions(title), hr_job_levels(name)')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    const formattedActivities = activities.map((activity: any) => ({
      id: activity.id,
      employeeName: activity.users_profiles?.full_name || 'Usuário Desconhecido',
      positionTitle: activity.hr_positions?.title || 'Cargo Desconhecido',
      levelName: activity.hr_job_levels?.name || '',
      date: activity.start_date,
      reason: activity.change_reason || 'Nova Atribuição'
    }));

    res.json(formattedActivities);
  } catch (error: any) {
    console.error('Error fetching HR recent activities:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getPositionHistory = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { data: allHistory, error } = await supabase
      .from('hr_employee_positions')
      .select('id, user_id, start_date, change_reason, users_profiles!hr_employee_positions_user_id_fkey(full_name), hr_positions(title), hr_job_levels(name)')
      .order('start_date', { ascending: true });

    if (error) throw error;

    const historyByUser: Record<string, any[]> = {};
    
    allHistory.forEach((record: any) => {
      const userId = record.user_id;
      if (!historyByUser[userId]) {
        historyByUser[userId] = [];
      }
      historyByUser[userId].push(record);
    });

    const formattedHistory: any[] = [];

    for (const userId in historyByUser) {
      const userRecords = historyByUser[userId];
      for (let i = 0; i < userRecords.length; i++) {
        const current = userRecords[i];
        
        let oldPos = '-';
        if (i > 0) {
          const prev = userRecords[i - 1];
          oldPos = `${prev.hr_positions?.title || ''} ${prev.hr_job_levels?.name ? `- ${prev.hr_job_levels.name}` : ''}`.trim();
        }

        const newPos = `${current.hr_positions?.title || ''} ${current.hr_job_levels?.name ? `- ${current.hr_job_levels.name}` : ''}`.trim();

        formattedHistory.push({
          id: current.id,
          employee: current.users_profiles?.full_name || 'Desconhecido',
          oldPos: oldPos,
          newPos: newPos,
          date: current.start_date,
          type: current.change_reason || 'Nova Atribuição',
        });
      }
    }

    formattedHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json(formattedHistory);
  } catch (error: any) {
    console.error('Error fetching HR position history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getDocumentTypes = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { data, error } = await supabase
      .from('hr_document_types')
      .select('*')
      .order('name');

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching HR document types:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const createDocumentType = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { name, description, requires_expiry, alert_days_before, mandatory, active } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { data, error } = await supabase
      .from('hr_document_types')
      .insert([
        {
          name,
          description,
          requires_expiry,
          alert_days_before,
          mandatory,
          active
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating HR document type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const updateDocumentType = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);
    const { id } = req.params;

    const { name, description, requires_expiry, alert_days_before, mandatory, active } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { data, error } = await supabase
      .from('hr_document_types')
      .update({
        name,
        description,
        requires_expiry,
        alert_days_before,
        mandatory,
        active,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error updating HR document type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const createPosition = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);

    const { title, department, cbo_code, description, salaryRanges, documentTypes } = req.body;

    if (!title || !department) {
      return res.status(400).json({ error: 'Title and department are required' });
    }

    // 1. Insert position
    const { data: positionData, error: positionError } = await supabase
      .from('hr_positions')
      .insert([{ title, department, cbo_code, description }])
      .select('id')
      .single();

    if (positionError) throw positionError;
    const positionId = positionData.id;

    // 2. Insert salary ranges if provided
    if (salaryRanges && salaryRanges.length > 0) {
      const rangesToInsert = salaryRanges.map((range: any) => ({
        position_id: positionId,
        level_id: range.level_id,
        salary_min: range.salary_min || 0,
        salary_mid: range.salary_mid || null,
        salary_max: range.salary_max || 0,
        effective_date: new Date().toISOString().split('T')[0], // Today's date
      }));

      const { error: rangesError } = await supabase
        .from('hr_salary_ranges')
        .insert(rangesToInsert);

      if (rangesError) throw rangesError;
    }

    // 3. Insert document types if provided
    if (documentTypes && documentTypes.length > 0) {
      const docsToInsert = documentTypes.map((doc: any) => ({
        position_id: positionId,
        document_type_id: doc.document_type_id,
        mandatory: doc.mandatory !== undefined ? doc.mandatory : true,
      }));

      const { error: docsError } = await supabase
        .from('hr_position_document_types')
        .insert(docsToInsert);

      if (docsError) throw docsError;
    }

    res.status(201).json({ id: positionId, message: 'Position created successfully' });
  } catch (error: any) {
    console.error('Error creating HR position:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const getPositionById = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);
    const { id } = req.params;

    // 1. Get position basic data
    const { data: position, error: posError } = await supabase
      .from('hr_positions')
      .select('*')
      .eq('id', id)
      .single();

    if (posError) throw posError;

    // 2. Get salary ranges with level info
    const { data: ranges, error: rangesError } = await supabase
      .from('hr_salary_ranges')
      .select('id, level_id, salary_min, salary_mid, salary_max, effective_date, hr_job_levels(id, name)')
      .eq('position_id', id);

    if (rangesError) throw rangesError;

    // 3. Get associated document types
    const { data: docAssocs, error: docsError } = await supabase
      .from('hr_position_document_types')
      .select('id, document_type_id, mandatory')
      .eq('position_id', id);

    if (docsError) throw docsError;

    res.json({
      ...position,
      salaryRanges: ranges,
      documentTypes: docAssocs,
    });
  } catch (error: any) {
    console.error('Error fetching HR position by ID:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

export const updatePosition = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseUserClient(token);
    const { id } = req.params;

    const { title, department, cbo_code, description, salaryRanges, documentTypes } = req.body;

    if (!title || !department) {
      return res.status(400).json({ error: 'Title and department are required' });
    }

    // 1. Update position basic data
    const { error: posError } = await supabase
      .from('hr_positions')
      .update({ title, department, cbo_code, description, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (posError) throw posError;

    // 2. Replace salary ranges: delete old, insert new
    const { error: delRangesError } = await supabase
      .from('hr_salary_ranges')
      .delete()
      .eq('position_id', id);

    if (delRangesError) throw delRangesError;

    if (salaryRanges && salaryRanges.length > 0) {
      const rangesToInsert = salaryRanges.map((range: any) => ({
        position_id: id,
        level_id: range.level_id,
        salary_min: range.salary_min || 0,
        salary_mid: range.salary_mid || null,
        salary_max: range.salary_max || 0,
        effective_date: new Date().toISOString().split('T')[0],
      }));

      const { error: insertRangesError } = await supabase
        .from('hr_salary_ranges')
        .insert(rangesToInsert);

      if (insertRangesError) throw insertRangesError;
    }

    // 3. Replace document type associations: delete old, insert new
    const { error: delDocsError } = await supabase
      .from('hr_position_document_types')
      .delete()
      .eq('position_id', id);

    if (delDocsError) throw delDocsError;

    if (documentTypes && documentTypes.length > 0) {
      const docsToInsert = documentTypes.map((doc: any) => ({
        position_id: id,
        document_type_id: doc.document_type_id,
        mandatory: doc.mandatory !== undefined ? doc.mandatory : true,
      }));

      const { error: insertDocsError } = await supabase
        .from('hr_position_document_types')
        .insert(docsToInsert);

      if (insertDocsError) throw insertDocsError;
    }

    res.json({ id, message: 'Position updated successfully' });
  } catch (error: any) {
    console.error('Error updating HR position:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
