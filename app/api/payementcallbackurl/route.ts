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

    // First find the most recent pending payment for this phone/amount
    const findQuery = `
      SELECT id 
      FROM achievepayemetwithmpesa 
      WHERE 
        mpesa_number = $1
        AND totalcost = $2
        AND (payment_status IS NULL OR payment_status = 'pending')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const formattedPhone = phoneNumber ? `254${phoneNumber.slice(-9)}` : null;
    const findResult = await client.query(findQuery, [formattedPhone, amount]);
    
    if (findResult.rows.length === 0) {
      console.error('No matching pending payment found for:', { formattedPhone, amount });
      return NextResponse.json({
        ResultCode: 1,
        ResultDesc: "No matching pending payment found"
      });
    }

    const paymentId = findResult.rows[0].id;

    // Update the specific payment record
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
       WHERE id = $8`,
      [
        isSuccess ? 'completed' : 'failed',
        mpesaReceiptNumber || null,
        transactionDate || null,
        ResultCode,
        ResultDesc,
        MerchantRequestID,
        CheckoutRequestID,
        paymentId
      ]
    );

    console.log(`Payment ${paymentId} updated for phone: ${formattedPhone}, amount: ${amount}, status: ${isSuccess ? 'success' : 'failed'}`);

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