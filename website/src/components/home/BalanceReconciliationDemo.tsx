import React from 'react';

interface LedgerRow {
  account: string;
  group: string;
  dr: string;
  cr: string;
}

const ROWS: LedgerRow[] = [
  { account: 'HDFC Current Account', group: 'Bank Accounts', dr: '42,18,920.00', cr: '' },
  { account: 'Apex Infotech Solutions Pvt Ltd', group: 'Sundry Debtors', dr: '18,45,000.00', cr: '' },
  { account: 'Matrix Cloud Infrastructure Ltd', group: 'Sundry Creditors', dr: '', cr: '9,80,450.00' },
  { account: 'Input CGST @ 9%', group: 'Duties & Taxes', dr: '3,74,210.00', cr: '' },
  { account: 'Input SGST @ 9%', group: 'Duties & Taxes', dr: '3,74,210.00', cr: '' },
  { account: 'Opening Stock', group: 'Stock-in-Hand', dr: '65,30,000.00', cr: '' },
  { account: 'Equity Share Capital', group: 'Capital Account', dr: '', cr: '1,00,00,000.00' },
  { account: 'Reserves and Surplus', group: 'Reserves & Surplus', dr: '', cr: '23,62,890.00' },
];

const Amt: React.FC<{ v: string }> = ({ v }) => (
  <td className="py-4 px-4 text-right tabular-nums whitespace-nowrap">{v ? `₹ ${v}` : '—'}</td>
);

export const BalanceReconciliationDemo: React.FC = () => (
  <div className="border-t border-ink-950">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-[14px] font-light text-ink-700">
        <thead>
          <tr className="text-[11px] uppercase tracking-label text-ink-500 border-b border-ink-200">
            <th className="py-4 pr-4 font-medium">Ledger</th>
            <th className="py-4 px-4 font-medium">Group</th>
            <th className="py-4 px-4 font-medium text-right">Tally Dr</th>
            <th className="py-4 px-4 font-medium text-right">Tally Cr</th>
            <th className="py-4 px-4 font-medium text-right">Zoho Dr</th>
            <th className="py-4 px-4 font-medium text-right">Zoho Cr</th>
            <th className="py-4 pl-4 font-medium text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.account} className="border-b border-ink-100">
              <td className="py-4 pr-4 text-ink-950 font-normal">{r.account}</td>
              <td className="py-4 px-4 text-ink-500">{r.group}</td>
              <Amt v={r.dr} />
              <Amt v={r.cr} />
              <Amt v={r.dr} />
              <Amt v={r.cr} />
              <td className="py-4 pl-4 text-right text-[11px] uppercase tracking-label text-ink-950">Matched</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink-950 text-ink-950 font-normal">
            <td className="py-5 pr-4 font-display text-[20px]">Total</td>
            <td className="py-5 px-4" />
            <Amt v="1,33,43,340.00" />
            <Amt v="1,33,43,340.00" />
            <Amt v="1,33,43,340.00" />
            <Amt v="1,33,43,340.00" />
            <td className="py-5 pl-4 text-right text-[11px] uppercase tracking-label">Balanced</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p className="mt-5 text-[13px] text-ink-500 font-light">
      Opening balance adjustment: ₹ 0.00. Illustrative figures from a sample dataset.
    </p>
  </div>
);
