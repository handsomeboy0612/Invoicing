import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table, Button, Tag, Space, Select, Input, Toast, Modal, Card, Typography, Tooltip, Divider,
  Tabs, TabPane, Popconfirm, Progress, Checkbox, DatePicker,
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch, IconMail, IconEyeOpened, IconDelete, IconPlay, IconStop, IconPlus } from '@douyinfe/semi-icons';
import dayjs from 'dayjs';
import { invoiceApi, taxApi } from '../services/ipc';
import type { InvoiceRecord, QueueItem, QueueProductCode } from '../types/invoice';
import type { SellerInfo, ChannelOption } from '../App';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待开票' },
  { value: 'issued', label: '已开票' },
  { value: 'sent', label: '已寄送' },
  { value: 'returned', label: '已退回' },
  { value: 'red_locked', label: '冲红锁定' },
  { value: 'red_flushed', label: '已红冲' },
];
const STATUS_COLORS: Record<string, string> = { pending: 'orange', issued: 'green', sent: 'blue', returned: 'red', red_locked: 'grey', red_flushed: 'purple' };
const STATUS_LABELS: Record<string, string> = { pending: '待开票', issued: '已开票', sent: '已寄送', returned: '已退回', red_locked: '冲红锁定', red_flushed: '已红冲' };
const CATEGORY_LABELS: Record<string, string> = { personal: '个人', enterprise: '企业' };
const CATEGORY_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'personal', label: '个人' },
  { value: 'enterprise', label: '企业' },
];

const QUEUE_STATUS_COLORS: Record<string, string> = {
  waiting: 'light-blue', processing: 'blue', success: 'green', failed: 'red',
};
const QUEUE_STATUS_LABELS: Record<string, string> = {
  waiting: '排队中', processing: '开票中', success: '成功', failed: '失败',
};

// 冲红原因代码（对应 fa-piao hzxxbsq 的 chyydm）
const CHYYDM_OPTIONS = [
  { value: '01', label: '01 开票有误' },
  { value: '02', label: '02 销货退回' },
  { value: '03', label: '03 服务中止' },
  { value: '04', label: '04 销售折让' },
];

/** 全额红冲：判断记录是否已就绪（已开票/已寄送且发票号、销方税号齐全） */
function isRedFlushable(record: InvoiceRecord): boolean {
  return (record.status === 'issued' || record.status === 'sent')
    && !!(record.invoice_number && record.invoice_number.trim())
    && !!(record.seller_tax_no && record.seller_tax_no.trim());
}

/** 已开票/已寄送但缺发票号或销方税号，需财务手动补充后方可红冲 */
function needsBackfill(record: InvoiceRecord): boolean {
  return (record.status === 'issued' || record.status === 'sent') && !isRedFlushable(record);
}

interface Props {
  apiReady: boolean;
  sellerInfo: SellerInfo | null;
  onLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  onIssued: () => void;
  refreshTrigger?: number;
  onChannelOptionsLoad?: (options: ChannelOption[]) => void;
  allowedChannelIds?: number[] | null;
}

const TAX_RATE = 0.01;

const PRODUCT_CODE_PRESETS: QueueProductCode[] = [
  { spbm: '3040201040000000000', spfwjc: '技术服务费', name: '软件测试服务', taxRate: '6%' },
  { spbm: '3040201010000000000', spfwjc: '软件开发服务', name: '软件开发服务', taxRate: '6%' },
  { spbm: '3040201030000000000', spfwjc: '软件维护服务', name: '软件维护服务', taxRate: '6%' },
  { spbm: '3040201990000000000', spfwjc: '其他软件服务', name: '其他软件服务', taxRate: '6%' },
  { spbm: '3040201020000000000', spfwjc: '软件咨询服务', name: '软件咨询服务', taxRate: '6%' },
  { spbm: '3040202020000000000', spfwjc: '电路测试服务', name: '电路测试服务', taxRate: '6%' },
  { spbm: '3040501990000000000', spfwjc: '其他信息技术服务', name: '信息技术服务', taxRate: '6%' },
  { spbm: '3040201000000000000', spfwjc: '软件服务', name: '技术服务费', taxRate: '6%' },
  { spbm: '3049900000000000000', spfwjc: '现代服务', name: '技术服务费', taxRate: '3%' },
  { spbm: '3040203000000000000', spfwjc: '信息系统服务', name: '技术服务费', taxRate: '3%' },
  { spbm: '3040203000000000000', spfwjc: '生产生活服务', name: '技术服务', taxRate: '6%' },
];

function calcTax(amount: number, rate: number) {
  const je = amount / (1 + rate);
  const se = amount - je;
  return { je: Math.round(je * 100) / 100, se: Math.round(se * 100) / 100 };
}

// 解析用户输入的税率：必须是 0 < x ≤ 1 的小数（如 0.01、0.03、0.06），否则返回 null
function parseSlv(input: string): number | null {
  const v = parseFloat(input);
  if (!Number.isFinite(v) || v <= 0 || v > 1) return null;
  return v;
}

let queueIdCounter = 0;
function nextQueueId() {
  return `q_${Date.now()}_${++queueIdCounter}`;
}

const InvoiceList: React.FC<Props> = ({ apiReady, sellerInfo, onLog, onIssued, refreshTrigger, onChannelOptionsLoad, allowedChannelIds }) => {
  const [data, setData] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [channelId, setChannelId] = useState<number | ''>('');
  const [category, setCategory] = useState('');
  const [createdAtFrom, setCreatedAtFrom] = useState<Date | null>(null);
  const [createdAtTo, setCreatedAtTo] = useState<Date | null>(null);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<InvoiceRecord | null>(null);
  const [processing, setProcessing] = useState<Set<number>>(new Set());

  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueRecord, setIssueRecord] = useState<InvoiceRecord | null>(null);
  const [issueProductCode, setIssueProductCode] = useState<QueueProductCode>(PRODUCT_CODE_PRESETS[0]);
  const [issueCustomName, setIssueCustomName] = useState('技术服务费');
  const [issueGgxh, setIssueGgxh] = useState('');
  const [issueDw, setIssueDw] = useState('');
  const [issueSpsl, setIssueSpsl] = useState('');
  const [issueGfzrrbs, setIssueGfzrrbs] = useState(false);
  const [issueSlv, setIssueSlv] = useState('0.01');

  const [failedTags, setFailedTags] = useState<Map<number, string>>(new Map());

  // ===== Tab 状态 =====
  const [activeTab, setActiveTab] = useState<string>('list');

  // ===== 批量选择 =====
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchProductCode, setBatchProductCode] = useState<QueueProductCode>(PRODUCT_CODE_PRESETS[0]);
  const [batchCustomName, setBatchCustomName] = useState('技术服务费');
  const [batchGgxh, setBatchGgxh] = useState('');
  const [batchDw, setBatchDw] = useState('');
  const [batchSpsl, setBatchSpsl] = useState('');
  const [batchGfzrrbs, setBatchGfzrrbs] = useState(false);
  const [batchSlv, setBatchSlv] = useState('0.01');

  // ===== 红冲 =====
  const [redFlushModalVisible, setRedFlushModalVisible] = useState(false);
  const [redFlushTargets, setRedFlushTargets] = useState<InvoiceRecord[]>([]);
  const [redFlushAllowReissue, setRedFlushAllowReissue] = useState(true);
  const [redFlushChyydm, setRedFlushChyydm] = useState('01');
  const [redFlushing, setRedFlushing] = useState(false);
  const redFlushCancelRef = useRef(false);

  // ===== 历史票补充信息 =====
  const [backfillModalVisible, setBackfillModalVisible] = useState(false);
  const [backfillRecord, setBackfillRecord] = useState<InvoiceRecord | null>(null);
  const [backfillInvoiceNumber, setBackfillInvoiceNumber] = useState('');
  const [backfillInvoiceDate, setBackfillInvoiceDate] = useState<Date | null>(null);
  const [backfillSellerTaxNo, setBackfillSellerTaxNo] = useState('');
  const [backfillSubmitting, setBackfillSubmitting] = useState(false);

  // ===== 开票队列 =====
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const queueRunningRef = useRef(false);
  const processingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;

  const withRetry = async <T,>(
    fn: () => Promise<T>,
    label: string,
    id: number,
    maxRetries = 3,
  ): Promise<{ ok: true; result: T } | { ok: false; lastError: string }> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        return { ok: true, result };
      } catch (err: any) {
        const msg = err?.message || '未知错误';
        onLog('warn', `[#${id}] ${label} 第${attempt}次失败: ${msg}`);
        if (attempt < maxRetries) {
          onLog('info', `[#${id}] ${label} 等待2秒后重试 (${attempt}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          return { ok: false, lastError: msg };
        }
      }
    }
    return { ok: false, lastError: '重试耗尽' };
  };

  const fetchData = useCallback(async (opts?: { page?: number }) => {
    if (!apiReady) return;
    const pageToUse = opts?.page ?? page;
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: pageToUse, page_size: pageSize,
        status: status || undefined,
        keyword: keyword.trim() || undefined,
        search_user_id: userIdFilter.trim() ? Number(userIdFilter.trim()) : undefined,
        invoice_category: category || undefined,
        channel_id: channelId !== '' ? channelId : undefined,
      };
      if (createdAtFrom) {
        params.start_ts = dayjs(createdAtFrom).startOf('day').unix();
      }
      if (createdAtTo) {
        params.end_ts = dayjs(createdAtTo).endOf('day').unix();
      }
      const res = await invoiceApi.list(params);
      if (res.success !== false) {
        const d = res.data || res;
        setData(d.items || []);
        setTotal(d.total || 0);
        if (Array.isArray(d.channel_options) && d.channel_options.length > 0) {
          setChannelOptions(d.channel_options);
          onChannelOptionsLoad?.(d.channel_options);
        }
        onLog('success', `获取到 ${d.total || 0} 条开票记录`);
      } else {
        Toast.error(res.message || '获取数据失败');
        onLog('error', `获取列表失败: ${res.message}`);
      }
    } catch (err: any) {
      Toast.error(err.message || '请求失败');
      onLog('error', `请求异常: ${err.message}`);
    } finally { setLoading(false); }
  }, [apiReady, page, pageSize, status, keyword, userIdFilter, channelId, category, createdAtFrom, createdAtTo]);

  const handleQuery = () => { setPage(1); fetchData({ page: 1 }); };
  const handleResetFilters = () => {
    setStatus(''); setKeyword(''); setUserIdFilter(''); setChannelId(''); setCategory('');
    setCreatedAtFrom(null); setCreatedAtTo(null); setPage(1);
  };

  useEffect(() => { fetchData(); }, [page, pageSize]);
  useEffect(() => {
    if (apiReady) fetchData({ page: 1 });
  }, [apiReady]);
  useEffect(() => {
    if (apiReady && refreshTrigger != null && refreshTrigger > 0) fetchData({ page: 1 });
  }, [refreshTrigger]);

  const handleViewDetail = (record: InvoiceRecord) => { setDetailRecord(record); setDetailVisible(true); };

  const handleSendEmail = async (record: InvoiceRecord) => {
    if (!record.receive_email) { Toast.warning('该记录未填写接收邮箱'); return; }
    setProcessing((s) => new Set(s).add(record.id));
    onLog('info', `[#${record.id}] 正在发送邮件至 ${record.receive_email}...`);
    try {
      const res = await invoiceApi.sendEmail(record.id);
      if (res.success !== false) { onLog('success', `[#${record.id}] 邮件已发送`); fetchData(); }
      else onLog('error', `[#${record.id}] 发送失败: ${res.message}`);
    } catch (err: any) { onLog('error', `[#${record.id}] 发送异常: ${err.message}`); }
    finally { setProcessing((s) => { const ns = new Set(s); ns.delete(record.id); return ns; }); }
  };

  const checkChannelAllowed = (record: InvoiceRecord): { allowed: boolean; blockedNames: string[] } => {
    if (!allowedChannelIds || allowedChannelIds.length === 0) {
      return { allowed: false, blockedNames: ['（当前公司未配置允许的开票渠道）'] };
    }
    const details = record.channel_details;
    if (!details || details.length === 0) {
      return { allowed: false, blockedNames: ['（该记录无渠道信息，无法确认归属）'] };
    }
    const blocked = details.filter((d) => !allowedChannelIds.includes(d.channel_id));
    if (blocked.length === 0) return { allowed: true, blockedNames: [] };
    const blockedNames = blocked.map((d) => d.channel_name || `渠道#${d.channel_id}`);
    return { allowed: false, blockedNames };
  };

  const validateBeforeIssue = (record: InvoiceRecord): boolean => {
    if (!sellerInfo?.nsrsbh) { Toast.warning('请先在左侧完成数电登录'); return false; }
    const companyName = sellerInfo.xhdwmc || sellerInfo.nsrsbh;

    if (!allowedChannelIds || allowedChannelIds.length === 0) {
      Modal.warning({
        title: '未配置允许渠道',
        content: (
          <div>
            <p>当前公司 <strong>{companyName}</strong> 尚未配置允许开票的支付渠道，无法开票。</p>
            <p style={{ color: '#64748b', fontSize: 13 }}>请先在左侧「渠道限制」Tab 中勾选该公司允许开票的渠道。</p>
          </div>
        ),
      });
      onLog('warn', `[#${record.id}] 开票拦截: 当前公司 ${companyName} 未配置允许的开票渠道`);
      return false;
    }

    const { allowed, blockedNames } = checkChannelAllowed(record);
    if (!allowed) {
      Modal.warning({
        title: '渠道不匹配',
        content: (
          <div>
            <p>当前公司 <strong>{companyName}</strong> 不允许为以下渠道开票：</p>
            <p style={{ color: '#ef4444', fontWeight: 500 }}>{blockedNames.join('、')}</p>
            <p style={{ color: '#64748b', fontSize: 13 }}>请检查是否需要切换公司，或在左侧「渠道限制」中修改配置。</p>
          </div>
        ),
      });
      onLog('warn', `[#${record.id}] 渠道限制拦截: ${blockedNames.join('、')} 不在当前公司允许范围内`);
      return false;
    }
    return true;
  };

  const handleOpenIssueModal = (record: InvoiceRecord) => {
    if (!validateBeforeIssue(record)) return;
    setIssueRecord(record);
    setIssueProductCode(PRODUCT_CODE_PRESETS[0]);
    setIssueCustomName('技术服务费');
    setIssueGgxh('');
    setIssueDw('');
    setIssueSpsl('');
    setIssueGfzrrbs(record.invoice_category === 'personal');
    setIssueSlv('0.01');
    setIssueModalVisible(true);
  };

  const issueSpmc = `*${issueProductCode.spfwjc}*${issueCustomName.trim() || issueProductCode.name}`;

  // ===== 加入队列（单条） =====
  const handleAddToQueue = () => {
    if (!issueRecord || !sellerInfo) return;

    const slv = parseSlv(issueSlv);
    if (slv === null) {
      Toast.warning('税率格式不正确，请输入 0~1 之间的小数（如 0.01、0.03、0.06）');
      return;
    }

    const alreadyInQueue = queueRef.current.some(
      (q) => q.record.id === issueRecord.id && (q.status === 'waiting' || q.status === 'processing'),
    );
    if (alreadyInQueue) {
      Toast.warning(`#${issueRecord.id} 已在队列中`);
      setIssueModalVisible(false);
      setIssueRecord(null);
      return;
    }

    const item: QueueItem = {
      queueId: nextQueueId(),
      record: issueRecord,
      productCode: { ...issueProductCode },
      customName: issueCustomName.trim() || issueProductCode.name,
      slv,
      ggxh: issueGgxh.trim() || undefined,
      dw: issueDw.trim() || undefined,
      spsl: issueSpsl.trim() || undefined,
      gfzrrbs: issueGfzrrbs || undefined,
      status: 'waiting',
      addedAt: Date.now(),
    };

    setQueue((prev) => [...prev, item]);
    Toast.success(`#${issueRecord.id} ${issueRecord.title} 已加入开票队列`);
    onLog('info', `[#${issueRecord.id}] 已加入开票队列`);
    setIssueModalVisible(false);
    setIssueRecord(null);
  };

  // ===== 批量加入队列 =====
  const handleOpenBatchModal = () => {
    if (selectedRowKeys.length === 0) {
      Toast.warning('请先勾选待开票记录');
      return;
    }
    if (!sellerInfo?.nsrsbh) {
      Toast.warning('请先在左侧完成数电登录');
      return;
    }
    setBatchProductCode(PRODUCT_CODE_PRESETS[0]);
    setBatchCustomName('技术服务费');
    setBatchGgxh('');
    setBatchDw('');
    setBatchSpsl('');
    setBatchGfzrrbs(false);
    setBatchSlv('0.01');
    setBatchModalVisible(true);
  };

  const handleBatchAddToQueue = () => {
    const slv = parseSlv(batchSlv);
    if (slv === null) {
      Toast.warning('税率格式不正确，请输入 0~1 之间的小数（如 0.01、0.03、0.06）');
      return;
    }

    const pendingRecords = data.filter(
      (r) => selectedRowKeys.includes(r.id) && r.status === 'pending',
    );
    if (pendingRecords.length === 0) {
      Toast.warning('勾选的记录中没有待开票项');
      setBatchModalVisible(false);
      return;
    }

    let addedCount = 0;
    const newItems: QueueItem[] = [];

    for (const record of pendingRecords) {
      const alreadyInQueue = queueRef.current.some(
        (q) => q.record.id === record.id && (q.status === 'waiting' || q.status === 'processing'),
      );
      if (alreadyInQueue) continue;

      const { allowed } = checkChannelAllowed(record);
      if (!allowed) {
        onLog('warn', `[#${record.id}] 渠道不匹配，跳过加入队列`);
        continue;
      }

      newItems.push({
        queueId: nextQueueId(),
        record,
        productCode: { ...batchProductCode },
        customName: batchCustomName.trim() || batchProductCode.name,
        slv,
        ggxh: batchGgxh.trim() || undefined,
        dw: batchDw.trim() || undefined,
        spsl: batchSpsl.trim() || undefined,
        gfzrrbs: batchGfzrrbs || undefined,
        status: 'waiting',
        addedAt: Date.now(),
      });
      addedCount++;
    }

    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
    }
    Toast.success(`已将 ${addedCount} 条记录加入开票队列`);
    onLog('info', `批量加入队列 ${addedCount} 条`);
    setBatchModalVisible(false);
    setSelectedRowKeys([]);
  };

  // ===== 队列操作 =====
  const handleRemoveFromQueue = (queueId: string) => {
    setQueue((prev) => prev.filter((q) => q.queueId !== queueId));
  };

  const handleClearFinished = () => {
    setQueue((prev) => prev.filter((q) => q.status === 'waiting' || q.status === 'processing'));
  };

  const handleRetryFailed = (queueId: string) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.queueId === queueId ? { ...q, status: 'waiting' as const, errorMsg: undefined, startedAt: undefined, finishedAt: undefined } : q,
      ),
    );
  };

  const handleRetryAllFailed = () => {
    setQueue((prev) =>
      prev.map((q) =>
        q.status === 'failed' ? { ...q, status: 'waiting' as const, errorMsg: undefined, startedAt: undefined, finishedAt: undefined } : q,
      ),
    );
  };

  // ===== 红冲：打开确认弹窗（校验销方/username 一致性） =====
  const openRedFlushModal = (records: InvoiceRecord[]) => {
    if (records.length === 0) {
      Toast.warning('没有可红冲的记录');
      return;
    }
    if (!sellerInfo?.nsrsbh) {
      Toast.warning('请先在左侧完成数电登录');
      return;
    }
    if (!sellerInfo.username || !sellerInfo.username.trim()) {
      Toast.warning('当前登录缺少电票平台账号(username)，红冲无法进行，请重新登录');
      return;
    }
    // 校验销方税号必须与当前登录一致（跨公司需切换登录分批红冲）
    const mismatched = records.filter((r) => (r.seller_tax_no || '').trim() !== sellerInfo.nsrsbh);
    if (mismatched.length > 0) {
      Modal.warning({
        title: '销方税号不一致',
        content: (
          <div>
            <p>以下 <strong>{mismatched.length}</strong> 条记录的销方税号与当前登录公司不一致，需切换到对应公司后再红冲：</p>
            <p style={{ color: '#ef4444' }}>{mismatched.map((r) => `#${r.id}`).join('、')}</p>
          </div>
        ),
      });
      onLog('warn', `红冲拦截: ${mismatched.length} 条记录销方税号与当前登录不一致`);
      return;
    }
    setRedFlushTargets(records);
    setRedFlushAllowReissue(true);
    setRedFlushChyydm('01');
    setRedFlushModalVisible(true);
  };

  // ===== 红冲：串行执行 retMsg → hzxxbsq → hzfpkj → 平台回写 =====
  const executeRedFlush = async () => {
    if (!sellerInfo?.nsrsbh || !sellerInfo.username) return;
    const targets = redFlushTargets;
    const username = sellerInfo.username;
    const allowReissue = redFlushAllowReissue;
    const chyydm = redFlushChyydm;
    setRedFlushModalVisible(false);
    setRedFlushing(true);
    redFlushCancelRef.current = false;

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of targets) {
      if (redFlushCancelRef.current) {
        onLog('warn', '红冲已被用户中断');
        break;
      }
      const fphm = (record.invoice_number || '').trim();
      const sellerTax = (record.seller_tax_no || '').trim();
      setProcessing((s) => new Set(s).add(record.id));
      onLog('info', `[#${record.id}] 红冲开始 发票号:${fphm}`);
      try {
        // 1. 红字前查蓝票信息
        const check = await taxApi.retMsg({ nsrsbh: sellerTax, fphm, username, sqyy: '2', xhdwsbh: sellerTax });
        if (check.code !== 200) {
          skipped++;
          setFailedTags((prev) => new Map(prev).set(record.id, `不可红冲: ${check.msg || '需购方确认'}`));
          onLog('warn', `[#${record.id}] 跳过红冲: ${check.msg || '需购方在电子税务局确认'}`);
          continue;
        }
        // 2. 申请红字信息表
        const applyRes = await taxApi.applyRedInfo({ xhdwsbh: sellerTax, yfphm: fphm, username, sqyy: '2', chyydm });
        if (applyRes.code !== 200 || !applyRes.data?.xxbbh) {
          failed++;
          setFailedTags((prev) => new Map(prev).set(record.id, `申请红字信息表失败: ${applyRes.msg || '无 xxbbh'}`));
          onLog('error', `[#${record.id}] 申请红字信息表失败: ${applyRes.msg}`);
          continue;
        }
        const xxbbh = applyRes.data.xxbbh;
        // 3. 开具红字发票（负数全额）
        const redRes = await taxApi.redTicket({
          fpqqlsh: `red${Date.now()}`,
          username,
          xhdwsbh: sellerTax,
          tzdbh: xxbbh,
          yfphm: fphm,
        });
        if (redRes.code !== 200) {
          failed++;
          setFailedTags((prev) => new Map(prev).set(record.id, `负数开具失败: ${redRes.msg || '未知'}`));
          onLog('error', `[#${record.id}] 负数开具失败: ${redRes.msg}`);
          continue;
        }
        const redFphm = redRes.data?.Fphm || '';
        onLog('success', `[#${record.id}] 红字发票开具成功${redFphm ? ` 红票号:${redFphm}` : ''}`);
        // 4. 平台回写
        const wbRes = await invoiceApi.redFlush(record.id, {
          allow_reissue: allowReissue,
          red_fphm: redFphm || undefined,
          remark: `一键全额红冲(${chyydm})`,
        });
        if (wbRes?.success === false) {
          onLog('warn', `[#${record.id}] 红票已开具，但平台回写失败: ${wbRes?.message || '未知'}（请手动核对状态）`);
        }
        success++;
        setFailedTags((prev) => { const m = new Map(prev); m.delete(record.id); return m; });
      } catch (e: any) {
        failed++;
        setFailedTags((prev) => new Map(prev).set(record.id, `红冲异常: ${e.message || '未知'}`));
        onLog('error', `[#${record.id}] 红冲异常: ${e.message}`);
      } finally {
        setProcessing((s) => { const ns = new Set(s); ns.delete(record.id); return ns; });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    setRedFlushing(false);
    setSelectedRowKeys([]);
    onLog('info', `红冲完成: 成功 ${success} / 跳过 ${skipped} / 失败 ${failed}`);
    Toast.info(`红冲完成: 成功 ${success}、跳过 ${skipped}、失败 ${failed}`);
    fetchData();
  };

  // ===== 历史票：打开补充信息弹窗 =====
  const openBackfillModal = (record: InvoiceRecord) => {
    setBackfillRecord(record);
    setBackfillInvoiceNumber(record.invoice_number || '');
    setBackfillInvoiceDate(null);
    setBackfillSellerTaxNo(record.seller_tax_no || sellerInfo?.nsrsbh || '');
    setBackfillModalVisible(true);
  };

  const submitBackfill = async () => {
    if (!backfillRecord) return;
    const num = backfillInvoiceNumber.trim();
    if (!/^\d{20}$/.test(num)) {
      Toast.warning('发票号码应为 20 位数字');
      return;
    }
    setBackfillSubmitting(true);
    try {
      const payload: { invoice_number?: string; invoice_date?: string; seller_tax_no?: string } = {
        invoice_number: num,
      };
      /** Align with the auto-writeback path (Kprq → e.g. 2026-07-14) so invoice_date stays one consistent format across records */
      if (backfillInvoiceDate) payload.invoice_date = dayjs(backfillInvoiceDate).format('YYYY-MM-DD');
      if (backfillSellerTaxNo.trim()) payload.seller_tax_no = backfillSellerTaxNo.trim();
      const res = await invoiceApi.updateInvoiceMeta(backfillRecord.id, payload);
      if (res?.success === false) {
        Toast.error(res.message || '补充失败');
        onLog('error', `[#${backfillRecord.id}] 补充发票信息失败: ${res.message}`);
      } else {
        Toast.success('已补充发票信息');
        onLog('success', `[#${backfillRecord.id}] 已补充发票号 ${num}`);
        setBackfillModalVisible(false);
        setBackfillRecord(null);
        fetchData();
      }
    } catch (e: any) {
      Toast.error(e.message || '补充异常');
      onLog('error', `[#${backfillRecord.id}] 补充异常: ${e.message}`);
    } finally {
      setBackfillSubmitting(false);
    }
  };

  // ===== 核心：处理单条开票（不阻塞 UI） =====
  const processOneItem = async (item: QueueItem): Promise<void> => {
    if (!sellerInfo) return;
    const record = item.record;
    const amount = record.recharge_amount;
    const taxRate = item.slv ?? TAX_RATE;
    const { je, se } = calcTax(amount, taxRate);
    const n = sellerInfo.nsrsbh;
    const spmc = `*${item.productCode.spfwjc}*${item.customName}`;

    onLog('info', `[#${record.id}] 队列开票开始: ${record.title} ¥${amount} 税率:${taxRate}`);
    try {
      const params: Record<string, unknown> = {
        fpqqlsh: `EWM${Date.now()}`,
        fplxdm: '82',
        kplx: '0',
        xhdwsbh: n,
        xhdwmc: sellerInfo.xhdwmc || '-',
        xhdwdzdh: sellerInfo.xhdwdzdh || '-',
        xhdwyhzh: sellerInfo.xhdwyhzh || '-',
        ghdwmc: record.title,
        zsfs: '0',
        fyxm: [{
          fphxz: '0',
          spmc,
          je: amount, sl: taxRate, se, hsbz: 1,
          spbm: item.productCode.spbm,
          ...(item.ggxh ? { ggxh: item.ggxh } : {}),
          ...(item.dw ? { dw: item.dw } : {}),
          ...(item.spsl ? { spsl: item.spsl } : {}),
        }],
        hjje: je.toFixed(2),
        hjse: se.toFixed(2),
        jshj: amount.toFixed(2),
      };
      if (record.taxpayer_id) params.ghdwsbh = record.taxpayer_id;
      if (sellerInfo.username) params.username = sellerInfo.username;
      /** 发票备注强制使用平台记录的 invoice_remark（单条/批量均按各记录自带备注） */
      if (record.invoice_remark && record.invoice_remark.trim()) {
        params.bz = record.invoice_remark.trim();
      }
      if (item.gfzrrbs) params.gfzrrbs = 'Y';

      const res = await taxApi.blueTicket(params);

      if (res.code === 200 && res.data?.Fphm) {
        const fphm = res.data.Fphm;
        onLog('success', `[#${record.id}] 开票成功 发票号码: ${fphm}`);

        setQueue((prev) =>
          prev.map((q) => q.queueId === item.queueId ? { ...q, fphm } : q),
        );

        onLog('info', `[#${record.id}] 等待 PDF 生成（3秒）...`);
        await new Promise((r) => setTimeout(r, 3000));

        onLog('info', `[#${record.id}] 正在下载 PDF...`);
        const pdfRes = await taxApi.downloadPdf({
          nsrsbh: n, fphm,
          kprq: res.data.Kprq?.replace(/\s/g, '').replace(/-|:/g, ''),
          username: sellerInfo.username || undefined,
        });

        if (pdfRes.success && pdfRes.path) {
          onLog('success', `[#${record.id}] PDF 已保存: ${pdfRes.path}`);

          onLog('info', `[#${record.id}] 正在同步到平台（最多3次重试）...`);
          // 回写数电发票标识（发票号/开票日期/销方税号），作为后续全额红冲的地基
          const kprqRaw = res.data.Kprq?.replace(/\s/g, '') || undefined;
          const uploadMeta = {
            invoice_number: fphm,
            invoice_date: kprqRaw,
            seller_tax_no: n,
          };
          const uploadResult = await withRetry(
            async () => {
              const upRes = await invoiceApi.uploadPdf(record.id, pdfRes.path!, uploadMeta);
              if (upRes?.success === false) throw new Error((upRes as any)?.message || '接口返回失败');
              return upRes;
            },
            'PDF同步', record.id,
          );

          if (uploadResult.ok) {
            onLog('success', `[#${record.id}] 已同步到平台，等待服务器存储完成（3秒）...`);
            await new Promise((r) => setTimeout(r, 3000));
            setFailedTags((prev) => { const n = new Map(prev); n.delete(record.id); return n; });

            if (record.receive_email) {
              onLog('info', `[#${record.id}] 正在推送邮件至 ${record.receive_email}（最多3次重试）...`);
              const emailResult = await withRetry(
                async () => {
                  const emailRes = await invoiceApi.sendEmail(record.id);
                  if (emailRes?.success === false) throw new Error(emailRes?.message || '接口返回失败');
                  return emailRes;
                },
                '邮件推送', record.id,
              );
              if (emailResult.ok) {
                onLog('success', `[#${record.id}] 邮件已推送`);
              } else {
                onLog('warn', `[#${record.id}] 邮件推送失败（不影响开票结果）: ${emailResult.lastError}`);
              }
            }

            setQueue((prev) =>
              prev.map((q) => q.queueId === item.queueId ? { ...q, status: 'success' as const, finishedAt: Date.now() } : q),
            );
            onIssued();
          } else {
            throw new Error(`PDF同步失败: ${uploadResult.lastError}`);
          }
        } else {
          throw new Error(`PDF 下载失败: ${pdfRes.message}`);
        }
      } else if (res.code === 200 && (res.data as any)?.rzid) {
        throw new Error('需要人脸认证，请先在左侧完成人脸认证后重试');
      } else {
        throw new Error(res.msg || '开票失败');
      }
    } catch (e: any) {
      const errMsg = e.message || '开票异常';
      onLog('error', `[#${record.id}] 队列开票失败: ${errMsg}`);
      setQueue((prev) =>
        prev.map((q) => q.queueId === item.queueId ? { ...q, status: 'failed' as const, errorMsg: errMsg, finishedAt: Date.now() } : q),
      );
    }
  };

  // ===== 队列处理器：自动消费 waiting 项 =====
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    if (!sellerInfo?.nsrsbh) return;
    processingRef.current = true;
    queueRunningRef.current = true;
    setQueueRunning(true);

    while (queueRunningRef.current) {
      const currentQueue = queueRef.current;
      const nextItem = currentQueue.find((q) => q.status === 'waiting');
      if (!nextItem) break;

      setQueue((prev) =>
        prev.map((q) => q.queueId === nextItem.queueId ? { ...q, status: 'processing' as const, startedAt: Date.now() } : q),
      );

      await processOneItem(nextItem);

      await new Promise((r) => setTimeout(r, 1000));
    }

    processingRef.current = false;
    queueRunningRef.current = false;
    setQueueRunning(false);

    const hasWaiting = queueRef.current.some((q) => q.status === 'waiting');
    if (!hasWaiting && queueRef.current.length > 0) {
      onLog('info', '开票队列已全部处理完毕');
      Toast.success('开票队列已全部处理完毕');
      fetchData();
    }
  }, [sellerInfo]);

  // 当队列中出现 waiting 项时自动启动处理
  useEffect(() => {
    const hasWaiting = queue.some((q) => q.status === 'waiting');
    if (hasWaiting && !processingRef.current && sellerInfo?.nsrsbh) {
      processQueue();
    }
  }, [queue, sellerInfo, processQueue]);

  const handleStopQueue = () => {
    queueRunningRef.current = false;
    setQueueRunning(false);
    onLog('info', '开票队列已暂停');
    Toast.info('队列已暂停，当前正在处理的记录会继续完成');
  };

  const handleResumeQueue = () => {
    if (!sellerInfo?.nsrsbh) {
      Toast.warning('请先在左侧完成数电登录');
      return;
    }
    const hasWaiting = queue.some((q) => q.status === 'waiting');
    if (!hasWaiting) {
      Toast.warning('队列中没有待处理的记录');
      return;
    }
    onLog('info', '开票队列恢复处理...');
    processQueue();
  };

  // ===== 队列统计 =====
  const queueStats = {
    total: queue.length,
    waiting: queue.filter((q) => q.status === 'waiting').length,
    processing: queue.filter((q) => q.status === 'processing').length,
    success: queue.filter((q) => q.status === 'success').length,
    failed: queue.filter((q) => q.status === 'failed').length,
  };
  const queueProgress = queueStats.total > 0
    ? Math.round(((queueStats.success + queueStats.failed) / queueStats.total) * 100)
    : 0;

  // ===== 待开票列表列定义 =====
  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: '用户ID', dataIndex: 'user_id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 110,
      render: (v: string) => v ? <Tooltip content={v}><span className="cell-ellipsis">{v}</span></Tooltip> : '-' },
    { title: '发票类型', dataIndex: 'invoice_type', width: 120,
      render: (v: string) => {
        const label = v === 'normal' ? '增值税普通发票' : v || '-';
        return <Tooltip content={label}><span className="cell-ellipsis">{label}</span></Tooltip>;
      },
    },
    { title: '抬头类型', dataIndex: 'invoice_category', width: 80,
      render: (v: string) => {
        const label = CATEGORY_LABELS[v] || v || '-';
        return <Tag size="small" color={v === 'enterprise' ? 'blue' : 'light-blue'}>{label}</Tag>;
      },
    },
    { title: '抬头', dataIndex: 'title', width: 200,
      render: (v: string) => v ? <Tooltip content={v}><span className="cell-ellipsis" style={{ fontWeight: 500 }}>{v}</span></Tooltip> : '-' },
    { title: '金额', dataIndex: 'recharge_amount', width: 96,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#1e293b' }}>¥{(v ?? 0).toFixed(2)}</span> },
    { title: '支付渠道', dataIndex: 'channel_names', width: 150,
      render: (v: string) => v ? <Tooltip content={v}><span className="cell-ellipsis">{v}</span></Tooltip> : <span style={{ color: '#cbd5e1' }}>-</span> },
    { title: '接收邮箱', dataIndex: 'receive_email', width: 160,
      render: (v: string) => v ? <Tooltip content={v}><span className="cell-ellipsis">{v}</span></Tooltip> : <span style={{ color: '#cbd5e1' }}>-</span> },
    { title: '创建时间', dataIndex: 'created_at', width: 150,
      render: (v: number) => (v ? <span style={{ color: '#64748b', fontSize: 13 }}>{dayjs.unix(v).format('YYYY-MM-DD HH:mm')}</span> : '-') },
    { title: '状态', dataIndex: 'status', width: 140,
      render: (v: string, record: InvoiceRecord) => {
        const fail = failedTags.get(record.id);
        const inQueue = queue.some((q) => q.record.id === record.id && (q.status === 'waiting' || q.status === 'processing'));
        return (
          <Space spacing={4}>
            <Tag color={STATUS_COLORS[v] as any} size="small">{STATUS_LABELS[v] || v}</Tag>
            {isRedFlushable(record) && <Tag color="green" size="small" type="light">红冲就绪</Tag>}
            {needsBackfill(record) && <Tag color="amber" size="small" type="light">待补充</Tag>}
            {fail && <Tooltip content={fail}><Tag color="red" size="small" type="light">{fail}</Tag></Tooltip>}
            {inQueue && <Tag color="blue" size="small" type="light">队列中</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作', width: 180, fixed: 'right' as const,
      render: (_: any, record: InvoiceRecord) => {
        const isProcessing = processing.has(record.id);
        const inQueue = queue.some((q) => q.record.id === record.id && (q.status === 'waiting' || q.status === 'processing'));
        const channelCheck = record.status === 'pending' ? checkChannelAllowed(record) : null;
        return (
          <Space spacing={4}>
            <Tooltip content="查看详情">
              <Button size="small" theme="borderless" icon={<IconEyeOpened />} onClick={() => handleViewDetail(record)} />
            </Tooltip>
            {record.status === 'pending' && !inQueue && (
              channelCheck && !channelCheck.allowed ? (
                <Tooltip content={`渠道限制: ${channelCheck.blockedNames.join('、')}`}>
                  <Button size="small" type="primary" theme="solid" disabled>
                    API开票
                  </Button>
                </Tooltip>
              ) : (
                <Button size="small" type="primary" theme="solid" loading={isProcessing} onClick={() => handleOpenIssueModal(record)}>
                  API开票
                </Button>
              )
            )}
            {record.status === 'pending' && inQueue && (
              <Tag color="blue" size="small">已在队列</Tag>
            )}
            {(record.status === 'issued' || record.status === 'sent') && record.receive_email && (
              <Tooltip content="发送发票邮件">
                <Button size="small" theme="light" icon={<IconMail />} loading={isProcessing} onClick={() => handleSendEmail(record)}>寄送</Button>
              </Tooltip>
            )}
            {isRedFlushable(record) && (
              <Tooltip content="全额红冲（负数开具并回写平台）">
                <Button size="small" type="danger" theme="light" loading={isProcessing || redFlushing}
                  onClick={() => openRedFlushModal([record])}>红冲</Button>
              </Tooltip>
            )}
            {needsBackfill(record) && (
              <Tooltip content="补充发票号后可红冲">
                <Button size="small" theme="light" onClick={() => openBackfillModal(record)}>补充信息</Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // ===== 队列列表列定义 =====
  const queueColumns = [
    { title: '#', width: 50, render: (_: any, __: QueueItem, index: number) => index + 1 },
    { title: '记录ID', dataIndex: 'record', width: 70, render: (_: any, item: QueueItem) => item.record.id },
    { title: '抬头', width: 180,
      render: (_: any, item: QueueItem) => (
        <Tooltip content={item.record.title}>
          <span className="cell-ellipsis" style={{ fontWeight: 500 }}>{item.record.title}</span>
        </Tooltip>
      ),
    },
    { title: '金额', width: 100,
      render: (_: any, item: QueueItem) => (
        <span style={{ fontWeight: 600, color: '#1e293b' }}>¥{item.record.recharge_amount.toFixed(2)}</span>
      ),
    },
    { title: '商品名称', width: 150,
      render: (_: any, item: QueueItem) => (
        <Tooltip content={`*${item.productCode.spfwjc}*${item.customName}`}>
          <span className="cell-ellipsis">{item.customName}</span>
        </Tooltip>
      ),
    },
    { title: '发票号码', dataIndex: 'fphm', width: 130,
      render: (_: any, item: QueueItem) => item.fphm
        ? <span style={{ color: 'var(--app-success)', fontWeight: 500 }}>{item.fphm}</span>
        : <span style={{ color: '#cbd5e1' }}>-</span>,
    },
    { title: '状态', width: 100,
      render: (_: any, item: QueueItem) => (
        <Tag color={QUEUE_STATUS_COLORS[item.status] as any} size="small">
          {QUEUE_STATUS_LABELS[item.status]}
          {item.status === 'processing' && ' ...'}
        </Tag>
      ),
    },
    { title: '错误信息', width: 200,
      render: (_: any, item: QueueItem) => item.errorMsg
        ? <Tooltip content={item.errorMsg}><span className="cell-ellipsis" style={{ color: 'var(--app-error)', fontSize: 12 }}>{item.errorMsg}</span></Tooltip>
        : <span style={{ color: '#cbd5e1' }}>-</span>,
    },
    { title: '加入时间', width: 140,
      render: (_: any, item: QueueItem) => (
        <span style={{ color: '#64748b', fontSize: 13 }}>{dayjs(item.addedAt).format('HH:mm:ss')}</span>
      ),
    },
    {
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: any, item: QueueItem) => (
        <Space spacing={4}>
          {item.status === 'failed' && (
            <Tooltip content="重试">
              <Button size="small" theme="light" type="primary" icon={<IconRefresh />} onClick={() => handleRetryFailed(item.queueId)} />
            </Tooltip>
          )}
          {(item.status === 'waiting' || item.status === 'success' || item.status === 'failed') && (
            <Tooltip content="移除">
              <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => handleRemoveFromQueue(item.queueId)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const channelSelectOptions = [
    { value: '', label: '全部渠道' },
    ...channelOptions.map((c) => ({ value: String(c.id), label: c.name })),
  ];

  const batchSpmc = `*${batchProductCode.spfwjc}*${batchCustomName.trim() || batchProductCode.name}`;

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: any) => setSelectedRowKeys(keys as number[]),
    getCheckboxProps: (record: InvoiceRecord) => ({
      // 可勾选：待开票且渠道允许（用于批量开票）；或已开票/已寄送且红冲就绪（用于一键红冲）
      disabled: !(
        (record.status === 'pending' && checkChannelAllowed(record).allowed)
        || isRedFlushable(record)
      ),
    }),
  };

  const selectedPendingRecords = data.filter((r) => selectedRowKeys.includes(r.id) && r.status === 'pending');
  const selectedRedFlushRecords = data.filter((r) => selectedRowKeys.includes(r.id) && isRedFlushable(r));

  return (
    <>
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key)} type="line" style={{ padding: '0 24px', background: 'var(--app-card-bg)', borderBottom: '1px solid var(--app-border)' }}>
        <TabPane
          tab={<span>待开票列表 <Tag size="small" color="blue" style={{ marginLeft: 4 }}>{total}</Tag></span>}
          itemKey="list"
        />
        <TabPane
          tab={
            <span>
              开票队列
              {queueStats.total > 0 && (
                <Tag size="small" color={queueRunning ? 'green' : 'grey'} style={{ marginLeft: 4 }}>
                  {queueStats.success + queueStats.failed}/{queueStats.total}
                </Tag>
              )}
            </span>
          }
          itemKey="queue"
        />
      </Tabs>

      {activeTab === 'list' && (
        <>
          <div className="toolbar toolbar-invoice">
            <div className="toolbar-left">
              <div className="toolbar-title-row">
                <Typography.Title heading={6} style={{ margin: 0 }}>待开票列表</Typography.Title>
                <Typography.Text type="tertiary" size="small" className="toolbar-total">共 {total} 条记录</Typography.Text>
              </div>
              <div className="toolbar-filter-row">
                <Input size="small" prefix={<IconSearch />} placeholder="搜索用户名/抬头" value={keyword} onChange={setKeyword} onEnterPress={handleQuery} style={{ width: 170 }} />
                <Input size="small" placeholder="用户ID" value={userIdFilter} onChange={setUserIdFilter} style={{ width: 80 }} />
                <Select size="small" value={status} onChange={(v) => setStatus(v as string)} optionList={STATUS_OPTIONS} style={{ width: 100 }} />
                <Select size="small" value={category} onChange={(v) => setCategory(v as string)} optionList={CATEGORY_OPTIONS} style={{ width: 90 }} />
                <Select size="small" value={channelId === '' ? '' : String(channelId)} onChange={(v) => setChannelId(v === '' ? '' : Number(v))} optionList={channelSelectOptions} style={{ width: 120 }} />
                <DatePicker size="small" placeholder="起始日期" value={createdAtFrom ?? undefined} onChange={(date) => setCreatedAtFrom((date as Date) ?? null)} style={{ width: 140 }} />
                <DatePicker size="small" placeholder="截止日期" value={createdAtTo ?? undefined} onChange={(date) => setCreatedAtTo((date as Date) ?? null)} style={{ width: 140 }} />
              </div>
              <div className="toolbar-action-row">
                <Button size="small" type="primary" theme="solid" onClick={handleQuery} loading={loading}>查询</Button>
                <Button size="small" theme="light" onClick={handleResetFilters}>重置</Button>
                <Button size="small" theme="borderless" icon={<IconRefresh />} onClick={() => fetchData()} loading={loading}>刷新</Button>
                {selectedPendingRecords.length > 0 && (
                  <>
                    <Divider layout="vertical" style={{ margin: '0 4px', height: 16 }} />
                    <Button size="small" type="primary" theme="light" icon={<IconPlus />} onClick={handleOpenBatchModal}>
                      批量加入队列 ({selectedPendingRecords.length})
                    </Button>
                  </>
                )}
                {selectedRedFlushRecords.length > 0 && (
                  <>
                    <Divider layout="vertical" style={{ margin: '0 4px', height: 16 }} />
                    <Button size="small" type="danger" theme="solid" loading={redFlushing}
                      onClick={() => openRedFlushModal(selectedRedFlushRecords)}>
                      一键红冲 ({selectedRedFlushRecords.length})
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="app-content">
            <Card className="invoice-list-card" bodyStyle={{ padding: 0 }}>
              <Table className="invoice-table" columns={columns} dataSource={data} rowKey="id" loading={loading} size="small"
                rowSelection={rowSelection}
                pagination={{
                  currentPage: page, pageSize, total,
                  onPageChange: setPage,
                  onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                  showSizeChanger: true, pageSizeOpts: [10, 20, 50],
                }}
                scroll={{ x: 1750 }} empty="暂无数据，请检查 API 配置"
              />
            </Card>
          </div>
        </>
      )}

      {activeTab === 'queue' && (
        <>
          <div className="toolbar toolbar-invoice">
            <div className="toolbar-left">
              <div className="toolbar-title-row">
                <Typography.Title heading={6} style={{ margin: 0 }}>开票队列</Typography.Title>
                <Space spacing={8}>
                  {queueStats.total > 0 && (
                    <div className="queue-stats-bar">
                      <Tag size="small" color="light-blue">排队 {queueStats.waiting}</Tag>
                      <Tag size="small" color="blue">处理中 {queueStats.processing}</Tag>
                      <Tag size="small" color="green">成功 {queueStats.success}</Tag>
                      <Tag size="small" color="red">失败 {queueStats.failed}</Tag>
                    </div>
                  )}
                </Space>
              </div>
              {queueStats.total > 0 && (
                <Progress percent={queueProgress} size="small" style={{ width: '100%' }}
                  stroke={queueRunning ? 'var(--app-primary)' : '#94a3b8'} />
              )}
              <div className="toolbar-action-row">
                {queueRunning ? (
                  <Button size="small" type="warning" theme="solid" icon={<IconStop />} onClick={handleStopQueue}>
                    暂停队列
                  </Button>
                ) : queueStats.waiting > 0 ? (
                  <Button size="small" type="primary" theme="solid" icon={<IconPlay />} onClick={handleResumeQueue}>
                    恢复处理
                  </Button>
                ) : (
                  <Tag color="green" size="small" style={{ padding: '4px 10px' }}>
                    {queueStats.total > 0 ? '队列空闲' : '暂无任务'}
                  </Tag>
                )}
                {queueStats.failed > 0 && (
                  <Button size="small" theme="light" icon={<IconRefresh />} onClick={handleRetryAllFailed}>
                    全部重试 ({queueStats.failed})
                  </Button>
                )}
                {(queueStats.success > 0 || queueStats.failed > 0) && !queueRunning && (
                  <Popconfirm title="确认清除已完成和失败的记录？" onConfirm={handleClearFinished}>
                    <Button size="small" theme="borderless" type="danger" icon={<IconDelete />}>
                      清除已完成
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </div>
          </div>

          <div className="app-content">
            <Card className="invoice-list-card" bodyStyle={{ padding: 0 }}>
              {queue.length === 0 ? (
                <div className="queue-empty">
                  <Typography.Text type="tertiary">队列为空，请在「待开票列表」中选择记录加入队列</Typography.Text>
                </div>
              ) : (
                <Table className="invoice-table" columns={queueColumns} dataSource={queue} rowKey="queueId" size="small"
                  pagination={false}
                  scroll={{ x: 1200 }} />
              )}
            </Card>
          </div>
        </>
      )}

      {/* 单条加入队列 Modal */}
      <Modal
        title="确认加入开票队列"
        visible={issueModalVisible}
        onCancel={() => { setIssueModalVisible(false); setIssueRecord(null); }}
        footer={
          <Space>
            <Button onClick={() => { setIssueModalVisible(false); setIssueRecord(null); }}>取消</Button>
            <Button type="primary" theme="solid" icon={<IconPlus />} onClick={handleAddToQueue}>
              加入队列
            </Button>
          </Space>
        }
        width={520}
      >
        {issueRecord && (
          <div className="issue-confirm-body">
            <div className="issue-confirm-info">
              <div className="issue-confirm-row">
                <label>购方名称</label>
                <span>{issueRecord.title}</span>
              </div>
              <div className="issue-confirm-row">
                <label>购方税号</label>
                <span>{issueRecord.taxpayer_id || '（未填写）'}</span>
              </div>
              <div className="issue-confirm-row">
                <label>金额（含税）</label>
                <span style={{ color: 'var(--app-primary)', fontWeight: 600 }}>¥{issueRecord.recharge_amount.toFixed(2)}</span>
              </div>
              <div className="issue-confirm-row">
                <label>销方</label>
                <span>{sellerInfo?.xhdwmc || sellerInfo?.nsrsbh || '-'}</span>
              </div>
            </div>
            <Divider margin="16px 0" />
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>商品编码</label>
              <Select
                value={PRODUCT_CODE_PRESETS.indexOf(issueProductCode)}
                onChange={(v) => {
                  const found = PRODUCT_CODE_PRESETS[v as number];
                  if (found) setIssueProductCode(found);
                }}
                style={{ width: '100%' }}
                filter
                optionList={PRODUCT_CODE_PRESETS.map((p, i) => ({
                  value: i,
                  label: `${p.spfwjc}（${p.spbm.slice(0, 7)}...）`,
                }))}
              />
            </div>
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>商品名称</label>
              <Input value={issueCustomName} onChange={setIssueCustomName} placeholder="技术服务费" />
            </div>
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>发票项目（预览）</label>
              <Input value={issueSpmc} disabled style={{ fontWeight: 500 }} />
            </div>
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>税率</label>
              <Input value={issueSlv} onChange={setIssueSlv} placeholder="0~1 之间的小数，如 0.01" style={{ width: 220 }} suffix="（0.01=1% / 0.06=6%）" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="settings-row">
                <label>规格型号</label>
                <Input size="small" value={issueGgxh} onChange={setIssueGgxh} placeholder="选填" />
              </div>
              <div className="settings-row">
                <label>单位</label>
                <Input size="small" value={issueDw} onChange={setIssueDw} placeholder="选填，如 次" />
              </div>
              <div className="settings-row">
                <label>数量</label>
                <Input size="small" value={issueSpsl} onChange={setIssueSpsl} placeholder="选填" />
              </div>
            </div>
            <div className="settings-row" style={{ marginBottom: 0 }}>
              <label>备注</label>
              <Input
                value={issueRecord.invoice_remark?.trim() || '（平台无备注，将不带备注开具）'}
                disabled
                placeholder="自动使用平台发票备注"
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <Checkbox checked={issueGfzrrbs} onChange={(e) => setIssueGfzrrbs(!!e.target.checked)}>
                开票给自然人（个人）
              </Checkbox>
            </div>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
              确认后自动加入开票队列并按顺序开票
            </Typography.Text>
          </div>
        )}
      </Modal>

      {/* 批量加入队列 Modal */}
      <Modal
        title={`批量加入开票队列（${selectedRowKeys.length} 条）`}
        visible={batchModalVisible}
        onCancel={() => setBatchModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setBatchModalVisible(false)}>取消</Button>
            <Button type="primary" theme="solid" icon={<IconPlus />} onClick={handleBatchAddToQueue}>
              批量加入队列
            </Button>
          </Space>
        }
        width={480}
      >
        <div className="issue-confirm-body">
          <Typography.Text style={{ display: 'block', marginBottom: 12 }}>
            将为勾选的 <strong>{selectedRowKeys.length}</strong> 条待开票记录统一设置以下商品信息：
          </Typography.Text>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <label>商品编码</label>
            <Select
              value={PRODUCT_CODE_PRESETS.indexOf(batchProductCode)}
              onChange={(v) => {
                const found = PRODUCT_CODE_PRESETS[v as number];
                if (found) setBatchProductCode(found);
              }}
              style={{ width: '100%' }}
              filter
              optionList={PRODUCT_CODE_PRESETS.map((p, i) => ({
                value: i,
                label: `${p.spfwjc}（${p.spbm.slice(0, 7)}...）`,
              }))}
            />
          </div>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <label>商品名称</label>
            <Input value={batchCustomName} onChange={setBatchCustomName} placeholder="技术服务费" />
          </div>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <label>发票项目（预览）</label>
            <Input value={batchSpmc} disabled style={{ fontWeight: 500 }} />
          </div>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <label>税率</label>
            <Input value={batchSlv} onChange={setBatchSlv} placeholder="0~1 之间的小数，如 0.01" style={{ width: 220 }} suffix="（0.01=1% / 0.06=6%）" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="settings-row">
              <label>规格型号</label>
              <Input size="small" value={batchGgxh} onChange={setBatchGgxh} placeholder="选填" />
            </div>
            <div className="settings-row">
              <label>单位</label>
              <Input size="small" value={batchDw} onChange={setBatchDw} placeholder="选填，如 次" />
            </div>
            <div className="settings-row">
              <label>数量</label>
              <Input size="small" value={batchSpsl} onChange={setBatchSpsl} placeholder="选填" />
            </div>
          </div>
          <div className="settings-row" style={{ marginBottom: 0 }}>
            <label>备注</label>
            <Input value="自动使用每条记录各自的平台备注" disabled />
          </div>
          <div style={{ marginTop: 12 }}>
            <Checkbox checked={batchGfzrrbs} onChange={(e) => setBatchGfzrrbs(!!e.target.checked)}>
              开票给自然人（个人）
            </Checkbox>
          </div>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
            非待开票状态及渠道不匹配的记录将自动跳过
          </Typography.Text>
        </div>
      </Modal>

      {/* 一键红冲确认 Modal */}
      <Modal
        title={`确认全额红冲（${redFlushTargets.length} 条）`}
        visible={redFlushModalVisible}
        onCancel={() => setRedFlushModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setRedFlushModalVisible(false)}>取消</Button>
            <Button type="danger" theme="solid" onClick={executeRedFlush}>
              确认红冲
            </Button>
          </Space>
        }
        width={560}
      >
        <div className="issue-confirm-body">
          <Typography.Text type="danger" style={{ display: 'block', marginBottom: 12 }}>
            红冲不可逆，将对以下发票开具负数发票并回写平台状态，请核对无误：
          </Typography.Text>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--app-border)', borderRadius: 6, padding: 8, marginBottom: 12 }}>
            {redFlushTargets.map((r) => (
              <div key={r.id} className="issue-confirm-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: '#64748b' }}>#{r.id}</span>
                <span className="cell-ellipsis" style={{ flex: 1 }}>{r.title}</span>
                <span style={{ color: '#334155' }}>{r.invoice_number}</span>
                <span style={{ color: 'var(--app-primary)', fontWeight: 600 }}>¥{r.recharge_amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <label>红冲原因</label>
            <Select value={redFlushChyydm} onChange={(v) => setRedFlushChyydm(v as string)} optionList={CHYYDM_OPTIONS} style={{ width: '100%' }} />
          </div>
          <div style={{ marginTop: 4 }}>
            <Checkbox checked={redFlushAllowReissue} onChange={(e) => setRedFlushAllowReissue(!!e.target.checked)}>
              允许买家重新开票（勾选=订单解锁为可开票；不勾选=锁定，不可再开票）
            </Checkbox>
          </div>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
            已抵扣/入账的发票需购方在电子税务局确认，系统将自动跳过并标注。
          </Typography.Text>
        </div>
      </Modal>

      {/* 历史票补充信息 Modal */}
      <Modal
        title={`补充发票信息 #${backfillRecord?.id || ''}`}
        visible={backfillModalVisible}
        onCancel={() => { setBackfillModalVisible(false); setBackfillRecord(null); }}
        footer={
          <Space>
            <Button onClick={() => { setBackfillModalVisible(false); setBackfillRecord(null); }}>取消</Button>
            <Button type="primary" theme="solid" loading={backfillSubmitting} onClick={submitBackfill}>
              保存
            </Button>
          </Space>
        }
        width={460}
      >
        {backfillRecord && (
          <div className="issue-confirm-body">
            <div className="issue-confirm-row">
              <label>抬头</label>
              <span>{backfillRecord.title}</span>
            </div>
            <Divider margin="12px 0" />
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>发票号码（20位）</label>
              <Input value={backfillInvoiceNumber} onChange={setBackfillInvoiceNumber} placeholder="20 位数电发票号码" maxLength={20} />
            </div>
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <label>销方税号</label>
              <Input value={backfillSellerTaxNo} onChange={setBackfillSellerTaxNo} placeholder="默认为当前登录公司税号" />
            </div>
            <div className="settings-row" style={{ marginBottom: 0 }}>
              <label>开票日期（选填）</label>
              <DatePicker value={backfillInvoiceDate ?? undefined} onChange={(date) => setBackfillInvoiceDate((date as Date) ?? null)} style={{ width: '100%' }} />
            </div>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
              补充发票号后该记录将变为「红冲就绪」，可参与一键红冲。
            </Typography.Text>
          </div>
        )}
      </Modal>

      {/* 详情 Modal */}
      <Modal title={`发票详情 #${detailRecord?.id || ''}`} visible={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={600}>
        {detailRecord && (
          <div className="invoice-detail-grid">
            <div className="invoice-detail-item"><label>发票抬头</label><span>{detailRecord.title}</span></div>
            <div className="invoice-detail-item"><label>纳税人识别号</label><span>{detailRecord.taxpayer_id || '-'}</span></div>
            <div className="invoice-detail-item"><label>类型</label><span>{CATEGORY_LABELS[detailRecord.invoice_category] || detailRecord.invoice_category}</span></div>
            <div className="invoice-detail-item"><label>金额</label><span style={{ fontWeight: 600 }}>¥{detailRecord.recharge_amount.toFixed(2)}</span></div>
            <div className="invoice-detail-item"><label>开户行</label><span>{detailRecord.bank_name || '-'}</span></div>
            <div className="invoice-detail-item"><label>银行账号</label><span>{detailRecord.bank_account || '-'}</span></div>
            <div className="invoice-detail-item"><label>注册地址</label><span>{detailRecord.register_address || '-'}</span></div>
            <div className="invoice-detail-item"><label>注册电话</label><span>{detailRecord.register_phone || '-'}</span></div>
            <div className="invoice-detail-item full-width"><label>接收邮箱</label><span>{detailRecord.receive_email || '-'}</span></div>
            <div className="invoice-detail-item full-width"><label>备注</label><span>{detailRecord.invoice_remark || '-'}</span></div>
            <div className="invoice-detail-item"><label>状态</label><Tag color={STATUS_COLORS[detailRecord.status] as any}>{STATUS_LABELS[detailRecord.status] || detailRecord.status}</Tag></div>
            <div className="invoice-detail-item"><label>用户</label><span>{detailRecord.username || `用户#${detailRecord.user_id}`}</span></div>
            <div className="invoice-detail-item"><label>申请时间</label><span>{dayjs.unix(detailRecord.created_at).format('YYYY-MM-DD HH:mm:ss')}</span></div>
            <div className="invoice-detail-item"><label>更新时间</label><span>{dayjs.unix(detailRecord.updated_at).format('YYYY-MM-DD HH:mm:ss')}</span></div>
            {detailRecord.invoice_number && (
              <div className="invoice-detail-item"><label>发票号码</label><span>{detailRecord.invoice_number}</span></div>
            )}
            {detailRecord.seller_tax_no && (
              <div className="invoice-detail-item"><label>销方税号</label><span>{detailRecord.seller_tax_no}</span></div>
            )}
            {detailRecord.invoice_date && (
              <div className="invoice-detail-item"><label>开票日期</label><span>{detailRecord.invoice_date}</span></div>
            )}
            {detailRecord.invoice_pdf_url && (
              <div className="invoice-detail-item full-width"><label>PDF 文件</label><span style={{ color: '#10b981', fontWeight: 500 }}>已上传</span></div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

export default InvoiceList;
