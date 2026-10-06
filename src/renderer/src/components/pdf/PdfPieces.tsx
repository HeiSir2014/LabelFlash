import type { PdfPieceView } from '../../../../shared/pdf';
import { pieceCaption, visibleOrder } from '../../lib/pdf-view';

interface PdfPiecesProps {
  pieces: readonly PdfPieceView[];
  order: readonly string[];
  removed: ReadonlySet<string>;
  selectedId: string | null;
  /** 打印中不能调整顺序、删除。 */
  isLocked: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
}

/** 要打的块的缩略图网格（按打印顺序）：缩略图就是打出来的黑白点。 */
export function PdfPieces({
  pieces,
  order,
  removed,
  selectedId,
  isLocked,
  onSelect,
  onMove,
  onRemove,
}: PdfPiecesProps) {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const visible = visibleOrder(order, removed).flatMap((id) => {
    const piece = byId.get(id);
    return piece === undefined ? [] : [piece];
  });
  return (
    <ol className="pdf-pieces" aria-label="要打的标签">
      {visible.map((piece, index) => {
        const name = `第 ${piece.page} 页第 ${piece.piece} 张`;
        return (
          <li key={piece.id} className="pdf-piece">
            <button
              type="button"
              className="pdf-piece__image"
              aria-pressed={piece.id === selectedId}
              aria-label={`看${name}打出来的样子`}
              onClick={() => onSelect(piece.id)}
            >
              <img
                alt={name}
                src={`data:image/bmp;base64,${piece.thumbnail.bmp}`}
                width={piece.thumbnail.width}
                height={piece.thumbnail.height}
              />
            </button>
            <span className="pdf-piece__name">
              {index + 1}. {pieceCaption(piece)}
            </span>
            <div className="pdf-piece__actions">
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`${name}往前移`}
                disabled={isLocked || index === 0}
                onClick={() => onMove(piece.id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`${name}往后移`}
                disabled={isLocked || index === visible.length - 1}
                onClick={() => onMove(piece.id, 1)}
              >
                →
              </button>
              <button
                type="button"
                className="button button--small button--quiet"
                aria-label={`删掉${name}`}
                disabled={isLocked}
                onClick={() => onRemove(piece.id)}
              >
                删除
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
