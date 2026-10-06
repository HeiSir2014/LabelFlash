import { RequestList } from './RequestList';

interface OriginRequestsProps {
  /** 正在等确认的网站，先来的在前。 */
  origins: readonly string[];
  onDecide: (origin: string, allow: boolean) => void;
}

/** 网站想使用本机接口：程序顶部请操作员点「允许」或「拒绝」（只能用鼠标点，见 RequestList）。 */
export function OriginRequests({ origins, onDecide }: OriginRequestsProps) {
  return (
    <RequestList
      label="等待确认的网站"
      items={origins.map((origin) => ({
        key: origin,
        subject: origin,
        text: '想使用这台电脑的打印服务：提交打印、读取模板和打印机列表。不认识这个网站就点「拒绝」。',
      }))}
      onDecide={onDecide}
    />
  );
}
