import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

// Transform local case JSON to match the existing ADLSResponse structure
interface TransformedResponse {
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
  // Optional per-account enhanced metrics derived from bsi_analyzer_result
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

// Shape of the BSI analyzer result section in the local JSON
interface BSIAnalyzerAccount {
  account_number?: string;
  account_type?: string;
  mca_deposit?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
    non_true_revenue?: number;
  }>;
  mca_withdrawal?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
  returned_items?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
  overdrafts?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
  internal_transfer_deposit?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
    non_true_revenue?: number;
  }>;
  other_transfer_deposit?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
    non_true_revenue?: number;
  }>;
  standard_deposit?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
    non_true_revenue?: number;
  }>;
  internal_transfer_withdrawal?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
  other_transfer_withdrawal?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
  standard_withdrawal?: Array<{
    date?: string;
    description?: string;
    amount?: number;
    type?: string;
  }>;
}

interface BSIAnalyzerResult {
  agent_name?: string;
  processing_status?: string;
  start_time?: string;
  end_time?: string;
  parsed_json?: {
    accounts?: BSIAnalyzerAccount[];
  };
}

interface LocalCaseFile {
  document_name?: string;
  parsing_agent_result?: LocalParsingAgentResult;
  bsi_analyzer_result?: BSIAnalyzerResult;
}

function transformLocalCaseFile(data: LocalCaseFile, filename: string): TransformedResponse | null {
  try {
    const parsing = data.parsing_agent_result;

    if (
      !parsing ||
      !parsing.parsed_json ||
      !parsing.parsed_json.accounts ||
      !Array.isArray(parsing.parsed_json.accounts)
    ) {
      console.log('Skipping local file - missing parsing_agent_result or accounts:', filename);
      return null;
    }

    if (!parsing.parsed_json.bank_statement_information) {
      console.log('Skipping local file - missing bank_statement_information:', filename);
      return null;
    }

    const bankInfo = parsing.parsed_json.bank_statement_information;
    const timestamp = parsing.start_time || parsing.end_time || '';

    // Derive a batch/case id from document_name or filename
    const baseName =
      (data.document_name || filename).replace(/\.(pdf|json)$/i, '') || `LOCAL-${Date.now()}`;

    // Build base parsed_json.accounts
    const accounts = (parsing.parsed_json.accounts || []).map((account) => ({
      account_number: account.account_number || '',
      account_type: account.account_type || '',
      account_summary: {
        beginning_balance: account.account_summary?.beginning_balance ?? 0,
        ending_balance: account.account_summary?.ending_balance ?? 0,
        total_deposits: account.account_summary?.total_deposits ?? null,
        total_withdrawals: account.account_summary?.total_withdrawals ?? null,
        total_deposits_count: account.account_summary?.total_deposits_count ?? null,
        total_withdrawals_count: account.account_summary?.total_withdrawals_count ?? null,
        avg_daily_balance: account.account_summary?.avg_daily_balance ?? null,
        overdraft_days: account.account_summary?.overdraft_days ?? 0,
      },
      transactions: account.transactions,
      calculated_deposits_count: account.calculated_deposits_count,
      calculated_withdrawals_count: account.calculated_withdrawals_count,
      total_transactions: account.total_transactions,
    }));

    // Optionally derive enhanced metrics from bsi_analyzer_result
    let bsiEnhancedAccounts: TransformedResponse['bsi_enhanced_accounts'] = undefined;

    if (data.bsi_analyzer_result && data.bsi_analyzer_result.parsed_json?.accounts) {
      const bsiAccounts = data.bsi_analyzer_result.parsed_json.accounts;

      const sumNonTrueRevenue = (
        items:
          | Array<{ amount?: number; non_true_revenue?: number | undefined }>
          | undefined
      ): number => {
        if (!items || !Array.isArray(items)) return 0;
        return items
          .filter((item) => item.non_true_revenue === 1)
          .reduce((sum, item) => sum + (item.amount ?? 0), 0);
      };

      const getUniqueDayCount = (
        items: Array<{ date?: string | undefined }> | undefined
      ): number => {
        if (!items || !Array.isArray(items)) return 0;
        const days = new Set<string>();
        for (const item of items) {
          if (item.date) {
            days.add(item.date);
          }
        }
        return days.size;
      };

      bsiEnhancedAccounts = {};

      for (const account of accounts) {
        const accountNumber = account.account_number;
        if (!accountNumber) continue;

        // Find corresponding BSI analyzer account by account number
        const bsiAcc =
          bsiAccounts.find(
            (a) => (a.account_number || '').replace(/[\s\-]/g, '') === accountNumber.replace(/[\s\-]/g, '')
          ) || bsiAccounts[0];

        if (!bsiAcc) continue;

        const mca_deposit_count = bsiAcc.mca_deposit?.length ?? 0;
        const mca_withdrawal_count = bsiAcc.mca_withdrawal?.length ?? 0;

        const funding_or_transfer_deposits =
          sumNonTrueRevenue(bsiAcc.mca_deposit) +
          sumNonTrueRevenue(bsiAcc.returned_items as any) +
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
  } catch (error) {
    console.error('Error transforming local case file:', error);
    return null;
  }
}

export async function GET() {
  try {
    // Read all local JSON files from the /jsons directory
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

    const transformedData: TransformedResponse[] = [];

    // Read and transform each file
    for (const file of jsonFiles) {
      const filePath = path.join(jsonDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed: LocalCaseFile = JSON.parse(content);
        const transformed = transformLocalCaseFile(parsed, file);
        if (transformed) {
          transformedData.push(transformed);
        }
      } catch (err) {
        console.error('Error processing local json file:', file, err);
        // Skip invalid files
      }
    }

    return NextResponse.json(
      { data: transformedData },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error loading local json data:', error);

    const errorMessage = 'Failed to load local json data';
    const errorDetails = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { 
        error: errorMessage, 
        details: errorDetails 
      },
      { status: 500 }
    );
  }
}
