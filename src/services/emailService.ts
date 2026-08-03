import axios, { AxiosInstance } from 'axios';

const RESEND_BASE_URL = 'https://api.resend.com';

interface BoletoEmailParams {
  to: string;
  clientName: string;
  companyName: string;
  totalValue: number;
  dueDate: string;
  invoiceUrl: string;
  bankSlipUrl?: string | null;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function buildBoletoEmailTemplate(params: BoletoEmailParams, replyTo: string): string {
  const paymentLink = params.invoiceUrl || params.bankSlipUrl || '#';
  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#1f2937;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;">${params.companyName}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;color:#111827;font-size:16px;">Olá, ${params.clientName},</p>
                <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.5;">
                  Seu boleto de locação foi gerado. Confira os detalhes abaixo e efetue o pagamento até a data de vencimento.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin-bottom:24px;">
                  <tr>
                    <td style="padding:16px 20px;">
                      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;">Valor</p>
                      <p style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:bold;">${formatCurrency(params.totalValue)}</p>
                      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;">Vencimento</p>
                      <p style="margin:0;color:#111827;font-size:14px;">${formatDate(params.dueDate)}</p>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <a href="${paymentLink}" style="display:inline-block;background-color:#d97706;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 28px;border-radius:8px;">
                        Ver boleto
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
                  Se você já efetuou o pagamento, desconsidere este e-mail.
                </p>
                <p style="margin:8px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
                  Este é um e-mail automático, não responda a esta mensagem. Em caso de dúvidas, entre em contato pelo e-mail ${replyTo}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

class EmailService {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: RESEND_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async sendBoletoEmail(params: BoletoEmailParams): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY não configurada');

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'RentDesk <onboarding@resend.dev>';
    // Sem domínio verificado no Resend, o modo de teste só entrega para o
    // e-mail da própria conta — EMAIL_TEST_OVERRIDE redireciona todo envio
    // pra esse endereço em vez do e-mail real do cliente.
    const to = process.env.EMAIL_TEST_OVERRIDE || params.to;

    // altomaster.com.br (domínio verificado no Resend, usado em fromEmail) só
    // envia — não tem caixa de entrada configurada, então qualquer resposta
    // do cliente se perderia. reply_to redireciona a resposta pra uma caixa
    // que existe de fato.
    const replyTo = process.env.RESEND_REPLY_TO_EMAIL || 'locacao@altomaster.net';

    await this.http.post(
      '/emails',
      {
        from: fromEmail,
        to: [to],
        reply_to: replyTo,
        subject: `Boleto de locação - ${params.companyName}`,
        html: buildBoletoEmailTemplate(params, replyTo),
      },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
  }
}

export const emailService = new EmailService();
