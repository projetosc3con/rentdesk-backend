import { supabaseAdmin } from './src/config/supabase';

async function test() {
  console.log('Testing hr_positions...');
  const res1 = await supabaseAdmin.from('hr_positions').select('*').eq('active', true);
  console.log('res1 error:', res1.error?.message);

  console.log('Testing hr_salary_ranges...');
  const res2 = await supabaseAdmin.from('hr_salary_ranges').select('position_id, hr_job_levels(name)');
  console.log('res2 error:', res2.error?.message);

  console.log('Testing hr_employee_positions...');
  const res3 = await supabaseAdmin.from('hr_employee_positions').select('position_id').is('end_date', null);
  console.log('res3 error:', res3.error?.message);
}

test();
