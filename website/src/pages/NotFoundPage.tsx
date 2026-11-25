import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StatusScreen, primaryBtn, ghostBtn } from '@/components/system/StatusScreen';

const QUICK = [
  { label: 'Solutions', to: '/products' },
  { label: 'Company database', to: '/companies' },
  { label: 'Resources', to: '/resources' },
  { label: 'Contact', to: '/contact' },
];

export const NotFoundPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Page not found · Germin8';
  }, []);

  return (
    <StatusScreen
      code="404 · Lost in the network"
      title={
        <>
          This page took a <span style={{ color: '#C9A332' }}>wrong turn</span>.
        </>
      }
      body="We could not find what you were looking for. The link may be old, or it may have a typo. Here is the quick way back."
      actions={
        <>
          <Link to="/" className={primaryBtn}>
            Back to homepage
          </Link>
          <Link to="/contact" className={ghostBtn}>
            Contact us
          </Link>
        </>
      }
    >
      <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-1 gap-y-2 text-[14px]">
        {QUICK.map((q, i) => (
          <li key={q.to} className="flex items-center">
            {i > 0 && <span aria-hidden className="mr-1 h-3 w-px bg-[#171717]/15" />}
            <Link to={q.to} className="px-3 py-1 font-medium text-[#171717]/65 transition-colors hover:text-[#171717]">
              {q.label}
            </Link>
          </li>
        ))}
      </ul>
    </StatusScreen>
  );
};
