import { NextResponse } from 'next/server';

// In local mode we no longer connect to Cosmos DB.
// This endpoint now simply reports that BSI enhanced data is not available.
export async function GET() {
  return NextResponse.json(
    { error: 'BSI enhanced data is not available in local JSON mode.' },
    { status: 404 }
  );
}
