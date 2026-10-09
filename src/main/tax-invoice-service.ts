/**
 * 数电发票 API 服务（fa-piao.com）
 * 参考 invoice-sdk-python：签名、授权、登录/人脸、切换公司、开蓝票、下载版式
 */

import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://api.fa-piao.com';

function logTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function getTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function generateRandomString(length: number = 20): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function calculateSignature(
  method: string,
  path: string,
  randomString: string,
  timestamp: string,
  appKey: string,
  appSecret: string
): string {
  const signContent = `Method=${method}&Path=${path}&RandomString=${randomString}&TimeStamp=${timestamp}&AppKey=${appKey}`;
  const signature = crypto
    .createHmac('sha256', appSecret)
    .update(signContent)
    .digest('hex');
  return signature.toUpperCase();
}

export interface TaxInvoiceConfig {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
}

export interface TaxApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
  total?: number;
}

/** 认证状态：200 成功/无需认证，420 短信认证，430 人脸认证 */
export interface FaceAuthStateData {
  rzid?: string;
  nsrsbh?: string;
  ewm?: string;
  slzt?: string; // 1 未认证 2 成功 3 过期
  ewmly?: string; // swj 税务局app / grsds 个税app
}

/** 人脸二维码返回 */
export interface FaceImgData {
  rzid: string;
  nsrsbh: string;
  ewm: string;
  slzt?: string;
  ewmly?: string;
}

/** 开票返回：可能直接成功，或需人脸认证 */
export interface BlueTicketData {
  Fphm?: string;
  Kprq?: string;
  Gmfyx?: string;
  GmfSsjswjgdm?: string;
  /** 需人脸时返回 */
  nsrsbh?: string;
  rzid?: string;
  slzt?: string;
  ewm?: string;
  ewmly?: string;
}

/** 版式文件：downflag=4 返回 { pdfUrl, ofdUrl, xmlUrl } */
export interface PdfOfdXmlData {
  pdfUrl?: string;
  ofdUrl?: string;
  xmlUrl?: string;
}

class TaxInvoiceClient {
  private appKey: string;
  private appSecret: string;
  private baseUrl: string;
  private token: string | null = null;

  constructor(config: TaxInvoiceConfig) {
    this.appKey = config.appKey;
    this.appSecret = config.appSecret || '';
    this.baseUrl = config.baseUrl || BASE_URL;
  }

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    data?: Record<string, unknown>,
    params?: Record<string, string | number>,
    timeout = 30000
  ): Promise<TaxApiResponse<T>> {
    const randomString = generateRandomString(20);
    const timestamp = getTimestamp();
    const signPath = path.split('?')[0];
    const signature = calculateSignature(
      method,
      signPath,
      randomString,
      timestamp,
      this.appKey,
      this.appSecret
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      AppKey: this.appKey,
      TimeStamp: timestamp,
      RandomString: randomString,
      Sign: signature,
    };
    if (this.token) {
      headers.Authorization = this.token;
    }

    let url = `${this.baseUrl}${path}`;
    if (method === 'GET' && params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => qs.set(k, String(v)));
      url += (path.includes('?') ? '&' : '?') + qs.toString();
    }

    const logBody = data ? { ...data } : undefined;
    if (logBody?.password) logBody.password = '***';
    console.log(`[${logTime()}] [tax-api] ${method} ${url}`, logBody ? JSON.stringify(logBody) : '');

    try {
      const res = method === 'GET'
        ? await axios.get<TaxApiResponse<T>>(url, { headers, timeout })
        : await axios.post<TaxApiResponse<T>>(url, data ?? {}, { headers, timeout });
      const rd = res.data as any;
      const logData = rd?.data && typeof rd.data === 'string' && rd.data.length > 200
        ? rd.data.substring(0, 200) + '...(truncated)'
        : rd?.data;
      console.log(`[${logTime()}] [tax-api] ${method} ${path} => code=${rd?.code} msg=${rd?.msg}`, logData != null ? JSON.stringify(logData) : '');
      return res.data;
    } catch (err: any) {
      const msg = err.response?.data?.msg ?? err.message ?? '请求异常';
      console.error(`[${logTime()}] [tax-api] ${method} ${path} => ERROR`, msg, err.response?.status);
      return { code: err.response?.status ?? 500, msg, data: undefined };
    }
  }

  /** 获取授权 Token */
  async getAuthorization(nsrsbh: string, type: string = '7'): Promise<TaxApiResponse<{ token: string }>> {
    const body: Record<string, string> = { nsrsbh };
    if (type !== '6') body.type = type;
    const res = await this.request<{ token: string }>('POST', '/v5/enterprise/authorization', body);
    if (res.code === 200 && res.data?.token) {
      this.token = res.data.token;
    }
    return res;
  }

  /** 登录数电发票平台（短信验证码 或 人脸二维码） */
  async loginDppt(params: {
    nsrsbh: string;
    username: string;
    password: string;
    sms?: string;
    sf?: string;
    ewmlx?: string;
    ewmid?: string;
  }): Promise<TaxApiResponse<string>> {
    const body: Record<string, string> = {
      nsrsbh: params.nsrsbh,
      username: params.username,
      password: params.password,
    };
    if (params.sms) body.sms = params.sms;
    if (params.sf) body.sf = params.sf;
    if (params.ewmlx) body.ewmlx = params.ewmlx;
    if (params.ewmid) body.ewmid = params.ewmid;
    return this.request<string>('POST', '/v5/enterprise/loginDppt', body, undefined, 120000);
  }

  /** 获取认证状态：200 成功，420 短信，430 人脸 */
  async queryFaceAuthState(nsrsbh: string, username?: string): Promise<TaxApiResponse<string>> {
    const body: Record<string, string> = { nsrsbh };
    if (username) body.username = username;
    return this.request<string>('POST', '/v5/enterprise/queryFaceAuthState', body);
  }

  /** 获取人脸二维码 */
  async getFaceImg(nsrsbh: string, username?: string, type?: string): Promise<TaxApiResponse<FaceImgData>> {
    const params: Record<string, string> = { nsrsbh };
    if (username) params.username = username;
    if (type) params.type = type;
    return this.request<FaceImgData>('GET', '/v5/enterprise/getFaceImg', undefined, params);
  }

  /** 获取人脸二维码认证状态 */
  async getFaceState(nsrsbh: string, rzid: string, username?: string, type?: string): Promise<TaxApiResponse<FaceAuthStateData>> {
    const params: Record<string, string> = { nsrsbh, rzid };
    if (username) params.username = username;
    if (type) params.type = type;
    return this.request<FaceAuthStateData>('GET', '/v5/enterprise/getFaceState', undefined, params);
  }

  /** 切换电子税务局账号（同一账号下不同企业） */
  async changeUser(params: {
    oldNsrsbh: string;
    newNsrsbh: string;
    username: string;
    sf: string;
  }): Promise<TaxApiResponse<unknown>> {
    return this.request('POST', '/v5/enterprise/changeUser', {
      oldNsrsbh: params.oldNsrsbh,
      newNsrsbh: params.newNsrsbh,
      username: params.username,
      sf: params.sf,
    });
  }

  /** 数电蓝票开具（普通发票 fplxdm=82） */
  async blueTicket(params: Record<string, unknown>): Promise<TaxApiResponse<BlueTicketData>> {
    return this.request<BlueTicketData>('POST', '/v5/enterprise/blueTicket', params);
  }

  /**
   * 红字前查蓝票信息：判断该发票是否可申请红冲（严格照官方 demo，全额红冲只需发票号+销方税号+username）
   * 参数：nsrsbh 销方税号；fphm 原发票号；sqyy 申请原因(2)；username 电票平台账号；xhdwsbh 销货单位识别号
   * code==200 表示可申请红字
   */
  async retMsg(params: {
    nsrsbh: string;
    fphm: string;
    username: string;
    sqyy?: string;
    xhdwsbh?: string;
  }): Promise<TaxApiResponse<unknown>> {
    const body: Record<string, unknown> = {
      nsrsbh: params.nsrsbh,
      fphm: params.fphm,
      sqyy: params.sqyy || '2',
      username: params.username,
      // 官方 red_invoice_example 使用 xhdwsbh=nsrsbh（销方税号）而非购方 ghdwsbh
      xhdwsbh: params.xhdwsbh || params.nsrsbh,
    };
    return this.request('POST', '/v5/enterprise/retMsg', body);
  }

  /**
   * 申请红字信息表：全额红冲不传明细(fyxm)，返回 data.xxbbh 作为通知单编号
   * 参数：xhdwsbh 销方税号；yfphm 原发票号；username；sqyy(2)；chyydm 冲红原因(01-04)
   */
  async applyRedInfo(params: {
    xhdwsbh: string;
    yfphm: string;
    username: string;
    sqyy?: string;
    chyydm?: string;
  }): Promise<TaxApiResponse<{ xxbbh?: string }>> {
    const body: Record<string, unknown> = {
      xhdwsbh: params.xhdwsbh,
      yfphm: params.yfphm,
      username: params.username,
      sqyy: params.sqyy || '2',
      chyydm: params.chyydm || '01',
    };
    return this.request<{ xxbbh?: string }>('POST', '/v5/enterprise/hzxxbsq', body);
  }

  /**
   * 开具红字发票（负数全额）：items 为空，tzdbh 传红字信息表编号 xxbbh
   * 参数：fpqqlsh 新流水号；username；xhdwsbh 销方税号；tzdbh=xxbbh；yfphm 原发票号
   */
  async redTicket(params: {
    fpqqlsh: string;
    username: string;
    xhdwsbh: string;
    tzdbh: string;
    yfphm: string;
  }): Promise<TaxApiResponse<BlueTicketData>> {
    const body: Record<string, unknown> = {
      fpqqlsh: params.fpqqlsh,
      username: params.username,
      xhdwsbh: params.xhdwsbh,
      tzdbh: params.tzdbh,
      yfphm: params.yfphm,
    };
    return this.request<BlueTicketData>('POST', '/v5/enterprise/hzfpkj', body);
  }

  /** 获取销项版式：downflag 1=PDF base64 2=OFD 3=XML 4=下载地址 5=base64文件 */
  async pdfOfdXml(params: {
    nsrsbh: string;
    fphm: string;
    downflag: number;
    kprq?: string;
    username?: string;
    addSeal?: number;
  }): Promise<TaxApiResponse<string | PdfOfdXmlData>> {
    const body: Record<string, string | number> = {
      nsrsbh: params.nsrsbh,
      fphm: params.fphm,
      downflag: params.downflag,
    };
    if (params.kprq) body.kprq = params.kprq;
    if (params.username) body.username = params.username;
    if (params.addSeal != null) body.addSeal = params.addSeal;
    return this.request('POST', '/v5/enterprise/pdfOfdXml', body as Record<string, unknown>);
  }
}

let client: TaxInvoiceClient | null = null;

export function getTaxInvoiceClient(config?: TaxInvoiceConfig): TaxInvoiceClient {
  if (config) {
    client = new TaxInvoiceClient(config);
  }
  if (!client) {
    throw new Error('数电发票客户端未初始化，请先配置 AppKey / AppSecret');
  }
  return client;
}

export function setTaxInvoiceToken(token: string) {
  if (client) client.setToken(token);
}

export {
  TaxInvoiceClient,
  getTimestamp,
  generateRandomString,
  calculateSignature,
};
