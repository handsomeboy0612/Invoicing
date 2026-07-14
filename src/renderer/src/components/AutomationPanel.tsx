import React, { useState, useEffect } from 'react';
import { Button, Tag, Space } from '@douyinfe/semi-ui';
import {
  IconPlay,
  IconStop,
  IconLink,
  IconUnlink,
  IconTick,
  IconRefresh,
} from '@douyinfe/semi-icons';
import { browserApi } from '../services/ipc';
import type { AutomationStatus } from '../types/invoice';

interface Props {
  status: AutomationStatus;
  onStatusChange: (status: AutomationStatus) => void;
  onLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  browserConnected: boolean;
  onBrowserConnectedChange: (connected: boolean) => void;
}

const AutomationPanel: React.FC<Props> = ({
  status,
  onStatusChange,
  onLog,
  browserConnected,
  onBrowserConnectedChange,
}) => {
  const [launching, setLaunching] = useState(false);
  const [loginChecking, setLoginChecking] = useState(false);
  const [waitingLogin, setWaitingLogin] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [loginStatus, setLoginStatus] = useState<'unknown' | 'logged_in' | 'not_logged_in'>('unknown');

  // 监听主进程推送的日志
  useEffect(() => {
    browserApi.onAutomationLog((data) => {
      onLog(data.level as any, data.message);
    });
    return () => {
      browserApi.removeAutomationLogListener();
    };
  }, [onLog]);

  const handleLaunchBrowser = async () => {
    setLaunching(true);
    onStatusChange('connecting');
    onLog('info', '正在启动 Chrome 浏览器...');
    try {
      const res = await browserApi.launch();
      if (res.success) {
        onBrowserConnectedChange(true);
        onStatusChange('waiting_login');
        onLog('success', 'Chrome 已启动，已打开税务网站');
        // 自动检查登录状态
        setTimeout(() => handleCheckLogin(), 1000);
      } else {
        onStatusChange('error');
        onLog('error', '启动失败: ' + (res.message || '未知错误'));
      }
    } catch (err: any) {
      onStatusChange('error');
      onLog('error', '启动异常: ' + err.message);
    } finally {
      setLaunching(false);
    }
  };

  const handleCloseBrowser = async () => {
    try {
      await browserApi.close();
      onBrowserConnectedChange(false);
      onStatusChange('idle');
      setLoginStatus('unknown');
      onLog('info', 'Chrome 浏览器已关闭');
    } catch (err: any) {
      onLog('error', '关闭失败: ' + err.message);
    }
  };

  const handleCheckLogin = async () => {
    setLoginChecking(true);
    onLog('info', '检测登录状态...');
    try {
      const res = await browserApi.checkLogin();
      if (res.loggedIn) {
        setLoginStatus('logged_in');
        onStatusChange('processing');
        onLog('success', `已登录: ${res.message}`);
      } else {
        setLoginStatus('not_logged_in');
        onStatusChange('waiting_login');
        onLog('warn', `未登录: ${res.message}`);
      }
    } catch (err: any) {
      onLog('error', '检测失败: ' + err.message);
    } finally {
      setLoginChecking(false);
    }
  };

  const handleClickLogin = async () => {
    onLog('info', '点击登录按钮...');
    try {
      const res = await browserApi.clickLogin();
      if (res.success) {
        onLog('info', res.message);
        // 自动开始等待登录
        handleWaitLogin();
      } else {
        onLog('error', res.message);
      }
    } catch (err: any) {
      onLog('error', '操作失败: ' + err.message);
    }
  };

  const handleWaitLogin = async () => {
    setWaitingLogin(true);
    onLog('info', '等待用户登录（5分钟超时）...');
    try {
      const res = await browserApi.waitLogin(300000);
      if (res.success) {
        setLoginStatus('logged_in');
        onStatusChange('processing');
        onLog('success', '登录成功！');
        // 登录成功后自动导航
        setTimeout(() => handleNavigateAfterLogin(), 1000);
      } else {
        onLog('error', res.message);
      }
    } catch (err: any) {
      onLog('error', '等待失败: ' + err.message);
    } finally {
      setWaitingLogin(false);
    }
  };

  const handleNavigateAfterLogin = async () => {
    setNavigating(true);
    onLog('info', '登录后导航...');
    try {
      const res = await browserApi.navigateAfterLogin();
      if (res.success) {
        onLog('success', res.message);
      } else {
        onLog('warn', res.message);
      }
    } catch (err: any) {
      onLog('error', '导航失败: ' + err.message);
    } finally {
      setNavigating(false);
    }
  };

  const getLoginTag = () => {
    switch (loginStatus) {
      case 'logged_in':
        return <Tag color="green" size="small" prefixIcon={<IconTick />}>已登录</Tag>;
      case 'not_logged_in':
        return <Tag color="orange" size="small">未登录</Tag>;
      default:
        return <Tag color="grey" size="small">未检测</Tag>;
    }
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-title">
        <IconPlay />
        自动化控制
      </div>

      <Space wrap spacing="tight" style={{ marginBottom: 12 }}>
        <Tag
          color={browserConnected ? 'green' : 'grey'}
          size="small"
          prefixIcon={browserConnected ? <IconLink /> : <IconUnlink />}
        >
          {browserConnected ? 'Chrome' : '未连接'}
        </Tag>
        {browserConnected && getLoginTag()}
      </Space>

      {!browserConnected ? (
        <Button
          icon={<IconPlay />}
          theme="solid"
          type="primary"
          loading={launching}
          onClick={handleLaunchBrowser}
          block
        >
          启动 Chrome
        </Button>
      ) : (
        <Space vertical spacing="medium" style={{ width: '100%' }}>
          {loginStatus !== 'logged_in' && (
            <>
              <Button
                size="small"
                loading={loginChecking}
                icon={<IconRefresh />}
                onClick={handleCheckLogin}
                block
              >
                检测登录状态
              </Button>
              {loginStatus === 'not_logged_in' && !waitingLogin && (
                <Button
                  size="small"
                  type="primary"
                  theme="light"
                  onClick={handleClickLogin}
                  block
                >
                  点击登录按钮
                </Button>
              )}
              {waitingLogin && (
                <Button size="small" loading block disabled>
                  等待登录中...
                </Button>
              )}
            </>
          )}

          {loginStatus === 'logged_in' && (
            <Button
              size="small"
              type="primary"
              theme="light"
              loading={navigating}
              onClick={handleNavigateAfterLogin}
              block
            >
              进入账户中心
            </Button>
          )}

          <Button
            icon={<IconStop />}
            type="danger"
            theme="solid"
            size="small"
            onClick={handleCloseBrowser}
            block
          >
            关闭 Chrome
          </Button>
        </Space>
      )}
    </div>
  );
};

export default AutomationPanel;
