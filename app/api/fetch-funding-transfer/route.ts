import { NextResponse } from 'next/server';
import { DataLakeServiceClient, StorageSharedKeyCredential } from '@azure/storage-file-datalake';

interface TransactionItem {
  date?: string;
  description?: string;
  amount?: number;
  type?: string;
  non_true_revenue?: number;
}

interface AccountData {
  account_number: string;
  account_type: string;
  mca_deposit?: TransactionItem[];
  returned_items?: TransactionItem[];
  internal_transfer_deposit?: TransactionItem[];
  other_transfer_deposit?: TransactionItem[];
  standard_deposit?: TransactionItem[];
}

interface FundingTransferResponse {
  parsed_json: {
    accounts: AccountData[];
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get('caseId');

    if (!caseId) {
      return NextResponse.json(
        { error: 'caseId parameter is required' },
        { status: 400 }
      );
    }

    // Extract case number from caseId (e.g., "Case101" -> "101")
    const caseNumberMatch = caseId.match(/Case(\d+)/i);
    if (!caseNumberMatch) {
      return NextResponse.json(
        { error: 'Invalid caseId format' },
        { status: 400 }
      );
    }
    const caseNumber = caseNumberMatch[1];

    // Get environment variables
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
    const fileSystemName = process.env.AZURE_STORAGE_FILE_SYSTEM_NAME || 'fs-general';
    const fundingTransferPath = process.env.FUNDING_TRANSFER_DEPOSIT_PATH || 'gold/funding_deposit';

    if (!accountName) {
      return NextResponse.json(
        { error: 'AZURE_STORAGE_ACCOUNT_NAME is required' },
        { status: 500 }
      );
    }

    if (!accountKey && !sasToken) {
      return NextResponse.json(
        { error: 'Either AZURE_STORAGE_ACCOUNT_KEY or AZURE_STORAGE_SAS_TOKEN is required' },
        { status: 500 }
      );
    }

    // Create Data Lake Service Client
    let dataLakeServiceClient: DataLakeServiceClient;
    
    if (sasToken) {
      const cleanSasToken = sasToken.startsWith('?') ? sasToken : `?${sasToken}`;
      const url = `https://${accountName}.dfs.core.windows.net${cleanSasToken}`;
      dataLakeServiceClient = new DataLakeServiceClient(url);
    } else {
      const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey!);
      dataLakeServiceClient = new DataLakeServiceClient(
        `https://${accountName}.dfs.core.windows.net`,
        sharedKeyCredential
      );
    }

    const fileSystemClient = dataLakeServiceClient.getFileSystemClient(fileSystemName);
    
    // Construct the filename: Case1.json, Case2.json, etc. (capital C)
    const fileName = `Case${caseNumber}.json`;
    const filePath = `${fundingTransferPath}/${fileName}`;

    // Read the file
    try {
      const fileClient = fileSystemClient.getFileClient(filePath);
      const downloadResponse = await fileClient.read();
      const fileContent = await streamToString(downloadResponse.readableStreamBody!);
      const jsonData: FundingTransferResponse = JSON.parse(fileContent);

      // Validate structure
      if (!jsonData.parsed_json || !jsonData.parsed_json.accounts || !Array.isArray(jsonData.parsed_json.accounts)) {
        return NextResponse.json(
          { error: 'Invalid file structure' },
          { status: 500 }
        );
      }

      // Calculate funding transfer deposit count for each account
      const accountsWithCounts = jsonData.parsed_json.accounts.map((account) => {
        // Count non_true_revenue = 1 across all relevant arrays
        const countNonTrueRevenue = (items: TransactionItem[] | undefined): number => {
          if (!items || !Array.isArray(items)) return 0;
          return items.filter(item => item.non_true_revenue === 1).length;
        };

        const fundingTransferCount = 
          countNonTrueRevenue(account.mca_deposit) +
          countNonTrueRevenue(account.returned_items) +
          countNonTrueRevenue(account.internal_transfer_deposit) +
          countNonTrueRevenue(account.other_transfer_deposit) +
          countNonTrueRevenue(account.standard_deposit);

        return {
          account_number: account.account_number,
          account_type: account.account_type,
          funding_transfer_count: fundingTransferCount
        };
      });

      return NextResponse.json(
        { data: { accounts: accountsWithCounts } },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          },
        }
      );
    } catch (fileError) {
      console.error(`Error reading funding transfer file ${filePath}:`, fileError);
      return NextResponse.json(
        { error: `File not found: ${fileName}` },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error fetching funding transfer data from ADLS:', error);
    return NextResponse.json(
      { error: 'Failed to fetch funding transfer data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper function to convert stream to string
async function streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data: Buffer) => {
      chunks.push(data);
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    readableStream.on('error', reject);
  });
}
