import type { Delivery, DeliveryState } from '../../../../../core/notify/delivery';
import {
  isWebhookUrl,
  WEBHOOK_EVENTS,
  WEBHOOK_LIMITS,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventType,
} from '../../../../../core/notify/webhook-model';
import type { ConfigPage } from '../../../lib/app-view';
import { formatDateTime } from '../../../lib/status-text';
import type { EndpointEditorModel } from '../../../view-models/use-endpoint-editor';
import { useWebhookDeliveries } from '../../../view-models/use-webhook-deliveries';
import { ConfirmButton } from '../../ConfirmButton';
import { SelectField, TextInput, Toggle } from '../../form-controls';
import { PageLink } from '../PageLink';

const EVENT_LABELS: Record<WebhookEventType, string> = {
  printed: '已打印',
  failed: '打印失败',
  duplicate: '重复被拦截',
  invalid: '无法识别',
  test: '测试',
};

const STATE_LABELS: Record<DeliveryState, string> = {
  pending: '等待发送',
  delivered: '已送达',
  failed: '失败',
};

const NO_SIGNATURE = '';

interface WebhooksPageProps {
  webhooks: readonly WebhookEndpoint[];
  secretNames: readonly string[];
  /** 正在编辑的接口（草稿在页面之外，离开时才能确认未保存的修改）。 */
  editor: EndpointEditorModel;
  onChange: (webhooks: WebhookEndpoint[]) => Promise<unknown>;
  onOpenPage: (page: ConfigPage) => void;
}

/** 打印结果通知：接口列表、编辑、发送测试；下方是发送记录（打开这一页时每 10 秒刷新）。 */
export function WebhooksPage({ webhooks, secretNames, editor, onChange, onOpenPage }: WebhooksPageProps) {
  const { draft } = editor;
  const deliveries = useWebhookDeliveries();
  const names = new Map(webhooks.map((endpoint) => [endpoint.id, endpoint.name]));
  const replace = (endpoint: WebhookEndpoint) => webhooks.map((item) => (item.id === endpoint.id ? endpoint : item));
  const isNew = draft !== null && !webhooks.some((item) => item.id === draft.id);

  const save = async (endpoint: WebhookEndpoint) => {
    await onChange(isNew ? [...webhooks, endpoint] : replace(endpoint));
    editor.close();
  };

  return (
    <div className="config-page">
      <p className="config-page__intro">
        每次打印的结果以 JSON
        发送到下面的地址（ERP、仓库系统、群机器人）。先存进本机队列再在后台发送，网络断了会自动重试，不影响打印。设置了签名密钥时带
        HMAC-SHA256 签名，接收方可以验证来源。
      </p>
      {webhooks.length === 0 && draft === null && <p className="config-empty">还没有通知接口。</p>}
      <ul className="config-list">
        {webhooks.map((endpoint) => (
          <li key={endpoint.id} className={`config-card webhook-card${endpoint.enabled ? '' : ' webhook-card--off'}`}>
            <div className="webhook-card__text">
              <strong className="webhook-card__name">{endpoint.name}</strong>
              <span className="webhook-card__url">{endpoint.url}</span>
              <span className="webhook-card__events">
                {endpoint.events.map((event) => EVENT_LABELS[event]).join('、') || '没有勾选事件'}
              </span>
            </div>
            <label className="switch switch--bare webhook-card__switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`启用「${endpoint.name}」`}
                aria-checked={endpoint.enabled}
                checked={endpoint.enabled}
                onChange={(event) => void onChange(replace({ ...endpoint, enabled: event.target.checked }))}
              />
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
            </label>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => void deliveries.sendTest(endpoint.id)}
            >
              发送测试
            </button>
            <button type="button" className="button button--small button--quiet" onClick={() => editor.start(endpoint)}>
              编辑
            </button>
            <ConfirmButton
              className="button button--small button--quiet"
              label="删除"
              confirmLabel="确认删除"
              onConfirm={() => void onChange(webhooks.filter((item) => item.id !== endpoint.id))}
            />
          </li>
        ))}
      </ul>
      {draft ? (
        <EndpointEditor
          draft={draft}
          title={isNew ? '添加接口' : `编辑「${names.get(draft.id) ?? draft.name}」`}
          secretNames={secretNames}
          onChange={editor.change}
          onSave={(endpoint) => void save(endpoint)}
          onCancel={editor.close}
          onOpenPage={onOpenPage}
        />
      ) : (
        <div>
          <button
            type="button"
            className="button button--primary"
            disabled={webhooks.length >= WEBHOOK_LIMITS.endpoints}
            onClick={editor.startNew}
          >
            添加接口（{webhooks.length}/{WEBHOOK_LIMITS.endpoints}）
          </button>
        </div>
      )}
      <DeliveryTable
        deliveries={deliveries.deliveries}
        endpointName={(id) => names.get(id) ?? '（已删除的接口）'}
        onRetry={(id) => void deliveries.retry(id)}
        onRefresh={() => void deliveries.refresh()}
      />
    </div>
  );
}

interface EndpointEditorProps {
  draft: WebhookEndpoint;
  title: string;
  secretNames: readonly string[];
  onChange: (draft: WebhookEndpoint) => void;
  onSave: (endpoint: WebhookEndpoint) => void;
  onCancel: () => void;
  onOpenPage: (page: ConfigPage) => void;
}

/** 编辑接口：在列表下方展开，不弹窗。 */
function EndpointEditor({
  draft,
  title,
  secretNames,
  onChange: setDraft,
  onSave,
  onCancel,
  onOpenPage,
}: EndpointEditorProps) {
  const toggleEvent = (event: WebhookEvent, isOn: boolean) =>
    setDraft({
      ...draft,
      events: WEBHOOK_EVENTS.filter((item) => (item === event ? isOn : draft.events.includes(item))),
    });
  const issue = endpointIssue(draft);
  return (
    <section className="config-card form-section" aria-label="编辑通知接口">
      <h2 className="form-section__title">{title}</h2>
      <TextInput
        label="名称"
        value={draft.name}
        maxLength={WEBHOOK_LIMITS.nameLength}
        placeholder="例如 ERP"
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <TextInput
        label="地址"
        value={draft.url}
        maxLength={WEBHOOK_LIMITS.urlLength}
        placeholder="https://erp.example.com/hooks/labels"
        onChange={(url) => setDraft({ ...draft, url: url.trim() })}
      />
      <SelectField
        label="签名密钥"
        value={draft.secretName ?? NO_SIGNATURE}
        options={[
          { value: NO_SIGNATURE, label: '不签名' },
          ...secretNames.map((name) => ({ value: name, label: name })),
          ...(draft.secretName && !secretNames.includes(draft.secretName)
            ? [{ value: draft.secretName, label: `${draft.secretName}（本机没有这个密钥）` }]
            : []),
        ]}
        onChange={(value) => setDraft({ ...draft, secretName: value === NO_SIGNATURE ? null : value })}
      />
      <p className="form-hint">
        签名密钥在
        <PageLink page="secrets" onOpen={onOpenPage}>
          「密钥」页
        </PageLink>
        添加，和接收方约定同一个值。
      </p>
      {WEBHOOK_EVENTS.map((event) => (
        <Toggle
          key={event}
          label={EVENT_LABELS[event]}
          checked={draft.events.includes(event)}
          onChange={(isOn) => toggleEvent(event, isOn)}
        />
      ))}
      <Toggle label="启用" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
      <div className="webhook-editor__actions">
        {issue && <p className="form-hint form-hint--error">{issue}</p>}
        <button type="button" className="button button--quiet" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={issue !== null}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          保存接口
        </button>
      </div>
    </section>
  );
}

interface DeliveryTableProps {
  deliveries: readonly Delivery[];
  endpointName: (id: string) => string;
  onRetry: (id: number) => void;
  onRefresh: () => void;
}

/** 发送记录：表头固定，最近 100 条；列多时表格自己横向滚动。 */
function DeliveryTable({ deliveries, endpointName, onRetry, onRefresh }: DeliveryTableProps) {
  return (
    <section className="config-card delivery-log" aria-label="发送记录">
      <div className="delivery-log__head">
        <h2 className="delivery-log__title">发送记录（最近 100 条）</h2>
        <button type="button" className="button button--small button--quiet" onClick={onRefresh}>
          刷新
        </button>
      </div>
      {deliveries.length === 0 ? (
        <p className="config-empty">还没有发送记录。</p>
      ) : (
        <div className="data-table data-table--tall" data-allow-x-scroll>
          <table aria-label="发送记录">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">事件</th>
                <th scope="col">接口</th>
                <th scope="col">结果</th>
                <th scope="col">状态码</th>
                <th scope="col">尝试</th>
                <th scope="col">下次重试</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{formatDateTime(delivery.createdAt)}</td>
                  <td>{EVENT_LABELS[delivery.event]}</td>
                  <td>{endpointName(delivery.endpointId)}</td>
                  <td title={delivery.lastError ?? undefined}>
                    <span className={`delivery-state delivery-state--${delivery.state}`}>
                      {STATE_LABELS[delivery.state]}
                    </span>
                    {delivery.lastError && <span className="delivery-log__error">{delivery.lastError}</span>}
                  </td>
                  <td>{delivery.lastStatus ?? '—'}</td>
                  <td>{delivery.attempts}</td>
                  <td>{nextAttempt(delivery)}</td>
                  <td>
                    {delivery.state !== 'delivered' && (
                      <button
                        type="button"
                        className="button button--small button--quiet"
                        onClick={() => onRetry(delivery.id)}
                      >
                        立即重试
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function endpointIssue(endpoint: WebhookEndpoint): string | null {
  if (endpoint.name.trim() === '') {
    return '请填写名称';
  }
  return isWebhookUrl(endpoint.url) ? null : '地址要以 http:// 或 https:// 开头';
}

function nextAttempt(delivery: Delivery): string {
  return delivery.state === 'pending' && delivery.attempts > 0 && delivery.nextAttemptAt !== null
    ? formatDateTime(delivery.nextAttemptAt)
    : '—';
}
