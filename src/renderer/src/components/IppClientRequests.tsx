import type { PendingClientView } from '../../../shared/ipp-sharing';
import { describeClientRequest } from '../lib/ipp-sharing-text';
import { RequestList } from './RequestList';

interface IppClientRequestsProps {
  clients: readonly PendingClientView[];
  onDecide: (address: string, allow: boolean) => void;
}

/** 局域网里的新电脑第一次打印：程序顶部请操作员点「允许」或「拒绝」（2 分钟没人点就作废）。 */
export function IppClientRequests({ clients, onDecide }: IppClientRequestsProps) {
  return (
    <RequestList
      label="等待确认的电脑"
      items={clients.map((client) => ({
        key: client.address,
        subject: `局域网里的电脑 ${client.address}`,
        text: describeClientRequest(client),
      }))}
      onDecide={onDecide}
    />
  );
}
