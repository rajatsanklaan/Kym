# Azure Data Lake Storage Setup

## Environment Variables

Create a `.env.local` file in the `kymnewui` directory with the following variables:

### Option 1: Using Account Key
```env
AZURE_STORAGE_ACCOUNT_NAME=your_storage_account_name
AZURE_STORAGE_ACCOUNT_KEY=your_storage_account_key
AZURE_STORAGE_FILE_SYSTEM_NAME=fs-general
AZURE_STORAGE_DIRECTORY_PATH=your_directory_path
```

### Option 2: Using SAS Token (Recommended for production)
```env
AZURE_STORAGE_ACCOUNT_NAME=your_storage_account_name
AZURE_STORAGE_SAS_TOKEN=your_sas_token
AZURE_STORAGE_FILE_SYSTEM_NAME=fs-general
AZURE_STORAGE_DIRECTORY_PATH=your_directory_path
```

### Required Variables:
- `AZURE_STORAGE_ACCOUNT_NAME`: Your Azure Storage Account name
- **Either** `AZURE_STORAGE_ACCOUNT_KEY` **OR** `AZURE_STORAGE_SAS_TOKEN` (one is required)

### Optional Variables:
- `AZURE_STORAGE_FILE_SYSTEM_NAME`: **File System (Container) name** - This is the top-level container that holds your files and folders. In Azure Portal, you'll see this listed under "Data storage" → "Containers". (default: `fs-general`)
- `AZURE_STORAGE_DIRECTORY_PATH`: Directory path within the file system (default: empty string, root directory)

**What is a File System?**
- A **File System** in Azure Data Lake Storage Gen2 is the same as a **Container** in Azure Blob Storage
- It's the top-level folder/container that organizes your data
- You can have multiple file systems (containers) in one storage account
- Example names: `fs-general`, `data`, `raw-data`, `processed-data`, etc.

**Where to find your File System name:**
1. Go to Azure Portal → Your Storage Account
2. Navigate to "Data storage" → "Containers" (or "File systems")
3. You'll see a list of all your containers/file systems
4. Copy the name of the container where your JSON files are stored

## Authentication Methods

### Using SAS Token (Recommended)
SAS (Shared Access Signature) tokens provide more secure, time-limited, and scoped access. They are preferred for production environments.

**How to create a SAS token:**
1. Go to Azure Portal → Your Storage Account
2. Navigate to "Shared access signature" under "Security + networking"
3. Configure permissions (at minimum: Read, List)
4. Set the expiration date
5. Click "Generate SAS and connection string"
6. Copy the "SAS token" value (it starts with `?sv=...`)

### Using Account Key
Account keys provide full access to the storage account. Use with caution in production.

**Where to find your Account Key:**
1. Go to Azure Portal → Your Storage Account
2. Navigate to "Access keys" under "Security + networking"
3. Click "Show" next to "key1" or "key2"
4. Copy the "Key" value

## How It Works

1. The API route (`/api/fetch-adls`) connects to Azure Data Lake Storage
2. It lists all JSON files in the specified directory
3. Reads and parses each JSON file
4. Returns all data as an array
5. The UI component fetches data from the API and displays it in the reconciliation table

## JSON Structure

The code expects JSON files with the following structure:

```json
{
  "agent_name": "parsing_batch_agent",
  "processing_status": "success",
  "start_time": "2026-01-11T21:02:44.878221",
  "end_time": "2026-01-11T21:02:44.878232",
  "parsed_json": {
    "bank_name": "CHASE",
    "statement_month": 8,
    "statement_year": 2025,
    "accounts": [
      {
        "account_number": "000000677337936",
        "account_type": "Commercial Checking",
        "beginning_balance": 1780.44,
        "ending_balance": 449.92,
        "total_deposits": 151000.0,
        "total_withdrawals": 152330.52,
        "avg_daily_balance": "NA",
        "no_of_deposits": 5,
        "no_of_withdrawals": 8
      }
    ]
  },
  "batch_id": "parsing_20260111_205231"
}
```

### Key Changes:
- `parsed_json` now contains `bank_name`, `statement_month`, `statement_year`, and an `accounts` array
- `statement_month` and `statement_year` are numbers (not strings)
- Account-specific fields are now inside the `accounts` array
- Each account object contains: `account_number`, `account_type`, `beginning_balance`, `ending_balance`, `total_deposits`, `total_withdrawals`, `avg_daily_balance`, `no_of_deposits`, `no_of_withdrawals`
- Numeric fields in accounts are numbers (not strings)
- `avg_daily_balance` can be a number or the string "NA"

## Notes

- The API automatically searches for `.json` files in the specified directory
- If no files are found in the directory, it will recursively search subdirectories
- Each JSON file can contain multiple accounts in the `accounts` array
- The UI creates one reconciliation row per account in the array
- The UI displays a loading state while fetching data
- Errors are displayed if the connection fails or credentials are missing

