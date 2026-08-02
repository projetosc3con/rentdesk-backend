export interface InvoiceNfse {
  id: string;
  invoice_id: string;
  gateway: 'asaas';
  external_id: string | null;
  status: string;
  nfse_link: string | null;
  xml_url: string | null;
  service_code: string | null;
  iss_regime: 'Isento' | 'Tributado' | null;
  return_message: string | null;
  created_at: string;
  updated_at: string;
}
