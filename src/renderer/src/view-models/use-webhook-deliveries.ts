import { useCallback, useEffect, useState } from 'react';
import type { Delivery } from '../../../core/notify/delivery';
import { notices, reportError } from '../lib/notices';

/** 发送记录多久自动刷新一次：通知在后台发送，界面上要能看到进展。 */
const REFRESH_INTERVAL_MS = 10_000;

/** 打印结果通知的发送记录、发送测试、立即重试。 */
export function useWebhookDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  const refresh = useCallback(async () => {
    try {
      setDeliveries(await window.api.listWebhookDeliveries());
    } catch (error) {
      reportError('读取通知记录', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const sendTest = useCallback(
    async (endpointId: string) => {
      try {
        if (await window.api.sendTestWebhook(endpointId)) {
          notices.push('info', '测试通知已排队发送，结果见下方发送记录');
        }
        void refresh();
      } catch (error) {
        reportError('发送测试通知', error);
      }
    },
    [refresh],
  );

  const retry = useCallback(
    async (id: number) => {
      try {
        await window.api.retryWebhookDelivery(id);
        void refresh();
      } catch (error) {
        reportError('重试通知', error);
      }
    },
    [refresh],
  );

  return { deliveries, refresh, sendTest, retry };
}
