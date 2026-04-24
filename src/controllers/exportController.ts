import { Response } from 'express';
import * as XLSX from 'xlsx';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient, supabaseAdmin } from '../config/supabase';

const EXPORT_BUCKET = 'exports';
// Signed URL expires after 5 minutes
const SIGNED_URL_EXPIRES_IN = 300;

export const exportClientsToXlsx = async (req: AuthRequest, res: Response) => {
  try {
    // 1. Fetch all clients using the authenticated user's token (respects RLS)
    const supabase = getSupabaseUserClient(req.token!);
    const { data: clients, error: fetchError } = await supabase
      .from('clients')
      .select('*')
      .order('company_name', { ascending: true });

    if (fetchError) throw fetchError;
    if (!clients || clients.length === 0) {
      return res.status(404).json({ error: 'Nenhum cliente encontrado para exportar.' });
    }

    // 2. Map data to a readable format with Portuguese column headers
    const exportData = clients.map((client) => ({
      'ID': client.id,
      'Empresa / Razão Social': client.company_name,
      'CNPJ': client.cnpj,
      'Inscrição Estadual': client.state_subscription || 'ISENTO',
      'Contato': client.contact_name || '',
      'E-mail': client.email || '',
      'Telefone': client.phone || '',
      'CEP': client.address_zip || '',
      'Endereço': client.address_street || '',
      'Número': client.address_number || '',
      'Complemento': client.address_complement || '',
      'Cidade': client.address_city || '',
      'Estado (UF)': client.address_state || '',
      'Status': client.active ? 'Ativo' : 'Inativo',
      'Criado em': client.created_at
        ? new Date(client.created_at).toLocaleDateString('pt-BR')
        : '',
    }));

    // 3. Build the XLSX workbook
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 38 }, // ID
      { wch: 35 }, // Empresa
      { wch: 20 }, // CNPJ
      { wch: 18 }, // IE
      { wch: 25 }, // Contato
      { wch: 30 }, // E-mail
      { wch: 16 }, // Telefone
      { wch: 12 }, // CEP
      { wch: 35 }, // Endereço
      { wch: 10 }, // Número
      { wch: 20 }, // Complemento
      { wch: 22 }, // Cidade
      { wch: 6  }, // UF
      { wch: 10 }, // Status
      { wch: 14 }, // Criado em
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

    // 4. Write workbook to a Buffer
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 5. Upload to Supabase Storage using admin client (service role bypasses RLS for upload)
    const userEmail = (req.user?.email ?? 'unknown').replace(/[@.]/g, '_');
    const fileName = `clientes_${new Date().toISOString().split('T')[0]}_${userEmail}_${Date.now()}.xlsx`;
    const storagePath = `clients/${fileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(EXPORT_BUCKET)
      .upload(storagePath, xlsxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // 6. Generate a signed URL valid for SIGNED_URL_EXPIRES_IN seconds
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw signedUrlError ?? new Error('Falha ao gerar URL de download.');
    }

    return res.status(200).json({
      downloadUrl: signedUrlData.signedUrl,
      fileName,
      expiresIn: SIGNED_URL_EXPIRES_IN,
      totalRecords: clients.length,
    });
  } catch (error: any) {
    console.error('[exportClientsToXlsx]', error);
    return res.status(500).json({ error: error.message || 'Erro interno ao gerar exportação.' });
  }
};
