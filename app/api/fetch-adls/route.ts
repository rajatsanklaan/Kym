import { NextResponse } from 'next/server';
import { DataLakeServiceClient, StorageSharedKeyCredential } from '@azure/storage-file-datalake';

interface Account {
  account_number: string;
  account_type: string;
  beginning_balance: number;
  ending_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  avg_daily_balance: string | number;
  no_of_deposits: string | number;
  no_of_withdrawals: string | number;
  returned_items_count?: number;
  returned_items_days?: number;
  overdraft_days?: number;
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
    accounts: Account[];
  };
  batch_id: string;
  filename?: string;
}

export async function GET() {
  try {
    // Get environment variables
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
    const fileSystemName = process.env.AZURE_STORAGE_FILE_SYSTEM_NAME || 'fs-general';
    const directoryPath = process.env.AZURE_STORAGE_DIRECTORY_PATH || '';

    if (!accountName) {
      return NextResponse.json(
        { error: 'AZURE_STORAGE_ACCOUNT_NAME is required. Please check your .env.local file.' },
        { status: 500 }
      );
    }

    if (!accountKey && !sasToken) {
      return NextResponse.json(
        { error: 'Either AZURE_STORAGE_ACCOUNT_KEY or AZURE_STORAGE_SAS_TOKEN is required. Please check your .env.local file.' },
        { status: 500 }
      );
    }

    // Create Data Lake Service Client
    let dataLakeServiceClient: DataLakeServiceClient;
    
    if (sasToken) {
      // Use SAS token (remove leading ? if present)
      const cleanSasToken = sasToken.startsWith('?') ? sasToken : `?${sasToken}`;
      const url = `https://${accountName}.dfs.core.windows.net${cleanSasToken}`;
      dataLakeServiceClient = new DataLakeServiceClient(url);
    } else {
      // Use account key
      const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey!);
      dataLakeServiceClient = new DataLakeServiceClient(
        `https://${accountName}.dfs.core.windows.net`,
        sharedKeyCredential
      );
    }

    // Get file system client
    const fileSystemClient = dataLakeServiceClient.getFileSystemClient(fileSystemName);
    
    // First, collect all file paths (fast operation)
    const filePaths: string[] = [];
    for await (const pathItem of fileSystemClient.listPaths({ path: directoryPath, recursive: true })) {
      if (pathItem.isDirectory === false && pathItem.name?.endsWith('.json')) {
        const filePath = pathItem.name.startsWith('/') ? pathItem.name.slice(1) : pathItem.name;
        filePaths.push(filePath);
      }
    }

    // Read all files in parallel for much faster loading
    const filePromises = filePaths.map(async (filePath): Promise<ADLSResponse | null> => {
      try {
        const fileClient = fileSystemClient.getFileClient(filePath);
        const downloadResponse = await fileClient.read();
        const fileContent = await streamToString(downloadResponse.readableStreamBody!);
        const jsonData: ADLSResponse = JSON.parse(fileContent);

        // Validate structure silently
        if (!jsonData.parsed_json || !jsonData.parsed_json.accounts || !Array.isArray(jsonData.parsed_json.accounts)) {
          return null;
        }

        // Extract filename from filePath and add it to the response
        const fileName = filePath.split('/').pop() || filePath;
        jsonData.filename = fileName;

        return jsonData;
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return null;
      }
    });

    // Wait for all files to be read in parallel
    const results = await Promise.all(filePromises);
    
    // Filter out null values (failed reads or invalid structures)
    const files = results.filter((file): file is ADLSResponse => file !== null);

    return NextResponse.json(
      { data: files },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching data from ADLS:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data from Azure Data Lake Storage', details: error instanceof Error ? error.message : 'Unknown error' },
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

