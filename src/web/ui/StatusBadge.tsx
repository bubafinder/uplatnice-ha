import { formatAmount } from '../../shared/hub3';
import { currencyLabel, currentYm, type Status } from '../../shared/history';
import { MONTHS } from '../../shared/placeholders';

export function StatusBadge({ status, month = currentYm() }: { status: Status; month?: string }) {
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const Name = name[0].toUpperCase() + name.slice(1);
  if (status.kind === 'paid')
    return <span className="status paid"><span className="dot" aria-hidden />{Name}: plaćeno {formatAmount(status.cents)} {currencyLabel(status.currency)}</span>;
  if (status.kind === 'pause') return <span className="status pause"><span className="dot" aria-hidden />{Name}: pauza</span>;
  return <span className="status unpaid"><span className="dot" aria-hidden />{Name}: nije plaćeno</span>;
}
