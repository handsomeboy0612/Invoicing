import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Toast, Spin, Tag, Select, Typography, Space, Divider, RadioGroup, Radio, TabPane, Tabs, Checkbox, CheckboxGroup } from '@douyinfe/semi-ui';
import { IconUser, IconSave, IconRefresh2, IconPlus, IconDelete, IconShield } from '@douyinfe/semi-icons';
import { taxApi } from '../services/ipc';
import type { SellerInfo, ChannelOption } from '../App';

type LoginMethod = 'sms' | 'qr_scan' | 'qr_face';

const SF_OPTIONS = [
  { value: '01', label: '法定代表人' },
  { value: '02', label: '财务负责人' },
  { value: '03', label: '办税员' },
  { value: '05', label: '管理员' },
  { value: '09', label: '开票员' },
  { value: '10', label: '销售人员' },
];

const SELLER_CACHE_KEY = 'tax_seller_cache';
const COMPANY_LIST_KEY = 'tax_company_list';
const LOGIN_CACHE_KEY = 'tax_login_cache';
const CHANNEL_RESTRICTION_KEY = 'tax_channel_restriction';

interface SavedCompany {
  nsrsbh: string;
  name: string;
  sf: string;
}

interface SellerCache {
  xhdwdz?: string;
  xhdwdh?: string;
  xhdwkhyh?: string;
  xhdwzh?: string;
}

function loadSellerCache(nsrsbh: string): SellerCache {
  try {
    const all = JSON.parse(localStorage.getItem(SELLER_CACHE_KEY) || '{}');
    return all[nsrsbh] || {};
  } catch { return {}; }
}

function saveSellerCache(nsrsbh: string, info: SellerCache) {
  try {
    const all = JSON.parse(localStorage.getItem(SELLER_CACHE_KEY) || '{}');
    all[nsrsbh] = { ...all[nsrsbh], ...info };
    localStorage.setItem(SELLER_CACHE_KEY, JSON.stringify(all));
  } catch {}
}

function loadLoginCache(): { nsrsbh: string; username: string; password: string; companyName: string } {
  try {
    return JSON.parse(localStorage.getItem(LOGIN_CACHE_KEY) || '{}');
  } catch { return { nsrsbh: '', username: '', password: '', companyName: '' }; }
}

function saveLoginCache(data: { nsrsbh: string; username: string; password: string; companyName: string }) {
  localStorage.setItem(LOGIN_CACHE_KEY, JSON.stringify(data));
}

function loadCompanyList(): SavedCompany[] {
  try {
    return JSON.parse(localStorage.getItem(COMPANY_LIST_KEY) || '[]');
  } catch { return []; }
}

function saveCompanyList(list: SavedCompany[]) {
  localStorage.setItem(COMPANY_LIST_KEY, JSON.stringify(list));
}

function loadChannelRestriction(nsrsbh: string): number[] | null {
  try {
    const all = JSON.parse(localStorage.getItem(CHANNEL_RESTRICTION_KEY) || '{}');
    const ids = all[nsrsbh];
    return Array.isArray(ids) ? ids : null;
  } catch { return null; }
}

function saveChannelRestriction(nsrsbh: string, ids: number[] | null) {
  try {
    const all = JSON.parse(localStorage.getItem(CHANNEL_RESTRICTION_KEY) || '{}');
    if (ids === null) {
      delete all[nsrsbh];
    } else {
      all[nsrsbh] = ids;
    }
    localStorage.setItem(CHANNEL_RESTRICTION_KEY, JSON.stringify(all));
  } catch {}
}

function maskPassword(params: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...params };
  if (masked.password) masked.password = '***';
  return masked;
}

interface Props {
  onSellerInfoChange: (info: SellerInfo | null) => void;
  onLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  channelOptions: ChannelOption[];
  onAllowedChannelsChange: (ids: number[] | null) => void;
}

export default function TaxInvoicePanel({ onSellerInfoChange, onLog, channelOptions, onAllowedChannelsChange }: Props) {
  const [activeTab, setActiveTab] = useState('login');
  const [taxReady, setTaxReady] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('sms');

  const loginCache = loadLoginCache();
  const [nsrsbh, setNsrsbh] = useState(loginCache.nsrsbh || '');
  const [username, setUsername] = useState(loginCache.username || '');
  const [password, setPassword] = useState(loginCache.password || '');
  const [loginCompanyName, setLoginCompanyName] = useState(loginCache.companyName || '');
  const [authLoading, setAuthLoading] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);

  const [loginStatus, setLoginStatus] = useState<'idle' | 'sms_sent' | 'logged_in' | 'need_face' | 'ok'>('idle');
  const [smsCode, setSmsCode] = useState('');

  const [qrEwmid, setQrEwmid] = useState('');
  const [qrBase64, setQrBase64] = useState('');
  const [qrPolling, setQrPolling] = useState(false);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [faceQrData, setFaceQrData] = useState<{ rzid: string; ewm: string; ewmly?: string } | null>(null);
  const [facePolling, setFacePolling] = useState(false);

  const [smsCountdown, setSmsCountdown] = useState(0);
  const smsCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sf, setSf] = useState('03');
  const [switchLoading, setSwitchLoading] = useState(false);

  const [currentNsrsbh, setCurrentNsrsbh] = useState('');
  const [xhdwdz, setXhdwdz] = useState('');
  const [xhdwdh, setXhdwdh] = useState('');
  const [xhdwkhyh, setXhdwkhyh] = useState('');
  const [xhdwzh, setXhdwzh] = useState('');

  // company list for switching
  const [companyList, setCompanyList] = useState<SavedCompany[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyNsrsbh, setNewCompanyNsrsbh] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanySf, setNewCompanySf] = useState('03');

  const [allowedChannels, setAllowedChannels] = useState<number[]>([]);

  useEffect(() => {
    (async () => {
      const r = await taxApi.getClient();
      setTaxReady(r.ok);
    })();
    setCompanyList(loadCompanyList());
  }, []);

  useEffect(() => {
    saveLoginCache({ nsrsbh, username, password, companyName: loginCompanyName });
  }, [nsrsbh, username, password, loginCompanyName]);

  const startSmsCountdown = () => {
    if (smsCountdownRef.current) clearInterval(smsCountdownRef.current);
    setSmsCountdown(60);
    smsCountdownRef.current = setInterval(() => {
      setSmsCountdown((prev) => {
        if (prev <= 1) {
          if (smsCountdownRef.current) clearInterval(smsCountdownRef.current);
          smsCountdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
      if (qrTimeoutRef.current) clearTimeout(qrTimeoutRef.current);
      if (smsCountdownRef.current) clearInterval(smsCountdownRef.current);
    };
  }, []);

  const applySellerCache = (nsr: string) => {
    const cached = loadSellerCache(nsr);
    setXhdwdz(cached.xhdwdz || '');
    setXhdwdh(cached.xhdwdh || '');
    setXhdwkhyh(cached.xhdwkhyh || '');
    setXhdwzh(cached.xhdwzh || '');
  };

  const markFullyReady = (nsr: string) => {
    setLoginStatus('ok');
    setCurrentNsrsbh(nsr);
    applySellerCache(nsr);
    // 自动将登录公司加入切换列表
    if (loginCompanyName.trim() && nsr) {
      setCompanyList((prev) => {
        if (prev.some((c) => c.nsrsbh === nsr)) return prev;
        const updated = [{ nsrsbh: nsr, name: loginCompanyName.trim(), sf: '03' }, ...prev];
        saveCompanyList(updated);
        return updated;
      });
    }
  };

  const xhdwmc = companyList.find((c) => c.nsrsbh === currentNsrsbh)?.name || loginCompanyName || '';
  const buildXhdwdzdh = () => [xhdwdz.trim(), xhdwdh.trim()].filter(Boolean).join(' ');
  const buildXhdwyhzh = () => [xhdwkhyh.trim(), xhdwzh.trim()].filter(Boolean).join(' ');

  const emitSellerInfo = (nsr: string) => {
    onSellerInfoChange({
      nsrsbh: nsr, xhdwmc: xhdwmc.trim(), xhdwdzdh: buildXhdwdzdh(),
      xhdwyhzh: buildXhdwyhzh(), username: username.trim(),
    });
  };

  useEffect(() => {
    if (currentNsrsbh && loginStatus === 'ok') emitSellerInfo(currentNsrsbh);
  }, [currentNsrsbh, loginStatus, xhdwmc, xhdwdz, xhdwdh, xhdwkhyh, xhdwzh, username, companyList, loginCompanyName]);

  useEffect(() => {
    const saved = currentNsrsbh ? loadChannelRestriction(currentNsrsbh) : null;
    const ids = saved || [];
    setAllowedChannels(ids);
    onAllowedChannelsChange(ids);
  }, [currentNsrsbh]);

  const handleSaveSellerInfo = () => {
    const nsr = currentNsrsbh || nsrsbh.trim();
    if (!nsr) { Toast.warning('请先登录'); return; }
    saveSellerCache(nsr, { xhdwdz: xhdwdz.trim(), xhdwdh: xhdwdh.trim(), xhdwkhyh: xhdwkhyh.trim(), xhdwzh: xhdwzh.trim() });
    Toast.success('销方信息已缓存');
    onLog('success', `销方信息已缓存: ${nsr}`);
  };

  const ensureAuthorization = async (forceRefresh = false): Promise<boolean> => {
    if (!nsrsbh.trim()) { Toast.warning('请输入纳税人识别号'); return false; }
    onLog('info', `[授权] 获取 token: nsrsbh="${nsrsbh.trim()}"${forceRefresh ? ' (强制刷新)' : ''}`);
    const res = await taxApi.getAuthorization(nsrsbh.trim(), undefined, forceRefresh);
    if (res.code !== 200) {
      if (!forceRefresh) {
        onLog('warn', `[授权] 缓存 token 可能失效，尝试重新获取...`);
        return ensureAuthorization(true);
      }
      onLog('error', `[授权] 失败 code=${res.code} msg=${res.msg}`);
      Toast.error(`获取授权失败: ${res.msg}`);
      return false;
    }
    const cached = res.msg?.includes('cached');
    onLog('success', `[授权] 成功${cached ? '（缓存）' : '（新获取）'}, token已就绪`);
    setTokenReady(true);
    return true;
  };

  const checkFaceAuthAfterLogin = async (nsr: string) => {
    try {
      onLog('info', `[认证状态] POST /v5/enterprise/queryFaceAuthState 参数: { nsrsbh: "${nsr}" }`);
      const res = await taxApi.queryFaceAuthState(nsr, username.trim() || undefined);
      onLog('info', `[认证状态] 返回 code=${res.code} msg=${res.msg}`);

      if (res.code === 200) {
        markFullyReady(nsr);
        onLog('success', '登录成功，认证通过，可以开票');
        Toast.success('登录成功，认证通过');
        return;
      }
      if (res.code === 430) {
        setLoginStatus('need_face');
        onLog('warn', '登录成功，但需要人脸认证（code=430）');
        Toast.warning('登录成功，需要人脸认证');

        onLog('info', `[人脸二维码] GET /v5/enterprise/getFaceImg 参数: { nsrsbh: "${nsr}" }`);
        const qrRes = await taxApi.getFaceImg(nsr, username.trim() || undefined, '1');
        onLog('info', `[人脸二维码] 返回 code=${qrRes.code} msg=${qrRes.msg} data.rzid=${qrRes.data?.rzid || 'N/A'} data.ewmly=${qrRes.data?.ewmly || 'N/A'}`);

        if (qrRes.code === 200 && qrRes.data) {
          setFaceQrData({ rzid: qrRes.data.rzid, ewm: qrRes.data.ewm, ewmly: qrRes.data.ewmly });
          startFacePolling(qrRes.data.rzid, nsr);
        } else {
          onLog('error', `获取人脸二维码失败: ${qrRes.msg}`);
          Toast.error(qrRes.msg || '获取人脸二维码失败');
        }
        return;
      }
      markFullyReady(nsr);
      onLog('success', `认证通过 (code=${res.code})，可以开票`);
    } catch (e: any) {
      onLog('warn', `认证状态检查异常: ${e.message}，按已通过处理`);
      markFullyReady(nsr);
    }
  };

  const startFacePolling = (rzid: string, nsr: string) => {
    setFacePolling(true);
    onLog('info', `[人脸轮询] 开始轮询 rzid=${rzid}`);
    const un = username.trim() || undefined;
    const t = setInterval(async () => {
      const res = await taxApi.getFaceState(nsr, rzid, un, '1');
      if (res.code === 200 && res.data?.slzt === '2') {
        clearInterval(t); setFacePolling(false); setFaceQrData(null);
        markFullyReady(nsr);
        onLog('success', '人脸认证成功');
        Toast.success('人脸认证成功');
      } else if (res.data?.slzt === '3') {
        clearInterval(t); setFacePolling(false);
        onLog('warn', '人脸二维码已过期');
        Toast.warning('二维码已过期，请重新获取');
      }
    }, 2000);
    setTimeout(() => { clearInterval(t); setFacePolling(false); }, 120000);
  };

  const faceQrImageUrl =
    faceQrData?.ewmly === 'grsds'
      ? `data:image/png;base64,${faceQrData.ewm}`
      : faceQrData?.ewm
        ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(faceQrData.ewm)}`
        : '';

  const handleSendSms = async () => {
    if (!nsrsbh.trim() || !username.trim() || !password) {
      Toast.warning('请填写纳税人识别号、电票账号、密码'); return;
    }
    setAuthLoading(true);
    try {
      if (!await ensureAuthorization()) return;
      const params = { nsrsbh: nsrsbh.trim(), username: username.trim(), password };
      onLog('info', `[登录-验证码] POST /v5/enterprise/loginDppt 参数: ${JSON.stringify(maskPassword(params))}`);
      const res = await taxApi.loginDppt(params);
      onLog('info', `[登录-验证码] 返回 code=${res.code} msg=${res.msg}`);
      if (res.code === 200) {
        onLog('success', `验证码已发送: ${res.msg}`);
        Toast.success(res.msg || '验证码已发送');
        setLoginStatus('sms_sent');
        startSmsCountdown();
      } else {
        onLog('error', `发送验证码失败: code=${res.code} msg=${res.msg}`);
        Toast.error(res.msg || '发送失败');
      }
    } catch (e: any) {
      onLog('error', `发送验证码异常: ${e.message}`);
      Toast.error(e.message);
    } finally { setAuthLoading(false); }
  };

  const handleLoginWithSms = async () => {
    if (!smsCode.trim()) { Toast.warning('请填写验证码'); return; }
    setAuthLoading(true);
    try {
      const params = { nsrsbh: nsrsbh.trim(), username: username.trim(), password, sms: smsCode.trim() };
      onLog('info', `[登录-验证码] POST /v5/enterprise/loginDppt 参数: ${JSON.stringify(maskPassword(params))}`);
      const res = await taxApi.loginDppt(params);
      onLog('info', `[登录-验证码] 返回 code=${res.code} msg=${res.msg} data=${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`);
      if (res.code === 200) {
        onLog('success', '验证码登录成功');
        setLoginStatus('logged_in');
        await checkFaceAuthAfterLogin(nsrsbh.trim());
      } else {
        onLog('error', `验证码登录失败: code=${res.code} msg=${res.msg}`);
        Toast.error(res.msg || '登录失败');
      }
    } catch (e: any) {
      onLog('error', `验证码登录异常: ${e.message}`);
      Toast.error(e.message);
    } finally { setAuthLoading(false); }
  };

  const stopQrPolling = () => {
    if (qrTimerRef.current) { clearTimeout(qrTimerRef.current); qrTimerRef.current = null; }
    if (qrTimeoutRef.current) { clearTimeout(qrTimeoutRef.current); qrTimeoutRef.current = null; }
    setQrPolling(false);
  };

  const getEwmlxValue = (): string => {
    if (loginMethod === 'qr_scan') return '10';
    if (loginMethod === 'qr_face') return '1';
    return '10';
  };

  const getEwmlxLabel = (ewmlx: string): string => {
    const map: Record<string, string> = { '10': '税务APP扫码', '1': '税务人脸二维码', '3': '个税APP扫码', '2': '个税人脸二维码' };
    return map[ewmlx] || ewmlx;
  };

  const handleGetQrCode = async () => {
    if (!nsrsbh.trim() || !username.trim() || !password) {
      Toast.warning('请填写纳税人识别号、电票账号、密码'); return;
    }
    setAuthLoading(true);
    setQrBase64(''); setQrEwmid('');
    stopQrPolling();
    try {
      if (!await ensureAuthorization()) return;
      const ewmlx = getEwmlxValue();
      const params = { nsrsbh: nsrsbh.trim(), username: username.trim(), password, ewmlx };
      onLog('info', `[登录-${getEwmlxLabel(ewmlx)}] POST /v5/enterprise/loginDppt 参数: ${JSON.stringify(maskPassword(params))}`);
      const res = await taxApi.loginDppt(params);
      onLog('info', `[登录-${getEwmlxLabel(ewmlx)}] 返回 code=${res.code} msg=${res.msg} data.ewmid=${(res.data as any)?.ewmid || 'N/A'} data.qrcode=${(res.data as any)?.qrcode ? '(base64,已省略)' : 'N/A'}`);

      if ((res.data as any)?.ewmid && (res.data as any)?.qrcode) {
        const data = res.data as any;
        setQrEwmid(data.ewmid);
        setQrBase64(data.qrcode || '');
        onLog('success', `二维码已生成 ewmid=${data.ewmid}，等待扫码...`);
        Toast.info(res.msg || '二维码已生成，请扫码');
        startQrPolling(data.ewmid, ewmlx);
      } else if (res.code === 200 && !(res.data as any)?.ewmid) {
        onLog('success', '扫码登录直接成功');
        setLoginStatus('logged_in');
        await checkFaceAuthAfterLogin(nsrsbh.trim());
      } else {
        onLog('error', `获取二维码失败: code=${res.code} msg=${res.msg}`);
        Toast.error(res.msg || '获取二维码失败');
      }
    } catch (e: any) {
      onLog('error', `获取二维码异常: ${e.message}`);
      Toast.error(e.message);
    } finally { setAuthLoading(false); }
  };

  const startQrPolling = (ewmid: string, ewmlx: string) => {
    setQrPolling(true);
    onLog('info', `[扫码轮询] 开始轮询 ewmid=${ewmid} ewmlx=${ewmlx}`);
    const pollOnce = async () => {
      try {
        const res = await taxApi.loginDppt({
          nsrsbh: nsrsbh.trim(), username: username.trim(), password, ewmlx, ewmid,
        });
        if (res.code === 200 && !(res.data as any)?.ewmid) {
          stopQrPolling();
          setQrBase64(''); setQrEwmid('');
          onLog('success', '扫码登录成功');
          setLoginStatus('logged_in');
          await checkFaceAuthAfterLogin(nsrsbh.trim());
          return;
        }
      } catch {}
      qrTimerRef.current = setTimeout(pollOnce, 3000);
    };
    qrTimerRef.current = setTimeout(pollOnce, 3000);
    qrTimeoutRef.current = setTimeout(() => {
      stopQrPolling();
      onLog('warn', '扫码二维码已过期（2分钟超时）');
      Toast.warning('二维码已过期，请重新获取');
    }, 120000);
  };

  // ========== 公司列表管理 ==========
  const handleAddCompany = () => {
    if (!newCompanyNsrsbh.trim() || !newCompanyName.trim()) {
      Toast.warning('请填写税号和公司名称'); return;
    }
    if (companyList.some((c) => c.nsrsbh === newCompanyNsrsbh.trim())) {
      Toast.warning('该税号已在列表中'); return;
    }
    const updated = [...companyList, { nsrsbh: newCompanyNsrsbh.trim(), name: newCompanyName.trim(), sf: newCompanySf }];
    setCompanyList(updated);
    saveCompanyList(updated);
    setNewCompanyNsrsbh('');
    setNewCompanyName('');
    setNewCompanySf('03');
    setAddingCompany(false);
    Toast.success('公司已添加');
  };

  const handleRemoveCompany = (nsrToRemove: string) => {
    const updated = companyList.filter((c) => c.nsrsbh !== nsrToRemove);
    setCompanyList(updated);
    saveCompanyList(updated);
    if (selectedCompany === nsrToRemove) setSelectedCompany('');
  };

  const handleSwitchCompany = async () => {
    const target = companyList.find((c) => c.nsrsbh === selectedCompany);
    if (!target) { Toast.warning('请选择要切换的公司'); return; }
    if (!currentNsrsbh) { Toast.warning('请先登录'); return; }
    if (!username.trim()) { Toast.warning('缺少电票账号，请先登录'); return; }
    if (target.nsrsbh === currentNsrsbh) { Toast.info('已在当前公司'); return; }

    setSwitchLoading(true);
    try {
      const params = { oldNsrsbh: currentNsrsbh, newNsrsbh: target.nsrsbh, username: username.trim(), sf: target.sf };
      onLog('info', `[切换公司] POST /v5/enterprise/changeUser 参数: ${JSON.stringify(params)}`);
      const res = await taxApi.changeUser(params);
      onLog('info', `[切换公司] 返回 code=${res.code} msg=${res.msg}`);
      if (res.code === 200) {
        setCurrentNsrsbh(target.nsrsbh);
        setSelectedCompany('');
        applySellerCache(target.nsrsbh);
        onLog('success', `切换成功: ${target.name} (${target.nsrsbh})`);
        Toast.success(`已切换到 ${target.name}`);
      } else {
        onLog('error', `切换失败: code=${res.code} msg=${res.msg}`);
        Toast.error(res.msg || '切换失败');
      }
    } catch (e: any) {
      onLog('error', `切换异常: ${e.message}`);
      Toast.error(e.message);
    } finally { setSwitchLoading(false); }
  };

  const handleSaveChannelRestriction = (ids: number[]) => {
    setAllowedChannels(ids);
    if (currentNsrsbh) {
      saveChannelRestriction(currentNsrsbh, ids);
      onAllowedChannelsChange(ids);
    }
  };

  const companySelectOptions = companyList
    .filter((c) => c.nsrsbh !== currentNsrsbh)
    .map((c) => ({
      value: c.nsrsbh,
      label: c.name,
    }));

  const isLoggedIn = loginStatus === 'ok';

  return (
    <div className="sidebar-section" style={{ paddingTop: 12 }}>
      <div className="sidebar-section-title">
        <IconUser size="small" />
        数电开票 (API)
        {isLoggedIn && (
          <Tag color="green" size="small" style={{ marginLeft: 'auto' }}>已就绪</Tag>
        )}
        {!taxReady && !isLoggedIn && (
          <Tag color="red" size="small" style={{ marginLeft: 'auto' }}>未配置</Tag>
        )}
      </div>

      <Tabs
        type="button"
        size="small"
        activeKey={activeTab}
        onChange={(key) => {
          if ((key === 'switch' || key === 'seller' || key === 'channel') && !isLoggedIn) {
            Toast.warning('请先完成登录');
            return;
          }
          setActiveTab(key);
        }}
        style={{ marginBottom: 14 }}
      >
        <TabPane tab="登录" itemKey="login" />
        <TabPane tab="切换公司" itemKey="switch" disabled={!isLoggedIn} />
        <TabPane tab="销方信息" itemKey="seller" disabled={!isLoggedIn} />
        <TabPane tab="渠道限制" itemKey="channel" disabled={!isLoggedIn} />
      </Tabs>

      {activeTab === 'login' && !isLoggedIn && (
        <>
          <div className="settings-row">
            <label>公司名称</label>
            <Input value={loginCompanyName} onChange={setLoginCompanyName} placeholder="仅用于标识，不参与登录" />
          </div>
          <div className="settings-row">
            <label>纳税人识别号</label>
            <Input value={nsrsbh} onChange={setNsrsbh} placeholder="统一社会信用代码" />
          </div>
          <div className="settings-row">
            <label>电票账号</label>
            <Input value={username} onChange={setUsername} placeholder="手机号" />
          </div>
          <div className="settings-row">
            <label>密码</label>
            <Input mode="password" value={password} onChange={setPassword} placeholder="电票平台密码" />
          </div>

          <Divider margin="14px 0" />

          <div className="settings-row">
            <label>登录方式</label>
            <RadioGroup
              value={loginMethod}
              onChange={(e) => setLoginMethod(e.target.value as LoginMethod)}
              type="button"
              style={{ width: '100%' }}
            >
              <Radio value="sms">验证码</Radio>
              <Radio value="qr_scan">扫码</Radio>
              <Radio value="qr_face">人脸</Radio>
            </RadioGroup>
          </div>

          {loginMethod === 'sms' && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
                获取授权 → 发送验证码 → 输入验证码完成登录
              </Typography.Text>
              {loginStatus !== 'sms_sent' && (
                <Button block type="primary" theme="solid" loading={authLoading} disabled={smsCountdown > 0} onClick={handleSendSms}>
                  {smsCountdown > 0 ? `${smsCountdown}s 后可重新发送` : '发送验证码'}
                </Button>
              )}
              {loginStatus === 'sms_sent' && (
                <Space vertical spacing="medium" style={{ width: '100%' }}>
                  <div className="settings-row">
                    <label>短信验证码</label>
                    <Input value={smsCode} onChange={setSmsCode} placeholder="输入收到的验证码" />
                  </div>
                  <Space style={{ width: '100%' }}>
                    <Button loading={authLoading} disabled={smsCountdown > 0} onClick={handleSendSms}>
                      {smsCountdown > 0 ? `重新发送(${smsCountdown}s)` : '重新发送'}
                    </Button>
                    <Button type="primary" theme="solid" loading={authLoading} onClick={handleLoginWithSms}>验证码登录</Button>
                  </Space>
                </Space>
              )}
            </div>
          )}

          {loginMethod === 'qr_scan' && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
                获取授权 → 生成二维码 → 用电子税务局APP扫码
              </Typography.Text>
              <Button block type="primary" theme="solid" loading={authLoading} onClick={handleGetQrCode}>
                获取扫码二维码
              </Button>
              {qrBase64 && (
                <div className="tax-qr-card">
                  <div className="tax-qr-card-inner">
                    <img src={`data:image/png;base64,${qrBase64}`} alt="扫码" className="tax-qr-img" />
                  </div>
                  <div className="tax-qr-hint">请使用 <strong>电子税务局APP</strong> 扫码</div>
                  {qrPolling && (
                    <div className="tax-qr-polling">
                      <Spin size="small" />
                      <span>等待扫码中...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {loginMethod === 'qr_face' && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
                获取授权 → 生成人脸二维码 → 用税务局APP扫码完成人脸登录
              </Typography.Text>
              <Button block type="primary" theme="solid" loading={authLoading} onClick={handleGetQrCode}>
                获取人脸二维码
              </Button>
              {qrBase64 && (
                <div className="tax-qr-card">
                  <div className="tax-qr-card-inner">
                    <img src={`data:image/png;base64,${qrBase64}`} alt="人脸二维码" className="tax-qr-img" />
                  </div>
                  <div className="tax-qr-hint">请使用 <strong>税务局APP</strong> 扫码进行人脸认证</div>
                  {qrPolling && (
                    <div className="tax-qr-polling">
                      <Spin size="small" />
                      <span>等待人脸认证中...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {loginStatus === 'need_face' && faceQrData && (
            <div className="tax-qr-card" style={{ marginTop: 14 }}>
              <Tag color="orange" size="small" style={{ marginBottom: 8 }}>登录成功，需要额外人脸认证</Tag>
              {faceQrImageUrl && (
                <div className="tax-qr-card-inner">
                  <img src={faceQrImageUrl} alt="人脸认证" className="tax-qr-img" />
                </div>
              )}
              <div className="tax-qr-hint">
                {faceQrData.ewmly === 'grsds' ? '请使用 个人所得税APP 扫码' : '请使用 电子税务局APP 扫码'}
              </div>
              {facePolling && (
                <div className="tax-qr-polling">
                  <Spin size="small" />
                  <span>等待人脸认证中...</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'login' && isLoggedIn && (
        <div className="tax-logged-card">
          <div className="tax-logged-icon">&#10003;</div>
          <Typography.Title heading={6} style={{ margin: '8px 0 4px' }}>数电平台已就绪</Typography.Title>
          {loginCompanyName && <Typography.Text type="tertiary" size="small">{loginCompanyName}</Typography.Text>}
          <Typography.Text type="tertiary" size="small" style={{ marginTop: 2 }}>{currentNsrsbh}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ marginTop: 2 }}>账号: {username}</Typography.Text>
          <Divider margin="16px 0" />
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <Button
              block theme="light"
              onClick={() => {
                setLoginStatus('idle');
                setQrBase64(''); setQrEwmid('');
                stopQrPolling();
                setFaceQrData(null); setFacePolling(false);
                setSmsCode('');
                setCurrentNsrsbh('');
                onSellerInfoChange(null);
                onLog('info', '已退出登录，可重新登录');
              }}
            >
              重新登录
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'switch' && isLoggedIn && (
        <>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            当前: {companyList.find((c) => c.nsrsbh === currentNsrsbh)?.name || loginCompanyName || currentNsrsbh}（{currentNsrsbh}）
          </Typography.Text>

          <div className="settings-row">
            <label>切换到</label>
            <Select
              value={selectedCompany}
              onChange={(v) => setSelectedCompany(v as string)}
              optionList={companySelectOptions}
              placeholder={companyList.length === 0 ? '请先添加公司' : '选择要切换的公司'}
              style={{ width: '100%' }}
              emptyContent="暂无公司，请点击下方添加"
              renderOptionItem={(renderProps: any) => {
                const { label, value, selected, focused, className, style, onMouseEnter, onClick } = renderProps;
                return (
                  <div
                    className={className}
                    style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', background: selected ? '#eff6ff' : focused ? '#f8fafc' : undefined }}
                    onMouseEnter={onMouseEnter}
                    onClick={onClick}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{value}</div>
                    </div>
                    <Button
                      size="small"
                      type="danger"
                      theme="borderless"
                      icon={<IconDelete />}
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRemoveCompany(value); }}
                      style={{ flexShrink: 0, marginLeft: 8 }}
                    />
                  </div>
                );
              }}
            />
          </div>

          <Button
            block type="primary" theme="solid"
            loading={switchLoading}
            onClick={handleSwitchCompany}
            disabled={!selectedCompany}
            style={{ marginTop: 4 }}
          >
            <IconRefresh2 style={{ marginRight: 6 }} />
            切换公司
          </Button>

          <Divider margin="14px 0" />

          {!addingCompany ? (
            <Button block theme="light" icon={<IconPlus />} onClick={() => setAddingCompany(true)}>
              添加公司
            </Button>
          ) : (
            <div style={{ background: 'var(--app-border-light)', borderRadius: 8, padding: 12 }}>
              <div className="settings-row">
                <label>公司名称</label>
                <Input value={newCompanyName} onChange={setNewCompanyName} placeholder="如：北京某某科技有限公司" />
              </div>
              <div className="settings-row">
                <label>纳税人识别号</label>
                <Input value={newCompanyNsrsbh} onChange={setNewCompanyNsrsbh} placeholder="统一社会信用代码" />
              </div>
              <div className="settings-row">
                <label>身份</label>
                <Select value={newCompanySf} onChange={(v) => setNewCompanySf(v as string)} optionList={SF_OPTIONS} style={{ width: '100%' }} />
              </div>
              <Space style={{ width: '100%', marginTop: 4 }}>
                <Button theme="light" onClick={() => { setAddingCompany(false); setNewCompanyNsrsbh(''); setNewCompanyName(''); }}>取消</Button>
                <Button type="primary" theme="solid" onClick={handleAddCompany}>确认添加</Button>
              </Space>
            </div>
          )}
        </>
      )}

      {activeTab === 'seller' && isLoggedIn && (
        <>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            当前: {currentNsrsbh}，填写后自动缓存，切换公司时自动恢复
          </Typography.Text>
          <div className="settings-row">
            <label>销方名称</label>
            <Input value={xhdwmc} disabled placeholder="自动获取" />
          </div>
          <div className="settings-row">
            <label>销方地址</label>
            <Input value={xhdwdz} onChange={setXhdwdz} placeholder="如：重庆市渝中区经纬大道789号15层" />
          </div>
          <div className="settings-row">
            <label>电话</label>
            <Input value={xhdwdh} onChange={setXhdwdh} placeholder="如：023-12345678" />
          </div>
          <div className="settings-row">
            <label>开户银行</label>
            <Input value={xhdwkhyh} onChange={setXhdwkhyh} placeholder="如：中国工商银行重庆分行" />
          </div>
          <div className="settings-row">
            <label>银行账号</label>
            <Input value={xhdwzh} onChange={setXhdwzh} placeholder="银行账号" />
          </div>
          <Button block theme="light" icon={<IconSave />} onClick={handleSaveSellerInfo} style={{ marginTop: 6 }}>
            保存销方信息
          </Button>
        </>
      )}

      {activeTab === 'channel' && isLoggedIn && (
        <>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            为 <strong>{companyList.find((c) => c.nsrsbh === currentNsrsbh)?.name || loginCompanyName || currentNsrsbh}</strong> 配置允许开票的支付渠道。仅勾选的渠道可开票，未勾选任何渠道时禁止所有开票操作。
          </Typography.Text>

          {channelOptions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
              <IconShield size="extra-large" style={{ color: '#cbd5e1', marginBottom: 8 }} />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
                暂无渠道数据，请先在右侧查询发票列表以加载渠道选项
              </Typography.Text>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                <Button
                  size="small"
                  theme="light"
                  onClick={() => handleSaveChannelRestriction(channelOptions.map((c) => c.id))}
                >
                  全选
                </Button>
                <Button
                  size="small"
                  theme="light"
                  type="danger"
                  onClick={() => handleSaveChannelRestriction([])}
                >
                  清空(全部禁止)
                </Button>
              </div>
              <CheckboxGroup
                value={allowedChannels}
                onChange={(val) => handleSaveChannelRestriction(val as number[])}
                direction="vertical"
                style={{ width: '100%' }}
              >
                {channelOptions.map((ch) => (
                  <Checkbox key={ch.id} value={ch.id} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}>{ch.name}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>#{ch.id}</span>
                  </Checkbox>
                ))}
              </CheckboxGroup>

              <Divider margin="14px 0" />
              <div style={{ padding: '8px 0' }}>
                {allowedChannels.length > 0 ? (
                  <Tag color="green" size="small">
                    <IconShield size="small" style={{ marginRight: 4 }} />
                    已允许 {allowedChannels.length} 个渠道开票
                  </Tag>
                ) : (
                  <Tag color="red" size="small">未勾选任何渠道，当前禁止所有开票</Tag>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
