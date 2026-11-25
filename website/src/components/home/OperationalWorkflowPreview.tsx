import React from 'react';
import productPreviewImg from '@/assets/product-preview-imac.jpg';

export const OperationalWorkflowPreview: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden text-left font-sans transition-all hover:shadow-md">
      {/* Card Header matching Germin8.pdf Page 1 */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
        <div>
          <span className="text-xs uppercase tracking-wider font-bold text-gray-400 font-display">
            Product preview
          </span>
          <h3 className="text-base sm:text-lg font-bold text-gray-900 font-display">
            Operational workflow — live
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            Looping 10s
          </span>
        </div>
      </div>

      {/* Clean Professional Image Showcase */}
      <div className="relative bg-gray-50/50 p-2 sm:p-4 flex items-center justify-center overflow-hidden">
        <img
          src={productPreviewImg}
          alt="Germin8 Operational Workflow Live Dashboard on Apple iMac Display"
          className="w-full h-auto rounded-xl object-cover shadow-sm border border-gray-200/60 transition-transform duration-300 hover:scale-[1.01]"
          loading="eager"
        />
      </div>
    </div>
  );
};
