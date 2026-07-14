"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    // 设置
    getSettings: () => electron_1.ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('settings:save', settings),
    detectChrome: () => electron_1.ipcRenderer.invoke('settings:detectChrome'),
    selectDir: () => electron_1.ipcRenderer.invoke('settings:selectDir'),
    // API 调用
    initApi: (baseUrl, token) => electron_1.ipcRenderer.invoke('api:init', baseUrl, token),
    fetchInvoiceList: (params) => electron_1.ipcRenderer.invoke('api:fetchInvoiceList', params),
    fetchInvoiceDetail: (id) => electron_1.ipcRenderer.invoke('api:fetchInvoiceDetail', id),
    uploadInvoicePdf: (id, pdfPath) => electron_1.ipcRenderer.invoke('api:uploadInvoicePdf', id, pdfPath),
    sendInvoiceEmail: (id) => electron_1.ipcRenderer.invoke('api:sendInvoiceEmail', id),
    updateInvoiceStatus: (id, status) => electron_1.ipcRenderer.invoke('api:updateInvoiceStatus', id, status),
    // 浏览器自动化
    launchBrowser: () => electron_1.ipcRenderer.invoke('browser:launch'),
    closeBrowser: () => electron_1.ipcRenderer.invoke('browser:close'),
    checkBrowserAlive: () => electron_1.ipcRenderer.invoke('browser:checkAlive'),
    navigateToInvoice: () => electron_1.ipcRenderer.invoke('browser:navigateToInvoice'),
    fillInvoiceForm: (data) => electron_1.ipcRenderer.invoke('browser:fillForm', data),
    submitAndDownload: () => electron_1.ipcRenderer.invoke('browser:submitAndDownload'),
    getPageUrl: () => electron_1.ipcRenderer.invoke('browser:getPageUrl'),
    getScreenshot: () => electron_1.ipcRenderer.invoke('browser:screenshot'),
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
