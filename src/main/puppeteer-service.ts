import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app, BrowserWindow } from 'electron';

let browser: Browser | null = null;
let page: Page | null = null;

const TAX_URL = 'https://etax.chongqing.chinatax.gov.cn:8443/';
const TAX_LOGIN_URL_PREFIX = 'https://tpass.chongqing.chinatax.gov.cn:8443/';
const TAX_LOGGEDIN_URL_PREFIX = 'https://etax.chongqing.chinatax.gov.cn:8443/loginb/';
const INVOICE_PAGE_URL = 'https://dppt.chongqing.chinatax.gov.cn:8443/blue-invoice-makeout';

type LogCallback = (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
let logCallback: LogCallback | null = null;

function log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
  console.log(`[puppeteer][${level}] ${message}`);
  if (logCallback) logCallback(level, message);
}

export function setLogCallback(cb: LogCallback | null) {
  logCallback = cb;
}

function sendLogToRenderer(level: string, message: string) {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    wins[0].webContents.send('automation:log', { level, message });
  }
}

function getDefaultChromePath(): string {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${os.homedir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

export function detectChromePath(): string {
  return getDefaultChromePath();
}

function getDownloadDir(): string {
  const dir = path.join(app.getPath('userData'), 'downloads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function launchChrome(chromePath?: string): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }

  const execPath = chromePath || getDefaultChromePath();
  if (!execPath || !fs.existsSync(execPath)) {
    throw new Error(`Chrome 未找到，请检查路径: ${execPath}`);
  }

  const downloadDir = getDownloadDir();

  browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const pages = await browser.pages();
  page = pages[0] || (await browser.newPage());

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  });

  sendLogToRenderer('info', '正在打开税务网站...');
  await page.goto(TAX_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  sendLogToRenderer('success', '税务网站已打开');
}

export async function checkBrowserAlive(): Promise<boolean> {
  if (!browser || !page) return false;
  try {
    await page.title();
    return true;
  } catch {
    return false;
  }
}

// ===== 登录检测与引导 =====

export interface LoginCheckResult {
  loggedIn: boolean;
  currentUrl: string;
  message: string;
}

export async function checkLoginStatus(): Promise<LoginCheckResult> {
  if (!page) throw new Error('浏览器未启动');

  const currentUrl = page.url();

  // 如果已经在登录后的页面
  if (currentUrl.startsWith(TAX_LOGGEDIN_URL_PREFIX)) {
    return { loggedIn: true, currentUrl, message: '已登录，当前在首页' };
  }

  // 如果在登录页面
  if (currentUrl.startsWith(TAX_LOGIN_URL_PREFIX)) {
    return { loggedIn: false, currentUrl, message: '当前在登录页，请手动完成登录' };
  }

  // 在税务首页，检查是否有"登录"按钮
  try {
    const loginBtn = await page.$('span.loginBtnText');
    if (loginBtn) {
      const text = await page.evaluate((el) => el.textContent?.trim(), loginBtn);
      if (text === '登录') {
        return { loggedIn: false, currentUrl, message: '未登录，页面上有登录按钮' };
      }
    }
  } catch {}

  // 没找到登录按钮，可能已登录
  return { loggedIn: true, currentUrl, message: '未检测到登录按钮，可能已登录' };
}

export async function clickLoginButton(): Promise<{ success: boolean; message: string }> {
  if (!page) throw new Error('浏览器未启动');

  sendLogToRenderer('info', '正在查找登录按钮...');

  try {
    const loginBtn = await page.$('span.loginBtnText');
    if (!loginBtn) {
      return { success: false, message: '未找到登录按钮，可能已登录或页面未加载完成' };
    }

    const text = await page.evaluate((el) => el.textContent?.trim(), loginBtn);
    if (text !== '登录') {
      return { success: false, message: `按钮文字不是"登录"，而是"${text}"` };
    }

    await loginBtn.click();
    sendLogToRenderer('info', '已点击登录按钮，等待页面跳转...');

    // 等待跳转到登录页
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

    const newUrl = page.url();
    if (newUrl.startsWith(TAX_LOGIN_URL_PREFIX)) {
      sendLogToRenderer('warn', '已跳转到登录页，请在 Chrome 中手动完成登录');
      return { success: true, message: '已跳转到登录页，请手动登录' };
    }

    return { success: true, message: `点击成功，当前页面: ${newUrl}` };
  } catch (err: any) {
    return { success: false, message: `点击登录失败: ${err.message}` };
  }
}

export async function waitForLoginComplete(timeoutMs: number = 300000): Promise<{ success: boolean; message: string }> {
  if (!page) throw new Error('浏览器未启动');

  sendLogToRenderer('info', `等待用户登录，超时时间 ${Math.floor(timeoutMs / 1000)} 秒...`);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const url = page.url();

      // 登录成功后会跳转回税务网站
      if (url.startsWith(TAX_LOGGEDIN_URL_PREFIX) || 
          (url.startsWith(TAX_URL) && !url.startsWith(TAX_LOGIN_URL_PREFIX))) {
        // 再确认一下不是登录页
        const onLoginPage = url.startsWith(TAX_LOGIN_URL_PREFIX);
        if (!onLoginPage) {
          sendLogToRenderer('success', '检测到登录成功！');
          // 等待页面完全加载
          await new Promise((r) => setTimeout(r, 2000));
          return { success: true, message: '登录成功' };
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { success: false, message: '等待登录超时' };
}

// ===== 登录后导航 =====

export async function navigateAfterLogin(): Promise<{ success: boolean; message: string }> {
  if (!page) throw new Error('浏览器未启动');

  const url = page.url();
  sendLogToRenderer('info', `登录后页面: ${url}`);

  await new Promise((r) => setTimeout(r, 2000));

  // 先尝试找导航菜单中的"账户中心"入口
  try {
    // 尝试点击右上角用户菜单触发下拉
    const navPopup = await page.$('#NavTopPopup');
    if (navPopup) {
      await navPopup.click();
      await new Promise((r) => setTimeout(r, 1000));
    }

    const allBtnTitles = await page.$$('span.grBtnTitle');
    for (const btn of allBtnTitles) {
      const text = await page.evaluate((el) => el.textContent?.trim(), btn);
      if (text === '账户中心') {
        sendLogToRenderer('info', '点击"账户中心"...');
        await btn.click();
        await new Promise((r) => setTimeout(r, 3000));
        sendLogToRenderer('success', '已进入账户中心');
        return { success: true, message: '已进入账户中心' };
      }
    }

    return { success: false, message: '未找到"账户中心"按钮' };
  } catch (err: any) {
    return { success: false, message: `导航失败: ${err.message}` };
  }
}

// ===== 身份切换 =====

export async function switchCompanyAndGoInvoice(companyName: string): Promise<{ success: boolean; message: string }> {
  if (!page) throw new Error('浏览器未启动');

  sendLogToRenderer('info', `准备切换到企业: ${companyName}`);

  try {
    // 确保在账户中心 > 身份切换页面
    // 先点击左侧"身份切换"菜单
    const sideMenuItems = await page.$$('.el-menu-item, .el-submenu__title');
    for (const item of sideMenuItems) {
      const text = await page.evaluate((el) => el.textContent?.trim(), item);
      if (text && text.includes('身份切换')) {
        sendLogToRenderer('info', '点击左侧"身份切换"菜单...');
        await item.click();
        await new Promise((r) => setTimeout(r, 1500));
        break;
      }
    }

    // 点击"企业办税"子菜单（如果有）
    const subMenuItems = await page.$$('.el-menu-item');
    for (const item of subMenuItems) {
      const text = await page.evaluate((el) => el.textContent?.trim(), item);
      if (text && text.includes('企业办税')) {
        await item.click();
        await new Promise((r) => setTimeout(r, 2000));
        sendLogToRenderer('info', '已进入"企业办税"列表');
        break;
      }
    }

    // 在表格中查找匹配的公司名称
    await page.waitForSelector('.el-table__body tbody tr', { timeout: 10000 });
    const rows = await page.$$('.el-table__body tbody tr.el-table__row');

    sendLogToRenderer('info', `找到 ${rows.length} 家企业，搜索匹配: ${companyName}`);

    for (const row of rows) {
      const rowText = await page.evaluate((el) => el.textContent || '', row);

      // 模糊匹配：检查行文本中是否包含公司名称（去掉括号等特殊字符对比）
      const normalizedRowText = rowText.replace(/\s+/g, '');
      const normalizedName = companyName.replace(/\s+/g, '');

      if (normalizedRowText.includes(normalizedName)) {
        sendLogToRenderer('success', `匹配到企业: ${companyName}`);

        // 找到该行的"切换"按钮
        const switchBtn = await row.$('button.el-button--text');
        if (!switchBtn) {
          // 备选：查找包含"切换"文本的按钮
          const buttons = await row.$$('button');
          for (const btn of buttons) {
            const btnText = await page.evaluate((el) => el.textContent?.trim(), btn);
            if (btnText === '切换') {
              sendLogToRenderer('info', '点击"切换"按钮...');
              await btn.click();
              break;
            }
          }
        } else {
          sendLogToRenderer('info', '点击"切换"按钮...');
          await switchBtn.click();
        }

        // 等待跳转到开票页面
        sendLogToRenderer('info', '等待跳转到开票页面...');
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch {}

        await new Promise((r) => setTimeout(r, 3000));

        const currentUrl = page.url();
        if (currentUrl.includes('dppt.chongqing.chinatax.gov.cn') || currentUrl.includes('blue-invoice')) {
          sendLogToRenderer('success', '已跳转到开票页面');
          return { success: true, message: '已切换身份并跳转到开票页面' };
        }

        // 如果没有自动跳转，手动导航
        sendLogToRenderer('info', '未自动跳转，手动导航到开票页面...');
        await page.goto(INVOICE_PAGE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        sendLogToRenderer('success', '已导航到开票页面');
        return { success: true, message: '已切换身份并导航到开票页面' };
      }
    }

    // 未找到匹配的公司
    const allNames = [];
    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length >= 3) {
        const name = await page.evaluate((el) => el.textContent?.trim() || '', cells[2]);
        allNames.push(name);
      }
    }
    sendLogToRenderer('error', `未找到匹配的企业。可用企业: ${allNames.join(', ')}`);
    return { success: false, message: `未找到匹配企业"${companyName}"，可用: ${allNames.join(', ')}` };

  } catch (err: any) {
    return { success: false, message: `身份切换失败: ${err.message}` };
  }
}

// ===== 开票页面导航 =====

export async function navigateToInvoicePage(): Promise<void> {
  if (!page) throw new Error('浏览器未启动');
  sendLogToRenderer('info', '导航到开票页面...');
  await page.goto(INVOICE_PAGE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  sendLogToRenderer('success', '已打开开票页面');
}

// ===== 发票表单填写 =====

export interface InvoiceFormData {
  title: string;
  taxpayer_id: string;
  amount: number;
  bank_name?: string;
  bank_account?: string;
  register_address?: string;
  register_phone?: string;
  remark?: string;
}

export async function fillInvoiceForm(data: InvoiceFormData): Promise<void> {
  if (!page) throw new Error('浏览器未启动');

  // 确保在开票页面
  const currentUrl = page.url();
  if (!currentUrl.includes('blue-invoice-makeout')) {
    sendLogToRenderer('warn', '当前不在开票页面，请先切换身份进入开票页面');
    throw new Error('当前不在开票页面，请先通过"填写"按钮切换身份');
  }

  sendLogToRenderer('info', `开始填写发票: ${data.title}, 金额: ¥${data.amount}`);

  // 开票页面的具体表单选择器，需要你提供开票页面的 DOM 结构后完善
  // 目前预留框架
  sendLogToRenderer('warn', '请提供开票页面表单的 DOM 选择器以完善自动填写');
}

// ===== PDF 下载 =====

export async function submitAndDownloadPdf(): Promise<string> {
  if (!page) throw new Error('浏览器未启动');
  const downloadDir = getDownloadDir();

  const existingFiles = new Set(fs.readdirSync(downloadDir));

  sendLogToRenderer('info', '等待 PDF 下载...');
  // 税务网站下载逻辑，待根据实际页面调整

  const newFile = await waitForNewFile(downloadDir, existingFiles, 30000);
  sendLogToRenderer('success', `PDF 已下载: ${path.basename(newFile)}`);
  return newFile;
}

async function waitForNewFile(
  dir: string,
  existingFiles: Set<string>,
  timeout: number
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!existingFiles.has(f) && f.endsWith('.pdf') && !f.endsWith('.crdownload')) {
        return path.join(dir, f);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('等待 PDF 下载超时');
}

// ===== 浏览器生命周期 =====

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
    page = null;
  }
}

export async function getCurrentPageUrl(): Promise<string> {
  if (!page) return '';
  try {
    return page.url();
  } catch {
    return '';
  }
}

export async function getPageScreenshot(): Promise<string | null> {
  if (!page) return null;
  try {
    const buf = await page.screenshot({ encoding: 'base64' });
    return `data:image/png;base64,${buf}`;
  } catch {
    return null;
  }
}
