export const RULER_DEPTH_MM = 4;
const MAJOR_TICK_EVERY_MM = 10;
const MID_TICK_EVERY_MM = 5;
const TICK_LENGTH_MM = { major: 2.6, mid: 1.8, minor: 1 } as const;
const LABEL_OFFSET_MM = 0.5;
const LABEL_BASELINE_MM = 1.9;

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  lengthMm: number;
}

/** 以毫米为 SVG 用户单位，跟随 --mm 缩放，与预览的标签实物比例一致。 */
export function Ruler({ orientation, lengthMm }: RulerProps) {
  const isHorizontal = orientation === 'horizontal';
  const marks = Array.from({ length: lengthMm + 1 }, (_, mm) => mm);
  const numbered = marks.filter((mm) => mm % MAJOR_TICK_EVERY_MM === 0 && mm > 0 && mm < lengthMm);
  const viewBox = isHorizontal ? `0 0 ${lengthMm} ${RULER_DEPTH_MM}` : `0 0 ${RULER_DEPTH_MM} ${lengthMm}`;

  return (
    <svg className={`ruler ruler--${orientation}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
      {marks.map((mm) => {
        const length =
          mm % MAJOR_TICK_EVERY_MM === 0
            ? TICK_LENGTH_MM.major
            : mm % MID_TICK_EVERY_MM === 0
              ? TICK_LENGTH_MM.mid
              : TICK_LENGTH_MM.minor;
        return isHorizontal ? (
          <line key={mm} x1={mm} x2={mm} y1={RULER_DEPTH_MM} y2={RULER_DEPTH_MM - length} />
        ) : (
          <line key={mm} y1={mm} y2={mm} x1={RULER_DEPTH_MM} x2={RULER_DEPTH_MM - length} />
        );
      })}
      {numbered.map((mm) =>
        isHorizontal ? (
          <text key={`n${mm}`} x={mm + LABEL_OFFSET_MM} y={LABEL_BASELINE_MM}>
            {mm}
          </text>
        ) : (
          <text key={`n${mm}`} x={LABEL_OFFSET_MM} y={mm - LABEL_OFFSET_MM}>
            {mm}
          </text>
        ),
      )}
    </svg>
  );
}
