import type { AppSettings } from '../types/invoice';

declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Record<string, string>) => Promise<{ success: boolean }>;
      detectChrome: () => Promise<string>;
      selectDir: () => Promise<string | null>;
      initApi: (baseUrl: string, token: string) => Promise<{ success: boolean }>;
      fetchInvoiceList: (params: any) => Promise<any>;
      fetchInvoiceDetail: (id: number) => Promise<any>;
      uploadInvoicePdf: (id: number, pdfPath: string, meta?: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => Promise<any>;
      sendInvoiceEmail: (id: number) => Promise<any>;
      updateInvoiceStatus: (id: number, status: string) => Promise<any>;
      redFlushInvoice: (id: number, payload: { allow_reissue: boolean; red_fphm?: string; remark?: string }) => Promise<any>;
      updateInvoiceMeta: (id: number, payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => Promise<any>;
      launchBrowser: () => Promise<{ success: boolean; message?: string }>;
      closeBrowser: () => Promise<{ success: boolean; message?: string }>;
      checkBrowserAlive: () => Promise<boolean>;
      navigateToInvoice: () => Promise<{ success: boolean; message?: string }>;
      fillInvoiceForm: (data: any) => Promise<{ success: boolean; message?: string }>;
      submitAndDownload: () => Promise<{ success: boolean; pdfPath?: string; message?: string }>;
      getPageUrl: () => Promise<string>;
      getScreenshot: () => Promise<string | null>;
      switchCompany: (companyName: string) => Promise<{ success: boolean; message: string }>;
      checkLogin: () => Promise<{ loggedIn: boolean; currentUrl: string; message: string }>;
      clickLogin: () => Promise<{ success: boolean; message: string }>;
      waitLogin: (timeoutMs?: number) => Promise<{ success: boolean; message: string }>;
      navigateAfterLogin: () => Promise<{ success: boolean; message: string }>;
      onAutomationLog: (callback: (data: { level: string; message: string }) => void) => void;
      removeAutomationLogListener: () => void;
      taxGetClient: () => Promise<{ ok: boolean; message?: string }>;
      taxGetAuthorization: (nsrsbh: string, type?: string, forceRefresh?: boolean) => Promise<{ code: number; msg: string; data?: { token: string } }>;
      taxClearTokenCache: (nsrsbh?: string) => Promise<{ ok: boolean }>;
      taxLoginDppt: (params: { nsrsbh: string; username: string; password: string; sms?: string; sf?: string; ewmlx?: string; ewmid?: string }) =>
        Promise<{ code: number; msg: string; data?: string }>;
      taxQueryFaceAuthState: (nsrsbh: string, username?: string) => Promise<{ code: number; msg: string; data?: string }>;
      taxGetFaceImg: (nsrsbh: string, username?: string, type?: string) =>
        Promise<{ code: number; msg: string; data?: { rzid: string; ewm: string; ewmly?: string } }>;
      taxGetFaceState: (nsrsbh: string, rzid: string, username?: string, type?: string) =>
        Promise<{ code: number; msg: string; data?: { slzt: string } }>;
      taxChangeUser: (params: { oldNsrsbh: string; newNsrsbh: string; username: string; sf: string }) =>
        Promise<{ code: number; msg: string }>;
      taxBlueTicket: (params: Record<string, unknown>) => Promise<{ code: number; msg: string; data?: any }>;
      taxRetMsg: (params: { nsrsbh: string; fphm: string; username: string; sqyy?: string; xhdwsbh?: string }) =>
        Promise<{ code: number; msg: string; data?: any }>;
      taxApplyRedInfo: (params: { xhdwsbh: string; yfphm: string; username: string; sqyy?: string; chyydm?: string }) =>
        Promise<{ code: number; msg: string; data?: { xxbbh?: string } }>;
      taxRedTicket: (params: { fpqqlsh: string; username: string; xhdwsbh: string; tzdbh: string; yfphm: string }) =>
        Promise<{ code: number; msg: string; data?: any }>;
      taxPdfOfdXml: (params: { nsrsbh: string; fphm: string; downflag: number; kprq?: string; username?: string; addSeal?: number }) =>
        Promise<{ code: number; msg: string; data?: any }>;
      taxDownloadPdf: (params: { nsrsbh: string; fphm: string; kprq?: string; username?: string; saveDir?: string }) =>
        Promise<{ success: boolean; message: string; path: string | null }>;
    };
  }
}

const api = () => window.electronAPI;

export const settingsApi = {
  get: () => api().getSettings(),
  save: (settings: Record<string, string>) => api().saveSettings(settings),
  detectChrome: () => api().detectChrome(),
  selectDir: () => api().selectDir(),
};

export const invoiceApi = {
  list: (params: any) => api().fetchInvoiceList(params),
  detail: (id: number) => api().fetchInvoiceDetail(id),
  uploadPdf: (id: number, pdfPath: string, meta?: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => api().uploadInvoicePdf(id, pdfPath, meta),
  sendEmail: (id: number) => api().sendInvoiceEmail(id),
  updateStatus: (id: number, status: string) => api().updateInvoiceStatus(id, status),
  redFlush: (id: number, payload: { allow_reissue: boolean; red_fphm?: string; remark?: string }) => api().redFlushInvoice(id, payload),
  updateInvoiceMeta: (id: number, payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => api().updateInvoiceMeta(id, payload),
};

export const browserApi = {
  launch: () => api().launchBrowser(),
  close: () => api().closeBrowser(),
  checkAlive: () => api().checkBrowserAlive(),
  navigateToInvoice: () => api().navigateToInvoice(),
  fillForm: (data: any) => api().fillInvoiceForm(data),
  submitAndDownload: () => api().submitAndDownload(),
  getPageUrl: () => api().getPageUrl(),
  screenshot: () => api().getScreenshot(),
  switchCompany: (name: string) => api().switchCompany(name),
  checkLogin: () => api().checkLogin(),
  clickLogin: () => api().clickLogin(),
  waitLogin: (timeoutMs?: number) => api().waitLogin(timeoutMs),
  navigateAfterLogin: () => api().navigateAfterLogin(),
  onAutomationLog: (cb: (data: { level: string; message: string }) => void) => api().onAutomationLog(cb),
  removeAutomationLogListener: () => api().removeAutomationLogListener(),
};

export const taxApi = {
  getClient: () => api().taxGetClient(),
  getAuthorization: (nsrsbh: string, type?: string, forceRefresh?: boolean) => api().taxGetAuthorization(nsrsbh, type, forceRefresh),
  clearTokenCache: (nsrsbh?: string) => api().taxClearTokenCache(nsrsbh),
  loginDppt: (params: { nsrsbh: string; username: string; password: string; sms?: string; sf?: string; ewmlx?: string; ewmid?: string }) =>
    api().taxLoginDppt(params),
  queryFaceAuthState: (nsrsbh: string, username?: string) => api().taxQueryFaceAuthState(nsrsbh, username),
  getFaceImg: (nsrsbh: string, username?: string, type?: string) => api().taxGetFaceImg(nsrsbh, username, type),
  getFaceState: (nsrsbh: string, rzid: string, username?: string, type?: string) =>
    api().taxGetFaceState(nsrsbh, rzid, username, type),
  changeUser: (params: { oldNsrsbh: string; newNsrsbh: string; username: string; sf: string }) =>
    api().taxChangeUser(params),
  blueTicket: (params: Record<string, unknown>) => api().taxBlueTicket(params),
  retMsg: (params: { nsrsbh: string; fphm: string; username: string; sqyy?: string; xhdwsbh?: string }) => api().taxRetMsg(params),
  applyRedInfo: (params: { xhdwsbh: string; yfphm: string; username: string; sqyy?: string; chyydm?: string }) => api().taxApplyRedInfo(params),
  redTicket: (params: { fpqqlsh: string; username: string; xhdwsbh: string; tzdbh: string; yfphm: string }) => api().taxRedTicket(params),
  pdfOfdXml: (params: { nsrsbh: string; fphm: string; downflag: number; kprq?: string; username?: string; addSeal?: number }) =>
    api().taxPdfOfdXml(params),
  downloadPdf: (params: { nsrsbh: string; fphm: string; kprq?: string; username?: string; saveDir?: string }) =>
    api().taxDownloadPdf(params),
};
