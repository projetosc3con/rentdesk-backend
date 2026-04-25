import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient } from '../config/supabase';

export const getDashboardData = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    // ── 1. Monthly billing (current month) based on bank_reconciliation_date ──
    const startOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0); // last day
    const endOfMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`;

    const { data: currentMonthData } = await supabase
      .from('rental_invoices')
      .select('total_value')
      .eq('reconciliation_status', 'Recebido')
      .gte('bank_reconciliation_date', startOfMonth)
      .lte('bank_reconciliation_date', endOfMonthStr);

    const currentMonthTotal = (currentMonthData || []).reduce((acc, r) => acc + Number(r.total_value || 0), 0);

    // Previous month
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const startOfPrevMonth = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    const endOfPrevMonth = new Date(prevYear, prevMonth + 1, 0);
    const endOfPrevMonthStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(endOfPrevMonth.getDate()).padStart(2, '0')}`;

    const { data: prevMonthData } = await supabase
      .from('rental_invoices')
      .select('total_value')
      .eq('reconciliation_status', 'Recebido')
      .gte('bank_reconciliation_date', startOfPrevMonth)
      .lte('bank_reconciliation_date', endOfPrevMonthStr);

    const prevMonthTotal = (prevMonthData || []).reduce((acc, r) => acc + Number(r.total_value || 0), 0);

    const variation = prevMonthTotal > 0
      ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100
      : currentMonthTotal > 0 ? 100 : 0;

    // ── 2. Pending reconciliation count ──
    const { count: pendingReconciliationCount } = await supabase
      .from('rental_invoices')
      .select('*', { count: 'exact', head: true })
      .in('reconciliation_status', ['No prazo', 'Atrasado']);

    // ── 3. Equipment with status "Locado" ──
    const { count: rentedEquipmentCount } = await supabase
      .from('equipments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Locado');

    // ── 4. Service orders count ──
    const { count: serviceOrderCount } = await supabase
      .from('service_orders')
      .select('*', { count: 'exact', head: true });

    // ── 5. Revenue last 6 months (for chart) ──
    const revenueByMonth: { month: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const mYear = d.getFullYear();
      const mMonth = d.getMonth();
      const mStart = `${mYear}-${String(mMonth + 1).padStart(2, '0')}-01`;
      const mEndDate = new Date(mYear, mMonth + 1, 0);
      const mEnd = `${mYear}-${String(mMonth + 1).padStart(2, '0')}-${String(mEndDate.getDate()).padStart(2, '0')}`;

      const { data: mData } = await supabase
        .from('rental_invoices')
        .select('total_value')
        .eq('reconciliation_status', 'Recebido')
        .gte('bank_reconciliation_date', mStart)
        .lte('bank_reconciliation_date', mEnd);

      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      revenueByMonth.push({
        month: `${mYear}-${String(mMonth + 1).padStart(2, '0')}`,
        label: monthNames[mMonth],
        total: (mData || []).reduce((acc, r) => acc + Number(r.total_value || 0), 0),
      });
    }

    // ── 6. Fleet status (equipment grouped by status) ──
    const { data: allEquipments } = await supabase
      .from('equipments')
      .select('status');

    const fleetStatus = {
      disponivel: 0,
      locado: 0,
      manutencao: 0,
      inativo: 0,
      total: 0,
    };

    (allEquipments || []).forEach((eq: any) => {
      fleetStatus.total++;
      switch (eq.status) {
        case 'Disponível': fleetStatus.disponivel++; break;
        case 'Locado': fleetStatus.locado++; break;
        case 'Em Manutenção': fleetStatus.manutencao++; break;
        case 'Inativo': fleetStatus.inativo++; break;
      }
    });

    // ── 7. Last 5 invoices by due_date (most recent first), ignoring null due_date ──
    const { data: recentInvoices } = await supabase
      .from('rental_invoices')
      .select('id, client_name, equipment_name, asset_number, due_date, total_value, billing_status')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: false })
      .limit(5);

    return res.json({
      kpis: {
        currentMonthTotal,
        prevMonthTotal,
        variation: Math.round(variation * 10) / 10,
        pendingReconciliationCount: pendingReconciliationCount || 0,
        rentedEquipmentCount: rentedEquipmentCount || 0,
        serviceOrderCount: serviceOrderCount || 0,
      },
      revenueByMonth,
      fleetStatus,
      recentInvoices: recentInvoices || [],
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
