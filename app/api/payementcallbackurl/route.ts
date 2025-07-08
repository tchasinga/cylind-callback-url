import { getPostgresPoolConnection } from '@/lib/mysqlconnection';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      Body: {
        stkCallback: {
          MerchantRequestID,
          CheckoutRequestID,
          ResultCode,
          ResultDesc,
          CallbackMetadata
        }
      }
    } = body;

    // Extract relevant fields from metadata
    let MpesaReceiptNumber = null;
    let TransactionDate = null;

    if (CallbackMetadata && CallbackMetadata.Item) {
      for (const item of CallbackMetadata.Item) {
        if (item.Name === 'MpesaReceiptNumber') {
          MpesaReceiptNumber = item.Value;
        }
        if (item.Name === 'TransactionDate') {
          TransactionDate = item.Value;
        }
      }
    }

    const client = await getPostgresPoolConnection().connect();

    try {
      // Update the most recent pending transaction with this checkout ID
      await client.query(
        `
          UPDATE achievepayemetwithmpesa
          SET
            payment_status = $1,
            mpesa_receipt_number = $2,
            transaction_date = $3,
            result_code = $4,
            result_description = $5,
            merchant_request_id = $6,
            checkout_request_id = $7
          WHERE checkout_request_id IS NULL
            AND merchant_request_id IS NULL
            AND payment_status = 'pending'
            AND mpesa_number IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1;
        `,
        [
          ResultCode === 0 ? 'completed' : 'failed',
          MpesaReceiptNumber,
          TransactionDate,
          ResultCode,
          ResultDesc,
          MerchantRequestID,
          CheckoutRequestID
        ]
      );
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true, message: 'Callback processed' });
  } catch (error) {
    console.error('Callback processing error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Callback processing failed', details: errorMessage },
      { status: 500 }
    );
  }
}
