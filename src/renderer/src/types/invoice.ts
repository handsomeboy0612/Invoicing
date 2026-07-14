export interface ChannelDetail {
  channel_id: number;
  channel_name: string;
  count: number;
  amount: number;
  order_nos: string[];
  order_details: { order_no: string; amount: number }[];
}

export interface InvoiceRecord {
  id: number;
  user_id: number;
  identity_verify_id: number;
  invoice_type: string;
  invoice_category: string;
  recharge_amount: number;
  title: string;
  taxpayer_id: string;
  legal_person_name: string;
  bank_name: string;
  bank_account: string;
  register_address: string;
  register_phone: string;
  invoice_remark: string;
  receive_email: string;
  order_nos: string;
  channel_ids: string;
  channel_details?: ChannelDetail[];
  status: string;
  invoice_pdf_url: string;
  invoice_number?: string;
  invoice_date?: string;
  seller_tax_no?: string;
  created_at: number;
  updated_at: number;
  username?: string;
  channel_names?: string;
  agent_level?: string;
  parent_agent?: string;
}

export interface InvoiceListResponse {
  page: number;
  page_size: number;
  total: number;
  items: InvoiceRecord[];
  can_operate: boolean;
  show_agent_columns: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
}

export interface AppSettings {
  apiBaseUrl: string;
  apiToken: string;
  apiUserId: string;
  chromePath: string;
  downloadDir: string;
}

/** 数电发票开票商品行 */
export interface TaxInvoiceItem {
  fphxz: string;
  spmc: string;
  ggxh?: string;
  dw?: string;
  spsl?: string | number;
  dj?: string | number;
  je: string | number;
  sl: string | number;
  se: string | number;
  hsbz: string | number;
  spbm: string;
  yhzcbs?: string;
  lslbs?: string | number;
  zzstsgl?: string;
}

export const InvoiceStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待开票', color: 'orange' },
  issued: { label: '已开票', color: 'green' },
  sent: { label: '已寄送', color: 'blue' },
  returned: { label: '已退回', color: 'red' },
  red_locked: { label: '冲红锁定', color: 'grey' },
  red_flushed: { label: '已红冲', color: 'purple' },
};

export const InvoiceCategoryMap: Record<string, string> = {
  personal: '个人',
  enterprise: '企业',
};

/**
 * 开票表单四项与列表接口 /api/invoice/admin 返回字段的对应关系：
 * - 名称（购方名称）     → title
 * - 统一社会信用代码/纳税人识别号 → taxpayer_id
 * - 项目名称           → 默认 "*软件测试服务*技术服务费"，可开票前修改
 * - 金额（含税）        → recharge_amount
 * 注：legal_person_name 为法定代表人姓名，不用于发票抬头「名称」。
 */
export const DEFAULT_PROJECT_NAME = '*软件测试服务*技术服务费';

export type AutomationStatus = 'idle' | 'connecting' | 'waiting_login' | 'processing' | 'done' | 'error';

export interface AutomationLog {
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export type QueueItemStatus = 'waiting' | 'processing' | 'success' | 'failed';

export interface QueueProductCode {
  spbm: string;
  spfwjc: string;
  name: string;
  taxRate: string;
}

export interface QueueItem {
  queueId: string;
  record: InvoiceRecord;
  productCode: QueueProductCode;
  customName: string;
  slv?: number;
  ggxh?: string;
  dw?: string;
  spsl?: string;
  bz?: string;
  gfzrrbs?: boolean;
  status: QueueItemStatus;
  errorMsg?: string;
  fphm?: string;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
}
