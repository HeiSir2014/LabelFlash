import { mmToDots, type PrinterAction, type PrinterCommandConfig } from './command-model';

/**
 * ZPL II 指令（依据《ZPL II 编程指南》）。~ 开头的控制指令收到就执行；^ 开头的格式指令放在 ^XA … ^XZ 之间。
 * 一条一行：指南的示例都这样写，换行不影响解析，日志和测试也好读。设置最后用 ^JUS 存进打印机，关机后仍在。
 */
const LINE_END = '\n';
/** ~SD 的参数固定两位（00–30）。 */
const DARKNESS_DIGITS = 2;

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

/** 保存时发一次的设置；各项都不改时返回空字符串。纸宽、纸长按 dpi 换成打印点。 */
export function zplSetup(config: PrinterCommandConfig, dpi: number): string {
  const control: string[] = [];
  const format: string[] = [];
  if (config.density !== null) {
    // ~SD 是绝对浓度（和面板上的设置一样）；^MD 是在当前浓度上加减，结果取决于打印机原来的值，所以不用它。
    control.push(`~SD${String(config.density).padStart(DARKNESS_DIGITS, '0')}`);
  }
  if (config.media !== null) {
    format.push(
      `^PW${mmToDots(config.media.widthMm, dpi)}`,
      `^LL${mmToDots(config.media.heightMm, dpi)}`,
      // Y：间隙纸（web sensing）；M：黑标纸（mark sensing）。
      config.media.sensing === 'gap' ? '^MNY' : '^MNM',
    );
  }
  if (config.speed !== null) {
    format.push(`^PR${config.speed}`);
  }
  if (config.orientation !== null) {
    format.push(config.orientation === 'normal' ? '^PON' : '^POI');
  }
  if (config.finish !== null) {
    format.push(config.finish === 'tear' ? '^MMT' : '^MMP');
  }
  if (control.length === 0 && format.length === 0) {
    return '';
  }
  // 只改浓度时也发一个只有 ^JUS 的格式：~SD 同样要 ^JUS 才存下来。
  return lines([...control, '^XA', ...format, '^JUS', '^XZ']);
}

/** 动作指令；不需要设置和分辨率。 */
export function zplAction(action: PrinterAction): string {
  switch (action) {
    case 'calibrate':
      // ~JC：测纸张长度并调整纸张传感器。
      return lines(['~JC']);
    case 'feed':
      // ~PH：走一张空白标签。
      return lines(['~PH']);
    case 'selfTest':
      // ~WC：打印配置标签。
      return lines(['~WC']);
    case 'factoryReset':
      // ^JUF 载入出厂设置，^JUS 存下来（不然关机后回到原来的设置）。不发 ^JUN：它恢复网络设置，联网的打印机会失联。
      return lines(['^XA', '^JUF', '^JUS', '^XZ']);
  }
}
