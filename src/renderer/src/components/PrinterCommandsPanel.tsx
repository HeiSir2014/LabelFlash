import {
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  GAP_RANGE_MM,
} from '../../../core/printer-commands/command-model';
import { effectiveCommandSet } from '../../../core/printer-commands/command-set';
import { PAPER_LIMITS_MM } from '../../../shared/paper-sizes';
import {
  ACTION_LABELS,
  actionsHint,
  type CommandForm,
  canRunAction,
  commandSetOptions,
  densityOptions,
  describeDetection,
  dpiOptions,
  FINISH_OPTIONS,
  factoryResetMessage,
  finishOf,
  ONE_WAY_HINT,
  ORIENTATION_OPTIONS,
  optionValue,
  orientationOf,
  parseOption,
  SENSING_OPTIONS,
  speedOptions,
  UNCHANGED,
} from '../lib/printer-commands-view';
import type { PrinterCommandsModel } from '../view-models/use-printer-commands';
import { ConfirmButton } from './ConfirmButton';
import { ConfirmDialog } from './config/ConfirmDialog';
import { NumberField, Segmented, SelectField, Toggle } from './form-controls';

/** 不用二次确认的三个动作。 */
const ROUTINE_ACTIONS = ['calibrate', 'feed', 'selfTest'] as const;
/** 纸张尺寸的步长：和纸张键的精度一致。 */
const MM_STEP = 0.1;

interface PrinterCommandsPanelProps {
  model: PrinterCommandsModel;
  /** 界面上显示的打印机名。 */
  displayName: string;
}

/** 打印机页每台打印机下面展开的「标签机指令」：指令集、设置、保存并发送，和四个动作。 */
export function PrinterCommandsPanel({ model, displayName }: PrinterCommandsPanelProps) {
  const label = `${displayName} 的标签机指令`;
  const { view, form } = model;
  if (view === null || form === null) {
    return (
      <section className="printer-commands" aria-label={label} aria-busy="true">
        <p className="printer-commands__hint">正在读取打印机的驱动…</p>
      </section>
    );
  }
  const formSet = effectiveCommandSet(form.commandSet, view.detected);
  const savedSet = effectiveCommandSet(view.config.commandSet, view.detected);
  const isBusy = model.busy !== null;
  const canAct = savedSet !== null && !model.isDirty && !isBusy;
  const hint = actionsHint(savedSet, model.isDirty);
  return (
    <section className="printer-commands" aria-label={label}>
      <SelectField
        label="指令集"
        value={form.commandSet}
        options={commandSetOptions(view.detected)}
        onChange={(value) => model.changeCommandSet(value)}
      />
      {form.commandSet === 'auto' && <p className="printer-commands__hint">{describeDetection(view)}</p>}
      {formSet !== null && (
        <CommandSettings set={formSet} form={form} driverDpi={view.driverDpi} onChange={model.change} />
      )}
      <p className="printer-commands__hint">{ONE_WAY_HINT}</p>
      <div className="printer-commands__actions">
        <button type="button" className="button button--primary button--small" disabled={isBusy} onClick={model.save}>
          {model.busy === 'save' ? '正在发送…' : '保存并发送'}
        </button>
      </div>
      <fieldset className="printer-commands__actions printer-commands__actions--fieldset" aria-label="打印机动作">
        {ROUTINE_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className="button button--small"
            disabled={!canAct}
            onClick={() => model.run(action)}
          >
            {model.busy === action ? '正在发送…' : ACTION_LABELS[action]}
          </button>
        ))}
        {canAct && savedSet !== null && canRunAction(savedSet, 'factoryReset') ? (
          <ConfirmButton
            className="button button--small button--quiet"
            label={ACTION_LABELS.factoryReset}
            confirmLabel="确认恢复出厂？"
            onConfirm={model.requestReset}
          />
        ) : (
          <button type="button" className="button button--small button--quiet" disabled>
            {ACTION_LABELS.factoryReset}
          </button>
        )}
      </fieldset>
      {hint !== null && <p className="printer-commands__hint">{hint}</p>}
      {model.message !== null && (
        <p
          className={`printer-commands__message printer-commands__message--${model.message.tone}`}
          role={model.message.tone === 'error' ? 'alert' : 'status'}
        >
          {model.message.text}
        </p>
      )}
      {model.isConfirmingReset && (
        <ConfirmDialog
          title={ACTION_LABELS.factoryReset}
          message={factoryResetMessage(displayName)}
          confirmLabel={ACTION_LABELS.factoryReset}
          cancelLabel="不恢复"
          onConfirm={model.confirmReset}
          onCancel={model.cancelReset}
        />
      )}
    </section>
  );
}

interface CommandSettingsProps {
  set: CommandSet;
  form: CommandForm;
  driverDpi: number | null;
  onChange: (patch: Partial<CommandForm>) => void;
}

/** 这种指令集能设的项；每一项都可以「不改」。 */
function CommandSettings({ set, form, driverDpi, onChange }: CommandSettingsProps) {
  const limits = COMMAND_SET_LIMITS[set];
  const { media } = form;
  const changeMedia = (patch: Partial<CommandForm['media']>) => onChange({ media: { ...media, ...patch } });
  return (
    <>
      <SelectField
        label="浓度"
        value={optionValue(form.density)}
        options={densityOptions(set)}
        onChange={(value) => onChange({ density: parseOption(value) })}
      />
      <SelectField
        label={set === 'epl' ? '速度档位' : '速度'}
        value={optionValue(form.speed)}
        options={speedOptions(set)}
        onChange={(value) => onChange({ speed: parseOption(value) })}
      />
      <Toggle label="设置纸张" checked={form.mediaEnabled} onChange={(mediaEnabled) => onChange({ mediaEnabled })} />
      {form.mediaEnabled && (
        <>
          <NumberField
            label="纸宽"
            value={media.widthMm}
            min={PAPER_LIMITS_MM.width.min}
            max={PAPER_LIMITS_MM.width.max}
            step={MM_STEP}
            onChange={(widthMm) => changeMedia({ widthMm })}
          />
          <NumberField
            label="纸高"
            value={media.heightMm}
            min={PAPER_LIMITS_MM.height.min}
            max={PAPER_LIMITS_MM.height.max}
            step={MM_STEP}
            onChange={(heightMm) => changeMedia({ heightMm })}
          />
          <Segmented
            label="纸张类型"
            value={media.sensing}
            options={SENSING_OPTIONS}
            onChange={(sensing) => changeMedia({ sensing })}
          />
          <NumberField
            label={media.sensing === 'gap' ? '间隙' : '黑标高度'}
            value={media.gapMm}
            min={GAP_RANGE_MM.min}
            max={GAP_RANGE_MM.max}
            step={MM_STEP}
            onChange={(gapMm) => changeMedia({ gapMm })}
          />
        </>
      )}
      <SelectField
        label="打印方向"
        value={form.orientation ?? UNCHANGED}
        options={ORIENTATION_OPTIONS}
        onChange={(value) => onChange({ orientation: orientationOf(value) })}
      />
      {limits.canSetFinish ? (
        <SelectField
          label="出纸方式"
          value={form.finish ?? UNCHANGED}
          options={FINISH_OPTIONS}
          onChange={(value) => onChange({ finish: finishOf(value) })}
        />
      ) : (
        <p className="printer-commands__hint">
          {COMMAND_SET_NAMES[set]} 不设出纸方式（撕纸 /
          剥离）：它和切刀、热敏模式在同一条指令里，单独改容易改错，请在打印机上设置
        </p>
      )}
      {limits.usesDots && (
        <SelectField
          label="分辨率"
          value={optionValue(form.dpi)}
          options={dpiOptions(driverDpi)}
          onChange={(value) => onChange({ dpi: parseOption(value) })}
        />
      )}
    </>
  );
}
