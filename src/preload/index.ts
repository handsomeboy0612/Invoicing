import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke('settings:save', settings),
  detectChrome: () => ipcRenderer.invoke('settings:detectChrome'),
  selectDir: () => ipcRenderer.invoke('settings:selectDir'),

  // API 调用
  initApi: (baseUrl: string, token: string) => ipcRenderer.invoke('api:init', baseUrl, token),
  fetchInvoiceList: (params: any) => ipcRenderer.invoke('api:fetchInvoiceList', params),
  fetchInvoiceDetail: (id: number) => ipcRenderer.invoke('api:fetchInvoiceDetail', id),
  uploadInvoicePdf: (id: number, pdfPath: string, meta?: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) =>
    ipcRenderer.invoke('api:uploadInvoicePdf', id, pdfPath, meta),
  sendInvoiceEmail: (id: number) => ipcRenderer.invoke('api:sendInvoiceEmail', id),
  updateInvoiceStatus: (id: number, status: string) =>
    ipcRenderer.invoke('api:updateInvoiceStatus', id, status),
  redFlushInvoice: (id: number, payload: { allow_reissue: boolean; red_fphm?: string; remark?: string }) =>
    ipcRenderer.invoke('api:redFlushInvoice', id, payload),
  updateInvoiceMeta: (id: number, payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) =>
    ipcRenderer.invoke('api:updateInvoiceMeta', id, payload),

  // 浏览器自动化
  launchBrowser: () => ipcRenderer.invoke('browser:launch'),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  checkBrowserAlive: () => ipcRenderer.invoke('browser:checkAlive'),
  navigateToInvoice: () => ipcRenderer.invoke('browser:navigateToInvoice'),
  fillInvoiceForm: (data: any) => ipcRenderer.invoke('browser:fillForm', data),
  submitAndDownload: () => ipcRenderer.invoke('browser:submitAndDownload'),
  getPageUrl: () => ipcRenderer.invoke('browser:getPageUrl'),
  getScreenshot: () => ipcRenderer.invoke('browser:screenshot'),

  // 身份切换
  switchCompany: (companyName: string) => ipcRenderer.invoke('browser:switchCompany', companyName),

  // 登录流程
  checkLogin: () => ipcRenderer.invoke('browser:checkLogin'),
  clickLogin: () => ipcRenderer.invoke('browser:clickLogin'),
  waitLogin: (timeoutMs?: number) => ipcRenderer.invoke('browser:waitLogin', timeoutMs),
  navigateAfterLogin: () => ipcRenderer.invoke('browser:navigateAfterLogin'),

  // 主进程日志事件监听
  onAutomationLog: (callback: (data: { level: string; message: string }) => void) => {
    ipcRenderer.on('automation:log', (_event, data) => callback(data));
  },
  removeAutomationLogListener: () => {
    ipcRenderer.removeAllListeners('automation:log');
  },

  // 数电发票 API（fa-piao.com）
  taxGetClient: () => ipcRenderer.invoke('tax:getClient'),
  taxGetAuthorization: (nsrsbh: string, type?: string, forceRefresh?: boolean) => ipcRenderer.invoke('tax:getAuthorization', nsrsbh, type, forceRefresh),
  taxClearTokenCache: (nsrsbh?: string) => ipcRenderer.invoke('tax:clearTokenCache', nsrsbh),
  taxLoginDppt: (params: { nsrsbh: string; username: string; password: string; sms?: string; sf?: string; ewmlx?: string; ewmid?: string }) =>
    ipcRenderer.invoke('tax:loginDppt', params),
  taxQueryFaceAuthState: (nsrsbh: string, username?: string) => ipcRenderer.invoke('tax:queryFaceAuthState', nsrsbh, username),
  taxGetFaceImg: (nsrsbh: string, username?: string, type?: string) => ipcRenderer.invoke('tax:getFaceImg', nsrsbh, username, type),
  taxGetFaceState: (nsrsbh: string, rzid: string, username?: string, type?: string) =>
    ipcRenderer.invoke('tax:getFaceState', nsrsbh, rzid, username, type),
  taxChangeUser: (params: { oldNsrsbh: string; newNsrsbh: string; username: string; sf: string }) =>
    ipcRenderer.invoke('tax:changeUser', params),
  taxBlueTicket: (params: Record<string, unknown>) => ipcRenderer.invoke('tax:blueTicket', params),
  taxRetMsg: (params: { nsrsbh: string; fphm: string; username: string; sqyy?: string; xhdwsbh?: string }) =>
    ipcRenderer.invoke('tax:retMsg', params),
  taxApplyRedInfo: (params: { xhdwsbh: string; yfphm: string; username: string; sqyy?: string; chyydm?: string }) =>
    ipcRenderer.invoke('tax:applyRedInfo', params),
  taxRedTicket: (params: { fpqqlsh: string; username: string; xhdwsbh: string; tzdbh: string; yfphm: string }) =>
    ipcRenderer.invoke('tax:redTicket', params),
  taxPdfOfdXml: (params: { nsrsbh: string; fphm: string; downflag: number; kprq?: string; username?: string; addSeal?: number }) =>
    ipcRenderer.invoke('tax:pdfOfdXml', params),
  taxDownloadPdf: (params: { nsrsbh: string; fphm: string; kprq?: string; username?: string; saveDir?: string }) =>
    ipcRenderer.invoke('tax:downloadPdf', params),
};

contextBridge.exposeInMainWorld('electronAPI', api);
