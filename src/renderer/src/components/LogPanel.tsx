import React, { useEffect, useRef, useState } from 'react';
import { Typography, Button } from '@douyinfe/semi-ui';
import { IconChevronDown, IconChevronUp, IconDelete } from '@douyinfe/semi-icons';
import type { AutomationLog } from '../types/invoice';

interface Props {
  logs: AutomationLog[];
}

const LogPanel: React.FC<Props> = ({ logs }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (containerRef.current && !collapsed) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, collapsed]);

  return (
    <div className={`app-log-panel-wrapper ${collapsed ? 'collapsed' : ''}`} style={collapsed ? {} : { height: 220, maxHeight: 220 }}>
      <div className="app-log-panel-header" onClick={() => setCollapsed((c) => !c)}>
        <div className="app-log-panel-header-left">
          <Typography.Text type="tertiary" size="small" strong>
            运行日志
          </Typography.Text>
          {logs.length > 0 && (
            <span className="log-count-badge">{logs.length}</span>
          )}
        </div>
        <Button
          size="small"
          theme="borderless"
          icon={collapsed ? <IconChevronUp size="small" /> : <IconChevronDown size="small" />}
          onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
        />
      </div>
      {!collapsed && (
        <div className="app-log-panel" ref={containerRef}>
          {logs.length === 0 && (
            <div className="log-line info" style={{ opacity: 0.5 }}>
              <span className="log-time">--:--:--</span>
              等待操作...
            </div>
          )}
          {logs.map((log, i) => (
            <div key={i} className={`log-line ${log.level}`}>
              <span className="log-time">{log.time}</span>
              {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LogPanel;
