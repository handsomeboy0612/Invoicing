import { ipcMain, dialog, app } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import {
  initApiClient,
  fetchInvoiceList,
  fetchInvoiceDetail,
  uploadInvoicePdf,
  sendInvoiceEmail,
  updateInvoiceStatus,
  redFlushInvoice,
  updateInvoiceMeta,
  formatApiError,
} from './api-service';
import {
  getTaxInvoiceClient,
  setTaxInvoiceToken,
} from './tax-invoice-service';
import {
  launchChrome,
  closeBrowser,
  checkBrowserAlive,
  detectChromePath,
  fillInvoiceForm,
  submitAndDownloadPdf,
  navigateToInvoicePage,
  getCurrentPageUrl,
  getPageScreenshot,
  checkLoginStatus,
  clickLoginButton,
  waitForLoginComplete,
  navigateAfterLogin,
  switchCompanyAndGoInvoice,
  InvoiceFormData,
} from './puppeteer-service';

const TAX_APP_KEY = 'JzxWnwvk';
const TAX_APP_SECRET = 'P8l5QALneaMJzxWnwvkYjRD6vwGpO1';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

const store = new Store({
  defaults: {
    apiBaseUrl: 'https://yunwu.ai',
    apiToken: '',
    apiUserId: '',
    chromePath: '',
    downloadDir: '',
  },
});

interface CachedToken {
  token: string;
  createdAt: number;
}

function getCachedTaxToken(nsrsbh: string): string | null {
  const cached = store.get(`taxTokens.${nsrsbh}`) as CachedToken | undefined;
  if (!cached) return null;
  if (Date.now() - cached.createdAt > TOKEN_TTL_MS) {
    store.delete(`taxTokens.${nsrsbh}` as any);
    return null;
  }
  return cached.token;
}

function cacheTaxToken(nsrsbh: string, token: string) {
  store.set(`taxTokens.${nsrsbh}`, { token, createdAt: Date.now() });
}

function clearTaxToken(nsrsbh: string) {
  store.delete(`taxTokens.${nsrsbh}` as any);
}

/** 包装需要 token 的 API 调用：401 时自动清除缓存、重新授权并重试一次 */
async function withTokenRetry<T extends { code: number }>(
  nsrsbh: string,
  fn: () => Promise<T>,
): Promise<T> {
  const res = await fn();
  if (res.code !== 401) return res;
  console.log(`[tax-token] 收到 401，清除缓存并重新授权: ${nsrsbh}`);
  clearTaxToken(nsrsbh);
  const client = getTaxInvoiceClient();
  const authRes = await client.getAuthorization(nsrsbh, '7');
  if (authRes.code === 200 && authRes.data?.token) {
    cacheTaxToken(nsrsbh, authRes.data.token);
    console.log(`[tax-token] 重新授权成功，重试请求: ${nsrsbh}`);
    return fn();
  }
  return res;
}

export function registerIpcHandlers() {
  // ===== 设置相关 =====
  ipcMain.handle('settings:get', () => {
    return {
      apiBaseUrl: store.get('apiBaseUrl') ?? 'https://yunwu.ai',
      apiToken: store.get('apiToken') ?? '',
      apiUserId: store.get('apiUserId') ?? '',
      chromePath: store.get('chromePath') || detectChromePath(),
      downloadDir: store.get('downloadDir') ?? '',
    };
  });

  ipcMain.handle('settings:save', (_event, settings: Record<string, string>) => {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) continue;
      // 不用空字符串覆盖已有的 API 地址和令牌，避免误清空导致列表请求失败
      if ((key === 'apiBaseUrl' || key === 'apiToken') && value === '' && store.get(key)) continue;
      store.set(key, value);
    }
    const baseUrl = (settings.apiBaseUrl as string) || (store.get('apiBaseUrl') as string);
    const token = (settings.apiToken as string) || (store.get('apiToken') as string);
    const userId = (settings.apiUserId as string) || (store.get('apiUserId') as string);
    if (baseUrl && token) {
      initApiClient(baseUrl, token, userId);
    }
    return { success: true };
  });

  ipcMain.handle('settings:detectChrome', () => {
    return detectChromePath();
  });

  ipcMain.handle('settings:selectDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择下载目录',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // ===== API 相关 =====
  ipcMain.handle('api:init', (_event, baseUrl: string, token: string, userId?: string) => {
    initApiClient(baseUrl, token, userId);
    return { success: true };
  });

  ipcMain.handle('api:fetchInvoiceList', async (_event, params) => {
    try {
      return await fetchInvoiceList(params);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:fetchInvoiceDetail', async (_event, id: number) => {
    try {
      return await fetchInvoiceDetail(id);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:uploadInvoicePdf', async (_event, id: number, pdfPath: string, meta?: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => {
    try {
      return await uploadInvoicePdf(id, pdfPath, meta);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:sendInvoiceEmail', async (_event, id: number) => {
    try {
      return await sendInvoiceEmail(id);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:updateInvoiceStatus', async (_event, id: number, status: string) => {
    try {
      return await updateInvoiceStatus(id, status);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:redFlushInvoice', async (_event, id: number, payload: { allow_reissue: boolean; red_fphm?: string; remark?: string }) => {
    try {
      return await redFlushInvoice(id, payload);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  ipcMain.handle('api:updateInvoiceMeta', async (_event, id: number, payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string }) => {
    try {
      return await updateInvoiceMeta(id, payload);
    } catch (err: any) {
      return { success: false, message: formatApiError(err) };
    }
  });

  // ===== 浏览器自动化相关 =====
  ipcMain.handle('browser:launch', async () => {
    try {
      const chromePath = store.get('chromePath') as string;
      await launchChrome(chromePath || undefined);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || '启动失败' };
    }
  });

  ipcMain.handle('browser:close', async () => {
    try {
      await closeBrowser();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || '关闭失败' };
    }
  });

  ipcMain.handle('browser:checkAlive', async () => {
    return await checkBrowserAlive();
  });

  ipcMain.handle('browser:navigateToInvoice', async () => {
    try {
      await navigateToInvoicePage();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || '导航失败' };
    }
  });

  ipcMain.handle('browser:switchCompany', async (_event, companyName: string) => {
    try {
      return await switchCompanyAndGoInvoice(companyName);
    } catch (err: any) {
      return { success: false, message: err.message || '切换失败' };
    }
  });

  ipcMain.handle('browser:fillForm', async (_event, data: InvoiceFormData) => {
    try {
      await fillInvoiceForm(data);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || '填写失败' };
    }
  });

  ipcMain.handle('browser:submitAndDownload', async () => {
    try {
      const pdfPath = await submitAndDownloadPdf();
      return { success: true, pdfPath };
    } catch (err: any) {
      return { success: false, message: err.message || '下载失败' };
    }
  });

  ipcMain.handle('browser:checkLogin', async () => {
    try {
      return await checkLoginStatus();
    } catch (err: any) {
      return { loggedIn: false, currentUrl: '', message: err.message };
    }
  });

  ipcMain.handle('browser:clickLogin', async () => {
    try {
      return await clickLoginButton();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('browser:waitLogin', async (_event, timeoutMs?: number) => {
    try {
      return await waitForLoginComplete(timeoutMs);
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('browser:navigateAfterLogin', async () => {
    try {
      return await navigateAfterLogin();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('browser:getPageUrl', async () => {
    return await getCurrentPageUrl();
  });

  ipcMain.handle('browser:screenshot', async () => {
    return await getPageScreenshot();
  });

  // ===== 数电发票 API（fa-piao.com）=====
  ipcMain.handle('tax:getClient', () => {
    try {
      getTaxInvoiceClient({ appKey: TAX_APP_KEY, appSecret: TAX_APP_SECRET });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle('tax:getAuthorization', async (_event, nsrsbh: string, type?: string, forceRefresh?: boolean) => {
    try {
      const client = getTaxInvoiceClient();
      if (!forceRefresh) {
        const cached = getCachedTaxToken(nsrsbh);
        if (cached) {
          client.setToken(cached);
          console.log(`[tax-token] 使用缓存 token: ${nsrsbh}`);
          return { code: 200, msg: 'ok (cached)', data: { token: cached } };
        }
      }
      const res = await client.getAuthorization(nsrsbh, type || '7');
      if (res.code === 200 && res.data?.token) {
        cacheTaxToken(nsrsbh, res.data.token);
        console.log(`[tax-token] 已缓存新 token: ${nsrsbh}`);
      }
      return res;
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:clearTokenCache', (_event, nsrsbh?: string) => {
    if (nsrsbh) {
      clearTaxToken(nsrsbh);
      console.log(`[tax-token] 已清除缓存: ${nsrsbh}`);
    } else {
      store.delete('taxTokens' as any);
      console.log(`[tax-token] 已清除所有缓存`);
    }
    return { ok: true };
  });

  ipcMain.handle('tax:loginDppt', async (_event, params: { nsrsbh: string; username: string; password: string; sms?: string; sf?: string; ewmlx?: string; ewmid?: string }) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(params.nsrsbh, () => client.loginDppt(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:queryFaceAuthState', async (_event, nsrsbh: string, username?: string) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(nsrsbh, () => client.queryFaceAuthState(nsrsbh, username));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:getFaceImg', async (_event, nsrsbh: string, username?: string, type?: string) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(nsrsbh, () => client.getFaceImg(nsrsbh, username, type));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:getFaceState', async (_event, nsrsbh: string, rzid: string, username?: string, type?: string) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(nsrsbh, () => client.getFaceState(nsrsbh, rzid, username, type));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:changeUser', async (_event, params: { oldNsrsbh: string; newNsrsbh: string; username: string; sf: string }) => {
    try {
      const client = getTaxInvoiceClient();
      const res = await withTokenRetry(params.oldNsrsbh, () => client.changeUser(params));
      if (res.code === 200) {
        const cached = getCachedTaxToken(params.newNsrsbh);
        if (cached) {
          client.setToken(cached);
          console.log(`[tax-token] 切换公司后使用缓存 token: ${params.newNsrsbh}`);
        } else {
          const authRes = await client.getAuthorization(params.newNsrsbh, '7');
          if (authRes.code === 200 && authRes.data?.token) {
            cacheTaxToken(params.newNsrsbh, authRes.data.token);
            console.log(`[tax-token] 切换公司后获取并缓存新 token: ${params.newNsrsbh}`);
          }
        }
      }
      return res;
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:blueTicket', async (_event, params: Record<string, unknown>) => {
    try {
      const client = getTaxInvoiceClient();
      const nsrsbh = (params.xhdwsbh || params.nsrsbh || '') as string;
      return await withTokenRetry(nsrsbh, () => client.blueTicket(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:pdfOfdXml', async (_event, params: { nsrsbh: string; fphm: string; downflag: number; kprq?: string; username?: string; addSeal?: number }) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(params.nsrsbh, () => client.pdfOfdXml(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:retMsg', async (_event, params: { nsrsbh: string; fphm: string; username: string; sqyy?: string; xhdwsbh?: string }) => {
    try {
      const client = getTaxInvoiceClient();
      const nsrsbh = params.xhdwsbh || params.nsrsbh;
      return await withTokenRetry(nsrsbh, () => client.retMsg(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:applyRedInfo', async (_event, params: { xhdwsbh: string; yfphm: string; username: string; sqyy?: string; chyydm?: string }) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(params.xhdwsbh, () => client.applyRedInfo(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  ipcMain.handle('tax:redTicket', async (_event, params: { fpqqlsh: string; username: string; xhdwsbh: string; tzdbh: string; yfphm: string }) => {
    try {
      const client = getTaxInvoiceClient();
      return await withTokenRetry(params.xhdwsbh, () => client.redTicket(params));
    } catch (e: any) {
      return { code: 500, msg: e.message, data: undefined };
    }
  });

  /** 获取 PDF 并保存到本地，返回本地路径。downflag=4 用 URL 下载，downflag=1 用 base64 写入 */
  ipcMain.handle('tax:downloadPdf', async (_event, params: { nsrsbh: string; fphm: string; kprq?: string; username?: string; saveDir?: string }) => {
    const PDF_DOWNLOAD_MAX_RETRIES = 3;
    const PDF_DOWNLOAD_RETRY_DELAY = 3000;

    try {
      const client = getTaxInvoiceClient();
      const saveDir = params.saveDir || (store.get('downloadDir') as string) || app.getPath('downloads');
      const pdfParams = { nsrsbh: params.nsrsbh, fphm: params.fphm, downflag: 4 as number, kprq: params.kprq, username: params.username };

      const axiosMod = await import('axios');
      const axiosDefault = axiosMod.default;

      let lastError = '';
      for (let attempt = 1; attempt <= PDF_DOWNLOAD_MAX_RETRIES; attempt++) {
        const res = await withTokenRetry(params.nsrsbh, () => client.pdfOfdXml(pdfParams));
        if (res.code !== 200 || !res.data) {
          lastError = res.msg || '获取版式失败';
          if (attempt < PDF_DOWNLOAD_MAX_RETRIES) {
            console.log(`[pdf-download] 第${attempt}次获取版式失败，${PDF_DOWNLOAD_RETRY_DELAY}ms 后重试: ${lastError}`);
            await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_RETRY_DELAY));
            continue;
          }
          return { success: false, message: lastError, path: null };
        }
        const data = res.data as { pdfUrl?: string; ofdUrl?: string; xmlUrl?: string };
        const pdfUrl = data.pdfUrl;
        if (!pdfUrl) {
          lastError = '未返回 PDF 地址';
          if (attempt < PDF_DOWNLOAD_MAX_RETRIES) {
            console.log(`[pdf-download] 第${attempt}次未返回 PDF 地址，${PDF_DOWNLOAD_RETRY_DELAY}ms 后重试`);
            await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_RETRY_DELAY));
            continue;
          }
          return { success: false, message: lastError, path: null };
        }

        const resp = await axiosDefault.get(pdfUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(resp.data);

        if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
          lastError = `下载内容不是有效 PDF (大小=${buffer.length}, 头部=${buffer.subarray(0, 20).toString('ascii').replace(/[^\x20-\x7E]/g, '?')})`;
          console.warn(`[pdf-download] 第${attempt}次: ${lastError}`);
          if (attempt < PDF_DOWNLOAD_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_RETRY_DELAY));
            continue;
          }
          return { success: false, message: lastError, path: null };
        }

        const fileName = `invoice_${params.fphm}_${Date.now()}.pdf`;
        const filePath = path.join(saveDir, fileName);
        fs.mkdirSync(saveDir, { recursive: true });
        fs.writeFileSync(filePath, buffer);
        console.log(`[pdf-download] 已保存有效 PDF: ${filePath} (${buffer.length} bytes)`);
        return { success: true, message: '已保存', path: filePath };
      }

      return { success: false, message: lastError || '下载失败', path: null };
    } catch (e: any) {
      return { success: false, message: e.message || '下载失败', path: null };
    }
  });

  // ===== 初始化 API 客户端 =====
  const savedBaseUrl = store.get('apiBaseUrl') as string;
  const savedToken = store.get('apiToken') as string;
  const savedUserId = store.get('apiUserId') as string;
  if (savedBaseUrl && savedToken) {
    initApiClient(savedBaseUrl, savedToken, savedUserId);
  }
  try {
    getTaxInvoiceClient({ appKey: TAX_APP_KEY, appSecret: TAX_APP_SECRET });
  } catch (_) {}
}
