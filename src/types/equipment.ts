export interface Equipment {
  id: string;
  asset_number: string;
  name: string;
  type: string;
  model: string;
  serial_number: string;
  height: number;
  status: 'Disponível' | 'Locado' | 'Em Manutenção' | 'Inativo';
  manufacture_year: number;
  value: number;
  unit: string;
  photo_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}
