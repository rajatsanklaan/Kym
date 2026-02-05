import { NextResponse } from 'next/server';

// Funding transfer data is not available without Azure ADLS connection.
// This endpoint returns 404 so the UI can show a fallback (e.g. amount 0).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get('caseId');

  if (!caseId) {
    return NextResponse.json(
      { error: 'caseId parameter is required' },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      error: 'Funding transfer data is not available in local mode.',
      details: 'Azure ADLS connection has been removed.',
    },
    { status: 404 }
  );
}
