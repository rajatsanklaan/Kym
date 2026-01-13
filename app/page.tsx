"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

// Parsed account data from ADLS
interface AccountData {
  account_number: string;
  account_type: string;
  beginning_balance: number;
  ending_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  avg_daily_balance: string | number;
  no_of_deposits: string | number;
  no_of_withdrawals: string | number;
  mca_withdrawals?: string | number;
  returned_items_count?: number;
  returned_items_days?: number;
  overdraft_days?: number;
}

// Mapped account for display
interface MappedAccount {
  account_number: string;
  account_type: string;
  starting_balance: number;
  ending_balance: number;
  total_credits: number;
  total_debits: number;
  average_balance: number;
  no_of_deposits: number;
  no_of_withdrawals: number;
  mca_withdrawals: number;
  returned_items_count: number;
  returned_items_days: number;
  overdraft_days: number;
}

// Row with all accounts from one bank statement
interface ReconciliationRow {
  case_id: string;
  document_name: string;
  iso_email: string;
  bank_name: string;
  month_year: string;
  first_transaction_date: string;
  last_transaction_date: string;
  accounts: MappedAccount[];
  filename: string;
}

interface ADLSResponse {
  agent_name: string;
  processing_status: string;
  start_time: string;
  end_time: string;
  parsed_json: {
    bank_name: string;
    statement_month: number;
    statement_year: number;
    accounts: AccountData[];
  };
  batch_id: string;
  filename?: string;
}

// Helper function to convert month number to month abbreviation
const getMonthAbbreviation = (month: string | number): string => {
  const monthStr = String(month);
  const monthMap: { [key: string]: string } = {
    "1": "JAN", "2": "FEB", "3": "MAR", "4": "APR",
    "5": "MAY", "6": "JUN", "7": "JUL", "8": "AUG",
    "9": "SEP", "10": "OCT", "11": "NOV", "12": "DEC"
  };
  return monthMap[monthStr] || monthStr;
};

// Helper function to safely parse float values (handles both number and string)
const safeParseFloat = (value: string | number | undefined | null): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  // If already a number, return it
  if (typeof value === 'number') {
    return isNaN(value) ? 0 : value;
  }
  // If string, parse it
  const str = String(value).trim().replace(/,/g, '');
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
};

// Helper function to safely parse integer values (handles both number and string)
const safeParseInt = (value: string | number | undefined | null): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  // If already a number, return it
  if (typeof value === 'number') {
    return isNaN(value) ? 0 : Math.floor(value);
  }
  // If string, parse it
  const str = String(value).trim().replace(/,/g, '');
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? 0 : parsed;
};

// Map account data to MappedAccount
const mapAccountData = (account: AccountData): MappedAccount => {
  return {
    account_number: account.account_number || '',
    account_type: account.account_type || '',
    starting_balance: safeParseFloat(account.beginning_balance),
    ending_balance: safeParseFloat(account.ending_balance),
    total_credits: safeParseFloat(account.total_deposits),
    total_debits: Math.abs(safeParseFloat(account.total_withdrawals)), // Always ensure positive value
    average_balance: safeParseFloat(account.avg_daily_balance),
    no_of_deposits: safeParseInt(account.no_of_deposits),
    no_of_withdrawals: safeParseInt(account.no_of_withdrawals),
    mca_withdrawals: safeParseFloat(account.mca_withdrawals),
    returned_items_count: safeParseInt(account.returned_items_count),
    returned_items_days: safeParseInt(account.returned_items_days),
    overdraft_days: safeParseInt(account.overdraft_days),
  };
};

// Map ADLS response to ReconciliationRow (one row per bank statement with all accounts)
const mapADLSToReconciliationRow = (adlsData: ADLSResponse): ReconciliationRow => {
  // Validate input
  if (!adlsData || !adlsData.parsed_json) {
    throw new Error('Invalid ADLS data structure: missing parsed_json');
  }

  const { parsed_json, batch_id, filename } = adlsData;
  
  const monthYear = `${getMonthAbbreviation(parsed_json.statement_month || 1)} ${parsed_json.statement_year || 2025}`;
  
  // Generate first and last transaction dates based on statement month/year
  const month = safeParseInt(parsed_json.statement_month) || 1;
  const year = safeParseInt(parsed_json.statement_year) || 2025;
  const lastDay = new Date(year, month, 0).getDate(); // Get last day of the month
  const firstTransactionDate = `${month}/1/${year}`;
  const lastTransactionDate = `${month}/${lastDay}/${year}`;

  // Map all accounts
  const mappedAccounts = (parsed_json.accounts || []).map((account) => mapAccountData(account));

  // Extract filename without "_parsing_result.json" suffix
  let displayFilename = '';
  if (filename) {
    displayFilename = filename.replace(/_parsing_result\.json$/i, '');
  }

  return {
    case_id: batch_id || `CASE-${Date.now()}`,
    document_name: `Statement_${monthYear.replace(" ", "_")}.pdf`,
    iso_email: "",
    bank_name: parsed_json.bank_name || '',
    month_year: monthYear,
    first_transaction_date: firstTransactionDate,
    last_transaction_date: lastTransactionDate,
    accounts: mappedAccounts,
    filename: displayFilename,
  };
};

function ReconciliationRowComponent({ data }: { data: ReconciliationRow }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isBSIModalOpen, setIsBSIModalOpen] = useState(false);

  // Get the currently selected account
  const selectedAccount = data.accounts[selectedAccountIndex] || data.accounts[0];
  const hasMultipleAccounts = data.accounts.length > 1;

  // Calculate difference for the selected account hii
  const calculateDifference = (account: MappedAccount): number => {
    const calcBalance = account.starting_balance - account.total_debits + account.total_credits;
    const difference = account.ending_balance - calcBalance;
    // Round to 2 decimal places to handle floating point precision
    const rounded = Math.round(difference * 100) / 100;
    return Math.abs(rounded) < 0.005 ? 0 : rounded;
  };

  // Check if the selected account harmonizes (difference is 0)
  // git error solve
  const difference = selectedAccount ? calculateDifference(selectedAccount) : 0;
  const isHarmonized = difference === 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleKABSClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleAccountSelect = (index: number) => {
    setSelectedAccountIndex(index);
    setIsAccountDropdownOpen(false);
  };

  // Get first two words of bank name as array, or split single word into two parts if long
  const getBankNameFirstTwoWords = (bankName: string) => {
    const words = bankName.split(" ");
    if (words.length >= 2) {
      return words.slice(0, 2);
    } else if (words.length === 1) {
      const word = words[0];
      // If word is short (4 characters or less), show on single line
      if (word.length <= 4) {
        return [word];
      }
      // Split longer single word in the middle to show on two lines
      const mid = Math.ceil(word.length / 2);
      return [word.substring(0, mid), word.substring(mid)];
    } else {
      return ["", ""];
    }
  };

  return (
    <div className="border border-gray-300 rounded-lg mb-4 bg-white/80 backdrop-blur-sm">
      {/* Collapsed Row Header */}
      <div className="flex items-center justify-between py-2 px-4 hover:bg-white/60">
        <div className="flex items-center gap-8 flex-1">
          {/* Rectangular Image with White Background */}
          <div className="bg-white border border-gray-300 rounded px-2 py-1 flex flex-col items-center justify-center w-[60px] h-[35px] flex-shrink-0">
            {getBankNameFirstTwoWords(data.bank_name).map((word, index) => (
              <div key={index} className="font-semibold text-black text-[8px] leading-tight text-center w-full whitespace-nowrap">
                {word}
              </div>
            ))}
          </div>
          <span className="text-gray-700 font-medium w-[90px] text-left">{data.month_year}</span>
          <span className="text-gray-600 w-[130px] text-left">
            {selectedAccount?.account_number || ''}
            {hasMultipleAccounts && <span className="text-xs text-blue-500 ml-1">(+{data.accounts.length - 1})</span>}
          </span>
          <span className="text-gray-600 w-[110px] text-left">{formatCurrency(selectedAccount?.starting_balance || 0)}</span>
          <span className="text-gray-600 w-[110px] text-left">{formatCurrency(selectedAccount?.ending_balance || 0)}</span>
          <span className="bg-blue-100 text-blue-500 font-bold px-3 py-1 rounded-lg text-sm inline-block">{data.filename || ''}</span>
        </div>
        
        {/* Reconciliation Status Section */}
        <div className="flex items-center gap-3 ml-auto mr-4">
            {isHarmonized ? (
              <>
                {/* Green Checkmark */}
                <svg
                  className="w-5 h-5 text-green-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-semibold text-green-600 text-sm">Tick and Tie</span>
              </>
            ) : (
              <>
                {/* Red X Mark */}
                <svg
                  className="w-5 h-5 text-red-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-semibold text-red-600 text-sm">Tick and Tie</span>
              </>
            )}
          </div>
        
        <button
          onClick={handleKABSClick}
          className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium text-sm cursor-pointer"
        >
          KABS
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && selectedAccount && (
        <div className="border-t border-gray-200 bg-[#f7f7f7]">
          {/* Financial Summary Row */}
          <div className="flex items-stretch gap-4">
            {/* Starting Balance */}
            <div className="flex-1 p-4 bg-sky-100 text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">STARTING BALANCE</div>
              <div className="text-sm font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.starting_balance)}</div>
              <div className="w-[60%] border-b border-gray-300 mt-4 mx-auto"></div>
            </div>
            
            {/* Total Debits */}
            <div className="flex-1 p-4 bg-sky-100 text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">- TOTAL DEBITS</span>
                <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.total_debits)}</div>
              <div className="w-[60%] border-b border-gray-300 mt-4 mx-auto"></div>
            </div>
            
            {/* Total Credits */}
            <div className="flex-1 p-4 bg-sky-100 text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">+ TOTAL CREDITS</span>
                <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.total_credits)}</div>
              <div className="w-[60%] border-b border-gray-300 mt-4 mx-auto"></div>
            </div>
            
            {/* Ending Balance */}
            <div className="flex-1 p-4 bg-sky-100 text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">= ENDING BALANCE</div>
              <div className="text-sm font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.ending_balance)}</div>
              <div className="w-[60%] border-b border-gray-300 mt-4 mx-auto"></div>
            </div>
            
            {/* Calc Balance */}
            <div className="flex-1 bg-blue-100 rounded-[5px] px-6 py-3 pr-8 text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">CALC BALANCE</div>
              <div className="text-sm font-semibold text-blue-600 mt-1">
                {formatCurrency(selectedAccount.starting_balance - selectedAccount.total_debits + selectedAccount.total_credits)}
              </div>
            </div>
            
            {/* Difference */}
            <div className="flex-1 bg-blue-100 rounded-[5px] px-6 py-3 pr-8 text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">DIFFERENCE</div>
              <div className={`text-sm font-semibold mt-1 ${isHarmonized ? 'text-blue-600' : 'text-red-600'}`}>
                {formatCurrency(difference)}
              </div>
            </div>
          </div>
          
          {/* Bank Details and Totals Row */}
          <div className="flex items-stretch">
            {/* Account Selector - Bottom Left */}
            <div className="p-4 min-w-[180px] flex flex-col items-start justify-start">
              {/* Bank Name */}
              <div className="mb-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">BANK</div>
                <div className="text-sm font-semibold text-gray-800 mt-1">{data.bank_name}</div>
              </div>
              
              {/* Account Selector Dropdown - Only show if multiple accounts */}
              {hasMultipleAccounts && (
                <div className="relative">
                  <button
                    onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Account {selectedAccountIndex + 1}
                    <svg className={`w-4 h-4 transition-transform ${isAccountDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {/* Dropdown Menu */}
                  {isAccountDropdownOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                      <div className="py-1">
                        {data.accounts.map((account, index) => (
                          <button
                            key={index}
                            onClick={() => handleAccountSelect(index)}
                            className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${
                              index === selectedAccountIndex ? 'bg-blue-100 border-l-4 border-blue-600' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-semibold text-gray-800 text-sm">Account {index + 1}</div>
                                <div className="text-xs text-gray-500">{account.account_number}</div>
                                <div className="text-xs text-gray-400">{account.account_type}</div>
                              </div>
                              {index === selectedAccountIndex && (
                                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Account Type */}
              <div className="mt-2">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">ACCOUNT TYPE</div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{selectedAccount.account_type}</div>
              </div>
            </div>
            
            {/* # of Deposits and Number of Withdrawals Container */}
            <div className="flex flex-col ml-auto gap-0">
              {/* # of Deposits */}
              <div className="px-4 pt-4 pb-1 text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  # OF DEPOSITS
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{selectedAccount.no_of_deposits}</div>
              </div>
              
              {/* Number of Withdrawals */}
              <div className="px-4 pt-1 pb-1 text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  # OF WITHDRAWALS
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{selectedAccount.no_of_withdrawals}</div>
              </div>
              
              {/* Daily Average Balance */}
              <div className="px-4 pt-1 pb-4 text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                   AVERAGE DAILY BALANCE
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.average_balance)}</div>
              </div>
            </div>
            
            {/* Total Credits and Debits Container */}
            <div className="flex flex-col ml-auto gap-0">
              {/* Total Credits with Count */}
              <div className="px-4 pt-4 pb-1 text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  TOTAL CREDITS ({selectedAccount.no_of_deposits})
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.total_credits)}</div>
              </div>
              
              {/* Total Debits with Count */}
              <div className="px-4 pt-1 pb-4 text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  TOTAL DEBITS ({selectedAccount.no_of_withdrawals})
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">{formatCurrency(selectedAccount.total_debits)}</div>
              </div>
            </div>
            
            {/* BSI Enhanced Button */}
            <div className="flex items-center justify-end p-4 ml-auto">
              <button
                onClick={() => setIsBSIModalOpen(true)}
                className="px-6 py-2 bg-white border-2 border-gray-400 text-gray-700 rounded hover:bg-gray-100 font-medium text-sm cursor-pointer"
              >
                BSI ENHANCED
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BSI Enhanced Modal - rendered via Portal to escape stacking context */}
      {isBSIModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={() => setIsBSIModalOpen(false)}
        >
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 transition-opacity duration-300"
            style={{ opacity: isBSIModalOpen ? 1 : 0 }}
          />
          
          {/* Modal Content */}
          <div 
            className="relative bg-white rounded-2xl w-full max-w-4xl p-6 shadow-2xl mx-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setIsBSIModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Modal Header */}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">BSI ENHANCED</h2>
              <p className="text-sm text-gray-500 mt-1">{selectedAccount?.account_number || ''}</p>
            </div>

            {/* Two Cards Container */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Information 1 Card */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200 shadow-sm">
                <div className="space-y-4">
                  {/* Row 1: MCA Deposits + Funding Transfer Deposit */}
                  <div className="flex gap-4">
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        MCA Deposits
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {formatCurrency(0)}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Funding Transfer Deposit
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {formatCurrency(0)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Row 2: MCA Withdrawals + Avg Daily Balance */}
                  <div className="flex gap-4">
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        MCA Withdrawals
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {formatCurrency(selectedAccount?.mca_withdrawals || 0)}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Avg Daily Balance (Calculated)
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {formatCurrency(selectedAccount?.average_balance || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Information 2 Card */}
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-5 border border-emerald-200 shadow-sm">
                <div className="space-y-4">
                  {/* Row 1: Return Item Count + Overdraft Count */}
                  <div className="flex gap-4">
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Return Item Count
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {selectedAccount?.returned_items_count || 0}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Overdraft Count
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        0
                      </span>
                    </div>
                  </div>
                  
                  {/* Row 2: Return Item Days + Overdraft Days */}
                  <div className="flex gap-4">
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Return Item Days
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {selectedAccount?.returned_items_days || 0}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Overdraft Days
                      </span>
                      <span className="text-lg font-semibold text-gray-800 mt-1">
                        {selectedAccount?.overdraft_days || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Two boxes below blue box */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200 shadow-sm">
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    No. of Deposit(Calculated)
                  </span>
                  <span className="text-lg font-semibold text-gray-800 mt-0.5">
                    {selectedAccount?.no_of_deposits || 0}
                  </span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-3 border border-emerald-200 shadow-sm">
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    No. of Withdrawals(Calculated)
                  </span>
                  <span className="text-lg font-semibold text-gray-800 mt-0.5">
                    {selectedAccount?.no_of_withdrawals || 0}
                  </span>
                </div>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Home() {
  const [reconciliationData, setReconciliationData] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/fetch-adls');
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch data');
        }

        const result = await response.json();
        
        // Create one ReconciliationRow per bank statement (with all accounts)
        const mappedData: ReconciliationRow[] = [];
        result.data.forEach((item: ADLSResponse) => {
          // Validate that parsed_json and accounts exist
          if (!item.parsed_json || !item.parsed_json.accounts || !Array.isArray(item.parsed_json.accounts)) {
            return;
          }
          
          try {
            const mapped = mapADLSToReconciliationRow(item);
            mappedData.push(mapped);
          } catch {
            // Skip invalid items silently
          }
        });
        
        setReconciliationData(mappedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred while fetching data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen p-8 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-white">Statement Insights</h1>
          <div className="space-y-4">
            {/* Skeleton Loading Cards */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm animate-pulse">
                <div className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-8 flex-1">
                    {/* Bank logo skeleton */}
                    <div className="w-[60px] h-[35px] bg-gray-300 rounded"></div>
                    {/* Month/Year skeleton */}
                    <div className="w-[90px] h-4 bg-gray-300 rounded"></div>
                    {/* Account number skeleton */}
                    <div className="w-[130px] h-4 bg-gray-300 rounded"></div>
                    {/* Starting balance skeleton */}
                    <div className="w-[110px] h-4 bg-gray-300 rounded"></div>
                    {/* Ending balance skeleton */}
                    <div className="w-[110px] h-4 bg-gray-300 rounded"></div>
                  </div>
                  <div className="flex items-center gap-3 mr-4">
                    {/* Status skeleton */}
                    <div className="w-5 h-5 bg-gray-300 rounded-full"></div>
                    <div className="w-[80px] h-4 bg-gray-300 rounded"></div>
                  </div>
                  {/* Button skeleton */}
                  <div className="w-[60px] h-8 bg-gray-300 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-white">Statement Insights</h1>
          <div className="flex items-center justify-center py-12">
            <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="font-semibold">Error loading data</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 relative z-10">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-white">Statement Insights</h1>
        {reconciliationData.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-600">No data found in Azure Data Lake Storage</div>
          </div>
        ) : (
          <div className="space-y-4">
            {reconciliationData.map((row, index) => (
              <ReconciliationRowComponent key={row.case_id || index} data={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
