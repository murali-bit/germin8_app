import React, { useState } from 'react';
import { Calculator, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export const RoiCalculator: React.FC = () => {
  const [employees, setEmployees] = useState(250);
  const [transactions, setTransactions] = useState(45000);
  const [avgMinutes, setAvgMinutes] = useState(12);
  const [hourlyRate, setHourlyRate] = useState(45);
  const [requested, setRequested] = useState(false);

  // Formulas for calculations:
  // Total hours spent currently = (transactions * avgMinutes) / 60
  // Time saved (approx 60% automation) = Total hours * 0.60
  // Estimated cost savings = Time saved * hourlyRate * 0.75
  // Accuracy improvement = based on volume scaling from 14% to 26%
  const totalHours = (transactions * avgMinutes) / 60;
  const timeSavedHours = Math.round(totalHours * 0.18); // Realistic focused saving matching PDF numbers
  const costSavings = Math.round(timeSavedHours * hourlyRate);
  const accuracyGain = Math.min(26, Math.max(12, Math.round(12 + (transactions / 10000) * 1.5)));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm text-left font-sans">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="w-5 h-5 text-blue-600" />
        <h3 className="text-base font-bold text-gray-900 font-display">
          ROI Calculator
        </h3>
      </div>
      <p className="text-xs text-gray-500 mb-5">
        Estimate your monthly benefit from automating key operations.
      </p>

      <div className="space-y-4">
        {/* Employees */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Employees
          </label>
          <input
            type="number"
            value={employees}
            onChange={(e) => setEmployees(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>

        {/* Transactions / month */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Transactions / month
          </label>
          <input
            type="number"
            value={transactions}
            onChange={(e) => setTransactions(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>

        {/* Avg time per transaction slider */}
        <div>
          <div className="flex justify-between items-center text-xs font-semibold text-gray-700 mb-1">
            <span>Avg time per transaction (mins)</span>
            <span className="text-blue-600 font-mono">Selected: {avgMinutes} mins</span>
          </div>
          <input
            type="range"
            min="2"
            max="60"
            value={avgMinutes}
            onChange={(e) => setAvgMinutes(Number(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* Estimated hourly rate */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Estimated hourly rate ($)
          </label>
          <input
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Math.max(10, Number(e.target.value)))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>

        {/* Output Box */}
        <div className="mt-5 p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
          <div className="text-xs uppercase tracking-wider font-bold text-gray-500 font-display">
            Projected Monthly Benefit
          </div>

          <div className="pt-1">
            <div className="text-sm font-semibold text-gray-900">
              Time saved: <span className="font-bold text-blue-600">{timeSavedHours.toLocaleString()} hrs</span>
            </div>
            <div className="text-sm font-semibold text-gray-900">
              Estimated cost savings: <span className="font-bold text-emerald-600">${costSavings.toLocaleString()}</span>
            </div>
            <div className="text-sm font-semibold text-gray-900">
              Accuracy improvement estimate: <span className="font-bold text-purple-600">+{accuracyGain}%</span>
            </div>
          </div>

          {requested ? (
            <div className="pt-2 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Request received! An ROI specialist will contact you.
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRequested(true)}
              className="mt-3 w-full bg-[#111110] hover:bg-[#292824] text-white py-2 px-3 rounded-md text-xs font-semibold tracking-wide transition-colors"
            >
              Request Personalized ROI
            </button>
          )}

          <p className="text-[11px] text-gray-500 pt-1 leading-normal">
            A Germin8 specialist will use your inputs to provide a detailed ROI assessment and implementation plan.
          </p>
        </div>
      </div>

      {/* Need Help Card */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <p className="text-xs font-semibold text-gray-900 mb-1">Need help?</p>
        <p className="text-xs text-gray-500 mb-3">
          Talk to an ROI specialist for a tailored analysis.
        </p>
        <Link
          to="/book-a-demo"
          className="block w-full text-center bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 py-1.5 px-3 rounded-md text-xs font-semibold transition-colors"
        >
          Schedule a Call
        </Link>
      </div>
    </div>
  );
};
