import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

let client: AxiosInstance | null = null;

export function initApiClient(baseUrl: string, token: string, userId?: string) {
  const normalizedBase = (baseUrl || '').trim().replace(/\/+$/, '');
  const headers: Record<string, string> = {
    Authorization: token,
  };
  if (userId != null && String(userId).trim() !== '') {
    headers['New-Api-User'] = String(userId).trim();
  }
  client = axios.create({
    baseURL: normalizedBase,
    timeout: 30000,
    headers,
  });

  client.interceptors.request.use((config) => {
    console.log(`[API 请求] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`, {
      params: config.params,
      headers: { Authorization: config.headers.Authorization ? '***已设置***' : '未设置' },
    });
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      console.log(`[API 响应] ${response.status} ${response.config.url}`, {
        success: response.data?.success,
      });
      return response;
    },
    (error: AxiosError) => {
      const detail = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        responseData: error.response?.data,
      };
      console.error('[API 错误]', JSON.stringify(detail, null, 2));
      throw error;
    }
  );
}

function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('API 客户端未初始化，请先配置 API 地址和令牌');
  }
  return client;
}

function formatApiError(err: any): string {
  if (err?.response) {
    const data = err.response.data;
    const serverMsg = data?.message || data?.error || data?.msg || '';
    return `[${err.response.status}] ${serverMsg || err.response.statusText || '请求失败'}`;
  }
  if (err?.code === 'ECONNREFUSED') {
    return '无法连接服务器，请检查 API 地址';
  }
  if (err?.code === 'ENOTFOUND') {
    return '域名解析失败，请检查 API 地址';
  }
  return err?.message || '未知错误';
}

export { formatApiError };

export async function fetchInvoiceList(params: {
  page?: number;
  page_size?: number;
  status?: string;
  keyword?: string;
  search_user_id?: number;
  invoice_category?: string;
  channel_id?: number;
  start_ts?: number;
  end_ts?: number;
}) {
  const res = await getClient().get('/api/invoice/admin', { params });
  return res.data;
}

export async function fetchInvoiceDetail(id: number) {
  const res = await getClient().get(`/api/invoice/admin/${id}`);
  return res.data;
}

/**
 * 验证 PDF 文件完整性，返回错误信息（null 表示验证通过）
 */
function validatePdfBuffer(buffer: Buffer): string | null {
  if (buffer.length < 1024) {
    return `PDF 文件过小 (${buffer.length} bytes)，可能不完整`;
  }
  const header = buffer.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    return `PDF 文件头无效: ${header}`;
  }
  // 检查文件尾：从末尾往前找 %%EOF
  const tail = buffer.subarray(Math.max(0, buffer.length - 128)).toString('ascii');
  if (!tail.includes('%%EOF')) {
    return 'PDF 文件尾缺少 %%EOF 标记，文件可能不完整';
  }
  return null;
}

export async function uploadInvoicePdf(id: number, pdfPath: string, meta?: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) {
  const fileBuffer = fs.readFileSync(pdfPath);

  // 验证 PDF 完整性
  const validationError = validatePdfBuffer(fileBuffer);
  if (validationError) {
    throw new Error(`上传前验证失败: ${validationError}`);
  }

  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: path.basename(pdfPath),
    contentType: 'application/pdf',
  });

  // Pass digital-invoice identifiers to backend for red-flush persistence (only when present)
  if (meta) {
    if (meta.invoice_number) form.append('invoice_number', meta.invoice_number);
    if (meta.invoice_date) form.append('invoice_date', meta.invoice_date);
    if (meta.seller_tax_no) form.append('seller_tax_no', meta.seller_tax_no);
  }

  const headers = form.getHeaders();

  const res = await getClient().post(`/api/invoice/admin/${id}/issue`, form, {
    headers,
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 20 * 1024 * 1024,
  });
  return res.data;
}

export async function sendInvoiceEmail(id: number) {
  const res = await getClient().post(`/api/invoice/admin/${id}/send`);
  return res.data;
}

export async function updateInvoiceStatus(id: number, status: string) {
  const res = await getClient().put(`/api/invoice/admin/${id}/status`, { status });
  return res.data;
}

/** 红冲回写：桌面端在 fa-piao 完成负数开具后调用，回写平台状态并按 allow_reissue 解锁/锁定订单 */
export async function redFlushInvoice(id: number, payload: { allow_reissue: boolean; red_fphm?: string; remark?: string }) {
  const res = await getClient().post(`/api/invoice/admin/${id}/red-flush`, payload);
  return res.data;
}

/** 补填数电发票标识（发票号/开票日期/销方税号），供历史票并入统一红冲 */
export async function updateInvoiceMeta(id: number, payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) {
  const res = await getClient().patch(`/api/invoice/admin/${id}/invoice-meta`, payload);
  return res.data;
}

