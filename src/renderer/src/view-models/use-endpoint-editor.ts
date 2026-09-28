import { useCallback, useState } from 'react';
import { DEFAULT_WEBHOOK_EVENTS, type WebhookEndpoint } from '../../../core/notify/webhook-model';
import { deepEqual } from '../lib/deep-equal';

/**
 * 通知接口的编辑草稿。放在页面之外，离开页面时才能按「有未保存的修改」确认，
 * 和模板、规则的编辑器同一套规则。
 */
export function useEndpointEditor() {
  const [draft, setDraft] = useState<WebhookEndpoint | null>(null);
  const [original, setOriginal] = useState<WebhookEndpoint | null>(null);

  const start = useCallback((endpoint: WebhookEndpoint) => {
    setDraft(endpoint);
    setOriginal(endpoint);
  }, []);

  const startNew = useCallback(
    () =>
      start({
        id: crypto.randomUUID(),
        name: '',
        url: 'https://',
        secretName: null,
        events: [...DEFAULT_WEBHOOK_EVENTS],
        enabled: true,
      }),
    [start],
  );

  const close = useCallback(() => {
    setDraft(null);
    setOriginal(null);
  }, []);

  return {
    draft,
    isDirty: draft !== null && !deepEqual(draft, original),
    start,
    startNew,
    change: setDraft,
    close,
  };
}

export type EndpointEditorModel = ReturnType<typeof useEndpointEditor>;
