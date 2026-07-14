import React, { useEffect, useState } from 'react';
import { Input, Button, Toast, Collapse } from '@douyinfe/semi-ui';
import { IconSetting, IconSearch, IconFolder, IconLink } from '@douyinfe/semi-icons';
import { settingsApi } from '../services/ipc';
import type { AppSettings } from '../types/invoice';

interface Props {
  onSettingsChange: (settings: AppSettings) => void;
}

const SettingsPanel: React.FC<Props> = ({ onSettingsChange }) => {
  const [settings, setSettings] = useState<AppSettings>({
    apiBaseUrl: 'https://yunwu.ai',
    apiToken: '',
    apiUserId: '',
    chromePath: '',
    downloadDir: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const s = await settingsApi.get();
      setSettings(s);
      onSettingsChange(s);
    } catch {}
  };

  const handleSave = async () => {
    if (!settings.apiBaseUrl || !settings.apiToken) {
      Toast.warning('请填写 API 地址和令牌');
      return;
    }
    setSaving(true);
    try {
      await settingsApi.save({
        apiBaseUrl: settings.apiBaseUrl,
        apiToken: settings.apiToken,
        apiUserId: settings.apiUserId,
        chromePath: settings.chromePath,
        downloadDir: settings.downloadDir,
      });
      onSettingsChange(settings);
      Toast.success('设置已保存');
    } catch (err: any) {
      Toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDetectChrome = async () => {
    try {
      const path = await settingsApi.detectChrome();
      if (path) {
        setSettings((s) => ({ ...s, chromePath: path }));
        Toast.success('已检测到 Chrome');
      } else {
        Toast.warning('未检测到 Chrome，请手动指定路径');
      }
    } catch {}
  };

  const handleSelectDir = async () => {
    try {
      const dir = await settingsApi.selectDir();
      if (dir) {
        setSettings((s) => ({ ...s, downloadDir: dir }));
      }
    } catch {}
  };

  const update = (key: keyof AppSettings, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  return (
    <>
      <Collapse defaultActiveKey={['api']} keepDOM className="sidebar-collapse">
        <Collapse.Panel
          header={<><IconLink size="small" style={{ marginRight: 6 }} />API 配置</>}
          itemKey="api"
        >
          <div className="settings-row">
            <label>API 地址</label>
            <Input
              value={settings.apiBaseUrl}
              onChange={(v) => update('apiBaseUrl', v)}
              placeholder="https://yunwu.ai"
            />
          </div>
          <div className="settings-row">
            <label>系统令牌</label>
            <Input
              mode="password"
              value={settings.apiToken}
              onChange={(v) => update('apiToken', v)}
              placeholder="输入系统访问令牌"
            />
          </div>
          <div className="settings-row">
            <label>用户 ID</label>
            <Input
              value={settings.apiUserId}
              onChange={(v) => update('apiUserId', v)}
              placeholder="令牌对应的用户 ID"
            />
          </div>
        </Collapse.Panel>

        <Collapse.Panel
          header={<><IconSetting size="small" style={{ marginRight: 6 }} />Chrome 与下载</>}
          itemKey="chrome"
        >
          <div className="settings-row">
            <label>Chrome 路径</label>
            <Input
              value={settings.chromePath}
              onChange={(v) => update('chromePath', v)}
              placeholder="自动检测或手动输入"
              suffix={
                <Button
                  size="small"
                  theme="borderless"
                  icon={<IconSearch />}
                  onClick={handleDetectChrome}
                />
              }
            />
          </div>
          <div className="settings-row">
            <label>PDF 下载目录</label>
            <Input
              value={settings.downloadDir}
              onChange={(v) => update('downloadDir', v)}
              placeholder="默认使用应用数据目录"
              suffix={
                <Button
                  size="small"
                  theme="borderless"
                  icon={<IconFolder />}
                  onClick={handleSelectDir}
                />
              }
            />
          </div>
        </Collapse.Panel>
      </Collapse>

      <div className="sidebar-section sidebar-section-actions">
        <Button block theme="solid" type="primary" loading={saving} onClick={handleSave}>
          保存设置
        </Button>
      </div>
    </>
  );
};

export default SettingsPanel;
