import { getPostgresPoolConnection } from "@/lib/mysqlconnection";
import { NextResponse } from "next/server";

// Define M-Pesa callback response types
interface MpesaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

export async function POST(request: Request) {
  const client = await getPostgresPoolConnection().connect();
  try {
    const callbackData: MpesaCallbackBody = await request.json();

    // Validate callback data structure
    if (!callbackData?.Body?.stkCallback) {
      console.error('Invalid callback structure:', callbackData);
      return NextResponse.json(
        { error: 'Invalid callback structure' },
        { status: 400 }
      );
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = callbackData.Body.stkCallback;

    // Log the callback for debugging
    console.log('M-Pesa Callback Received:', {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    });

    // Check if payment was successful (ResultCode 0 means success)
    const isSuccess = ResultCode === 0;
    let mpesaReceiptNumber = '';
    let phoneNumber = '';
    let amount = 0;
    let transactionDate = '';

    // Extract payment details if successful
    if (isSuccess && CallbackMetadata) {
      for (const item of CallbackMetadata.Item) {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            mpesaReceiptNumber = String(item.Value);
            break;
          case 'PhoneNumber':
            phoneNumber = String(item.Value);
            break;
          case 'Amount':
            amount = Number(item.Value);
            break;
          case 'TransactionDate':
            transactionDate = String(item.Value);
            break;
        }
      }
    }

    // Update database with payment status using parameterized query
    await client.query(
      `UPDATE achievepayemetwithmpesa 
       SET 
         payment_status = $1,
         mpesa_receipt_number = $2,
         transaction_date = $3,
         result_code = $4,
         result_description = $5,
         merchant_request_id = $6,
         checkout_request_id = $7
       WHERE 
         mpesa_number = $8
         AND totalcost = $9
         AND (payment_status IS NULL OR payment_status = 'pending')
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        isSuccess ? 'completed' : 'failed',
        mpesaReceiptNumber || null,
        transactionDate || null,
        ResultCode,
        ResultDesc,
        MerchantRequestID,
        CheckoutRequestID,
        phoneNumber ? `254${phoneNumber.slice(-9)}` : null,
        amount
      ]
    );

    // Log the update result
    console.log(`Payment status updated for phone: ${phoneNumber}, amount: ${amount}, status: ${isSuccess ? 'success' : 'failed'}`);

    // Return success response to M-Pesa
    return NextResponse.json({
      ResultCode: 0,
      ResultDesc: "Callback processed successfully"
    });

  } catch (error) {
    console.error('Callback processing error:', error);
    return NextResponse.json(
      {
        ResultCode: 1,
        ResultDesc: "Error processing callback"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function GET() {
  return NextResponse.json(
    { message: "M-Pesa callback URL is ready to receive POST requests" },
    { status: 200 }
  );
}