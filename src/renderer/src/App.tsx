import React, { useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { IconBolt } from '@douyinfe/semi-icons';
import SettingsPanel from './components/SettingsPanel';
import TaxInvoicePanel from './components/TaxInvoicePanel';
import InvoiceList from './components/InvoiceList';
import LogPanel from './components/LogPanel';
import type { AppSettings, AutomationLog } from './types/invoice';

export interface SellerInfo {
  nsrsbh: string;
  xhdwmc: string;
  xhdwdzdh: string;
  xhdwyhzh: string;
  username: string;
}

export interface ChannelOption { id: number; name: string; }

const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [sellerInfo, setSellerInfo] = useState<SellerInfo | null>(null);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [allowedChannelIds, setAllowedChannelIds] = useState<number[] | null>(null);

  const apiReady = !!(settings?.apiBaseUrl && settings?.apiToken);
  const taxReady = !!sellerInfo?.nsrsbh;

  const addLog = useCallback((level: 'info' | 'warn' | 'error' | 'success', message: string) => {
    const time = dayjs().format('HH:mm:ss');
    setLogs((prev) => [...prev, { time, level, message }]);
  }, []);

  const handleSettingsChange = (s: AppSettings) => {
    setSettings(s);
    if (s.apiBaseUrl && s.apiToken) {
      addLog('info', `API 已配置: ${s.apiBaseUrl}`);
    }
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-title">
          <span className="header-icon">
            <IconBolt size="small" style={{ color: '#fff' }} />
          </span>
          云雾开票工具
        </div>
        <div className="app-header-status">
          <span className="app-header-status-item">
            <span className={`status-dot ${apiReady ? 'connected' : 'disconnected'}`} />
            API {apiReady ? '已连接' : '未配置'}
          </span>
          <span className="app-header-status-item">
            <span className={`status-dot ${taxReady ? 'connected' : 'disconnected'}`} />
            数电 {taxReady ? '已登录' : '未登录'}
          </span>
        </div>
      </header>

      <div className="app-body">
        <div className="app-sidebar">
          <SettingsPanel onSettingsChange={handleSettingsChange} />
          <TaxInvoicePanel
            onSellerInfoChange={setSellerInfo}
            onLog={addLog}
            channelOptions={channelOptions}
            onAllowedChannelsChange={setAllowedChannelIds}
          />
        </div>

        <div className="app-main">
          <InvoiceList
            apiReady={apiReady}
            sellerInfo={sellerInfo}
            onLog={addLog}
            onIssued={() => setListRefreshKey((k) => k + 1)}
            refreshTrigger={listRefreshKey}
            onChannelOptionsLoad={setChannelOptions}
            allowedChannelIds={allowedChannelIds}
          />
          <LogPanel logs={logs} />
        </div>
      </div>
    </div>
  );
};

export default App;
