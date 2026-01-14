import { NextResponse } from 'next/server';
import { DataLakeServiceClient, StorageSharedKeyCredential } from '@azure/storage-file-datalake';

interface BSIAnalysisResponse {
  agent_name: string;
  processing_status: string;
  start_time: string;
  end_time: string;
  parsed_json: {
    accounts: Array<{
      account_number: string;
      account_type: string;
      summary_metrics: {
        mca_deposit_count: number;
        mca_withdrawal_count: number;
        returned_items_count: number;
        returned_items_days: number;
        overdraft_count: number;
        overdraft_days: number;
      };
      mca_deposit?: Array<{
        mca_name: string;
        date: string;
        type: string;
        description: string;
        amount: number;
      }>;
      mca_withdrawal?: Array<{
        mca_name: string;
        date: string;
        type: string;
        description: string;
        amount: number;
      }>;
    }>;
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

    // Get environment variables
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
    const fileSystemName = process.env.AZURE_STORAGE_FILE_SYSTEM_NAME || 'fs-general';
    const mcaDirectoryPath = process.env.AZURE_STORAGE_DIRECTORY_PATH_MCA || 'gold/mca';

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
    
    // List all directories in the MCA path
    const directories: string[] = [];
    for await (const pathItem of fileSystemClient.listPaths({ path: mcaDirectoryPath, recursive: false })) {
      if (pathItem.isDirectory && pathItem.name) {
        directories.push(pathItem.name);
      }
    }

    // Find the directory that matches the caseId (remove everything before "Case")
    let matchedDirectory: string | null = null;
    for (const dir of directories) {
      const dirName = dir.split('/').pop() || '';
      // Extract case name by matching "Case" followed by digits
      // This handles formats like "20_Case20", "01_Case101", etc.
      const caseMatch = dirName.match(/Case(\d+)/);
      if (caseMatch && caseMatch[0] === caseId) {
        matchedDirectory = dir;
        break;
      }
    }
    
    // If no match found, log the available directories for debugging
    if (!matchedDirectory) {
      console.log('Available directories:', directories.map(d => d.split('/').pop()));
      console.log('Looking for case ID:', caseId);
    }

    if (!matchedDirectory) {
      const availableDirs = directories.map(d => d.split('/').pop()).join(', ');
      return NextResponse.json(
        { 
          error: `No directory found matching case: ${caseId}`, 
          details: `Available directories: ${availableDirs}`,
          searchedFor: caseId
        },
        { status: 404 }
      );
    }

    // Construct the BSI analysis filename
    const bsiAnalysisFileName = `${caseId}_bsi_analysis.json`;
    const bsiAnalysisPath = `${matchedDirectory}/${bsiAnalysisFileName}`;

    // Read the BSI analysis file
    try {
      const fileClient = fileSystemClient.getFileClient(bsiAnalysisPath);
      const downloadResponse = await fileClient.read();
      const fileContent = await streamToString(downloadResponse.readableStreamBody!);
      const jsonData: BSIAnalysisResponse = JSON.parse(fileContent);

      // Validate structure
      if (!jsonData.parsed_json || !jsonData.parsed_json.accounts || !Array.isArray(jsonData.parsed_json.accounts)) {
        return NextResponse.json(
          { error: 'Invalid BSI analysis file structure' },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { data: jsonData },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          },
        }
      );
    } catch (fileError) {
      console.error(`Error reading BSI analysis file ${bsiAnalysisPath}:`, fileError);
      return NextResponse.json(
        { error: `BSI analysis file not found: ${bsiAnalysisFileName}` },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error fetching BSI analysis data from ADLS:', error);
    return NextResponse.json(
      { error: 'Failed to fetch BSI analysis data', details: error instanceof Error ? error.message : 'Unknown error' },
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
