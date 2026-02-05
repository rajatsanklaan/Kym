import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

// Load local case JSON from /jsons and transform to statement shape
export interface LocalStatementData {
  agent_name: string;
  processing_status: string;
  start_time: string;
  end_time: string;
  parsed_json: {
    bank_statement_information: {
      bank_name: string;
      account_holder?: string;
      statement_start_date: string;
      statement_end_date: string;
      n_month: number[];
      business_address?: string;
    };
    accounts: Array<{
      account_number: string;
      account_type: string;
      account_summary: {
        beginning_balance: number;
        ending_balance: number;
        total_deposits: number | null;
        total_withdrawals: number | null;
        total_deposits_count: number | null;
        total_withdrawals_count: number | null;
        avg_daily_balance: number | null;
        overdraft_days?: number;
      };
      transactions?: Array<{
        date: string;
        description: string;
        amount: number;
        type: 'Credit' | 'Debit';
        category: string;
        classification?: string;
      }>;
      calculated_deposits_count?: number;
      calculated_withdrawals_count?: number;
      total_transactions?: number;
    }>;
  };
  batch_id: string;
  source_path?: string;
  source_folder?: string;
  filename?: string;
  bsi_enhanced_accounts?: {
    [accountNumber: string]: {
      mca_deposit_count: number;
      funding_or_transfer_deposits: number;
      mca_withdrawal_count: number;
      avg_daily_balance: number;
      return_items: number;
      overdraft_items_count: number;
      return_item_days: number;
      overdraft_days: number;
      monthly_number_of_deposits: number;
      no_of_withdrawals: number;
    };
  };
}

// Shape of the local JSON files in /jsons (partial, only what we need)
interface LocalParsingAgentResult {
  agent_name?: string;
  processing_status?: string;
  start_time?: string;
  end_time?: string;
  parsed_json?: {
    bank_statement_information?: {
      bank_name?: string;
      account_holder?: string;
      statement_start_date?: string;
      statement_end_date?: string;
      n_month?: number[];
      business_address?: string;
    };
    accounts?: Array<{
      account_number?: string;
      account_type?: string;
      account_summary?: {
        beginning_balance?: number;
        ending_balance?: number;
        total_deposits?: number | null;
        total_withdrawals?: number | null;
        total_deposits_count?: number | null;
        total_withdrawals_count?: number | null;
        avg_daily_balance?: number | null;
        overdraft_days?: number;
      };
      transactions?: Array<{
        date?: string;
        description?: string;
        amount?: number;
        type?: 'Credit' | 'Debit';
        category?: string;
      }>;
      calculated_deposits_count?: number;
      calculated_withdrawals_count?: number;
      total_transactions?: number;
    }>;
  };
}

interface BSIAnalyzerAccount {
  account_number?: string;
  account_type?: string;
  mca_deposit?: Array<{ date?: string; description?: string; amount?: number; type?: string; non_true_revenue?: number }>;
  mca_withdrawal?: Array<{ date?: string; description?: string; amount?: number; type?: string }>;
  returned_items?: Array<{ date?: string; description?: string; amount?: number; type?: string; non_true_revenue?: number }>;
  overdrafts?: Array<{ date?: string; description?: string; amount?: number; type?: string }>;
  service_charges?: Array<{ date?: string; description?: string; amount?: number; type?: string; non_true_revenue?: number }>;
  atm_cash_withdrawal?: Array<{ date?: string; description?: string; amount?: number; type?: string }>;
  internal_transfer_deposit?: Array<{ date?: string; amount?: number; non_true_revenue?: number }>;
  other_transfer_deposit?: Array<{ date?: string; amount?: number; non_true_revenue?: number }>;
  standard_deposit?: Array<{ date?: string; amount?: number; non_true_revenue?: number }>;
  internal_transfer_withdrawal?: Array<{ date?: string; amount?: number }>;
  other_transfer_withdrawal?: Array<{ date?: string; amount?: number }>;
  standard_withdrawal?: Array<{ date?: string; amount?: number }>;
}

interface BSIAnalyzerResult {
  agent_name?: string;
  processing_status?: string;
  start_time?: string;
  end_time?: string;
  parsed_json?: { accounts?: BSIAnalyzerAccount[] };
}

interface LocalCaseFile {
  document_name?: string;
  parsing_agent_result?: LocalParsingAgentResult;
  bsi_analyzer_result?: BSIAnalyzerResult;
}

function transformLocalCaseFile(data: LocalCaseFile, filename: string): LocalStatementData | null {
  try {
    const parsing = data.parsing_agent_result;

    if (
      !parsing ||
      !parsing.parsed_json ||
      !parsing.parsed_json.accounts ||
      !Array.isArray(parsing.parsed_json.accounts)
    ) {
      return null;
    }

    if (!parsing.parsed_json.bank_statement_information) {
      return null;
    }

    const bankInfo = parsing.parsed_json.bank_statement_information;
    const timestamp = parsing.start_time || parsing.end_time || '';

    const baseName =
      (data.document_name || filename).replace(/\.(pdf|json)$/i, '') || `LOCAL-${Date.now()}`;

    type AccountItem = LocalStatementData['parsed_json']['accounts'][number];
    type TransactionItem = NonNullable<AccountItem['transactions']>[number];
    const normalizeTransactions = (
      raw: Array<{ date?: string; description?: string; amount?: number; type?: string; category?: string }> | undefined
    ): TransactionItem[] | undefined => {
      if (!raw || !Array.isArray(raw)) return undefined;
      return raw.map((t) => ({
        date: t.date ?? '',
        description: t.description ?? '',
        amount: t.amount ?? 0,
        type: (t.type === 'Credit' || t.type === 'Debit' ? t.type : 'Credit') as 'Credit' | 'Debit',
        category: t.category ?? '',
      }));
    };
    const accounts: AccountItem[] = (parsing.parsed_json.accounts || []).map((account) => {
      const summary = account.account_summary;
      const accountSummary: AccountItem['account_summary'] = {
        beginning_balance: summary?.beginning_balance ?? 0,
        ending_balance: summary?.ending_balance ?? 0,
        total_deposits: summary?.total_deposits ?? null,
        total_withdrawals: summary?.total_withdrawals ?? null,
        total_deposits_count: summary?.total_deposits_count ?? null,
        total_withdrawals_count: summary?.total_withdrawals_count ?? null,
        avg_daily_balance: summary?.avg_daily_balance ?? null,
      };
      if (summary?.overdraft_days != null) accountSummary.overdraft_days = summary.overdraft_days;
      return {
        account_number: account.account_number || '',
        account_type: account.account_type || '',
        account_summary: accountSummary,
        transactions: normalizeTransactions(account.transactions),
        calculated_deposits_count: account.calculated_deposits_count,
        calculated_withdrawals_count: account.calculated_withdrawals_count,
        total_transactions: account.total_transactions,
      };
    });

    let bsiEnhancedAccounts: LocalStatementData['bsi_enhanced_accounts'] = undefined;

    if (data.bsi_analyzer_result && data.bsi_analyzer_result.parsed_json?.accounts) {
      const bsiAccounts = data.bsi_analyzer_result.parsed_json.accounts;

      const sumNonTrueRevenue = (
        items: Array<{ amount?: number; non_true_revenue?: number }> | undefined
      ): number => {
        if (!items || !Array.isArray(items)) return 0;
        return items
          .filter((item) => item.non_true_revenue === 1)
          .reduce((sum, item) => sum + (item.amount ?? 0), 0);
      };

      const getUniqueDayCount = (items: Array<{ date?: string }> | undefined): number => {
        if (!items || !Array.isArray(items)) return 0;
        const days = new Set<string>();
        for (const item of items) {
          if (item.date) days.add(item.date);
        }
        return days.size;
      };

      bsiEnhancedAccounts = {};

      for (const account of accounts) {
        const accountNumber = account.account_number;
        if (!accountNumber) continue;

        const bsiAcc =
          bsiAccounts.find(
            (a) => (a.account_number || '').replace(/[\s\-]/g, '') === accountNumber.replace(/[\s\-]/g, '')
          ) || bsiAccounts[0];

        if (!bsiAcc) continue;

        const mca_deposit_count = bsiAcc.mca_deposit?.length ?? 0;
        const mca_withdrawal_count = bsiAcc.mca_withdrawal?.length ?? 0;

        const funding_or_transfer_deposits =
          sumNonTrueRevenue(bsiAcc.mca_deposit) +
          sumNonTrueRevenue(bsiAcc.returned_items as Array<{ amount?: number; non_true_revenue?: number }>) +
          sumNonTrueRevenue(bsiAcc.internal_transfer_deposit) +
          sumNonTrueRevenue(bsiAcc.other_transfer_deposit) +
          sumNonTrueRevenue(bsiAcc.standard_deposit);

        const return_items = bsiAcc.returned_items?.length ?? 0;
        const overdraft_items_count = bsiAcc.overdrafts?.length ?? 0;
        const return_item_days = getUniqueDayCount(bsiAcc.returned_items);
        const overdraft_days = getUniqueDayCount(bsiAcc.overdrafts);

        const monthly_number_of_deposits =
          (bsiAcc.mca_deposit?.length ?? 0) +
          (bsiAcc.internal_transfer_deposit?.length ?? 0) +
          (bsiAcc.other_transfer_deposit?.length ?? 0) +
          (bsiAcc.standard_deposit?.length ?? 0);

        const no_of_withdrawals =
          (bsiAcc.mca_withdrawal?.length ?? 0) +
          (bsiAcc.internal_transfer_withdrawal?.length ?? 0) +
          (bsiAcc.other_transfer_withdrawal?.length ?? 0) +
          (bsiAcc.standard_withdrawal?.length ?? 0);

        const avg_daily_balance = account.account_summary.avg_daily_balance ?? 0;

        // Build list of BSI entries (date, amount, type, classification) to match against parsing transactions.
        // We keep the full transaction list from parsing_agent_result and only assign classifications from BSI.
        const bsiEntries: Array<{ date: string; amount: number; type: string; classification: string }> = [];

        const addBsiEntries = (
          items:
            | Array<{ date?: string; amount?: number; type?: string; non_true_revenue?: number }>
            | undefined,
          classification: string,
          defaultType: 'Credit' | 'Debit'
        ) => {
          if (!items || !Array.isArray(items)) return;
          for (const t of items) {
            const type = t.type === 'Credit' || t.type === 'Debit' ? t.type : defaultType;
            const label = classification || 'Other transaction';
            bsiEntries.push({
              date: t.date ?? '',
              amount: t.amount ?? 0,
              type,
              classification: label,
            });
          }
        };

        const addBsiEntriesByNonTrueRevenue = (
          items:
            | Array<{ date?: string; amount?: number; type?: string; non_true_revenue?: number }>
            | undefined,
          defaultType: 'Credit' | 'Debit'
        ) => {
          if (!items || !Array.isArray(items)) return;
          for (const t of items) {
            const type = t.type === 'Credit' || t.type === 'Debit' ? t.type : defaultType;
            const label = t.non_true_revenue === 1 ? fundingLabel : otherLabel;
            bsiEntries.push({
              date: t.date ?? '',
              amount: t.amount ?? 0,
              type,
              classification: label,
            });
          }
        };

        const fundingLabel = 'Funding Transfer Deposit';
        const otherLabel = 'Other transaction';

        addBsiEntries(bsiAcc.mca_deposit, 'Mca Deposit, ' + fundingLabel, 'Credit');
        addBsiEntries(bsiAcc.mca_withdrawal, 'Mca Withdrawal', 'Debit');
        addBsiEntriesByNonTrueRevenue(
          bsiAcc.returned_items as Array<{ date?: string; amount?: number; type?: string; non_true_revenue?: number }>,
          'Debit'
        );
        addBsiEntries(
          bsiAcc.overdrafts as Array<{ date?: string; amount?: number; type?: string }>,
          otherLabel,
          'Debit'
        );
        // service_charges can be Credit (refunds) or Debit; use actual type from data
        if (bsiAcc.service_charges) {
          for (const t of bsiAcc.service_charges) {
            const type = t.type === 'Credit' || t.type === 'Debit' ? t.type : 'Debit';
            const label = t.non_true_revenue === 1 ? fundingLabel : otherLabel;
            bsiEntries.push({
              date: t.date ?? '',
              amount: t.amount ?? 0,
              type,
              classification: label,
            });
          }
        }
        addBsiEntries(
          bsiAcc.atm_cash_withdrawal as Array<{ date?: string; amount?: number; type?: string }>,
          otherLabel,
          'Debit'
        );
        addBsiEntriesByNonTrueRevenue(bsiAcc.internal_transfer_deposit, 'Credit');
        addBsiEntriesByNonTrueRevenue(bsiAcc.other_transfer_deposit, 'Credit');
        addBsiEntriesByNonTrueRevenue(bsiAcc.standard_deposit, 'Credit');
        addBsiEntries(bsiAcc.internal_transfer_withdrawal, otherLabel, 'Debit');
        addBsiEntries(bsiAcc.other_transfer_withdrawal, otherLabel, 'Debit');
        addBsiEntries(bsiAcc.standard_withdrawal, otherLabel, 'Debit');

        // Assign classification to each parsing transaction by matching (date, amount, type). One BSI entry matches at most one transaction.
        const txs = account.transactions ?? [];
        for (const tx of txs) {
          const date = tx.date ?? '';
          const amount = tx.amount ?? 0;
          const type = tx.type ?? '';
          const idx = bsiEntries.findIndex(
            (e) => String(e.date) === String(date) && Number(e.amount) === Number(amount) && e.type === type
          );
          if (idx >= 0) {
            (tx as TransactionItem).classification = bsiEntries[idx].classification;
            bsiEntries.splice(idx, 1);
          } else {
            (tx as TransactionItem).classification = otherLabel;
          }
        }

        bsiEnhancedAccounts[accountNumber] = {
          mca_deposit_count,
          funding_or_transfer_deposits,
          mca_withdrawal_count,
          avg_daily_balance: typeof avg_daily_balance === 'number' ? avg_daily_balance : 0,
          return_items,
          overdraft_items_count,
          return_item_days,
          overdraft_days,
          monthly_number_of_deposits,
          no_of_withdrawals,
        };
      }
    }

    return {
      agent_name: parsing.agent_name || 'local_parsing_agent',
      processing_status: parsing.processing_status || 'success',
      start_time: timestamp,
      end_time: timestamp,
      parsed_json: {
        bank_statement_information: {
          bank_name: bankInfo.bank_name || '',
          account_holder: bankInfo.account_holder,
          statement_start_date: bankInfo.statement_start_date || '',
          statement_end_date: bankInfo.statement_end_date || '',
          n_month: bankInfo.n_month || [],
          business_address: bankInfo.business_address,
        },
        accounts,
      },
      batch_id: baseName,
      source_path: filename,
      source_folder: 'jsons',
      filename,
      bsi_enhanced_accounts: bsiEnhancedAccounts,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const jsonDir = path.join(process.cwd(), 'jsons');

    let files: string[] = [];
    try {
      files = await fs.readdir(jsonDir);
    } catch (err) {
      console.error('Error reading jsons directory:', err);
      return NextResponse.json(
        { error: 'Failed to read local jsons directory', details: err instanceof Error ? err.message : 'Unknown error' },
        { status: 500 }
      );
    }

    const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));
    const transformedData: LocalStatementData[] = [];

    for (const file of jsonFiles) {
      const filePath = path.join(jsonDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed: LocalCaseFile = JSON.parse(content);
        const transformed = transformLocalCaseFile(parsed, file);
        if (transformed) transformedData.push(transformed);
      } catch {
        // Skip invalid files
      }
    }

    return NextResponse.json(
      { data: transformedData },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    console.error('Error loading local json data:', error);
    return NextResponse.json(
      { error: 'Failed to load local json data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
