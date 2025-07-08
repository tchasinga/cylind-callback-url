import { getPostgresPoolConnection } from '@/lib/mysqlconnection'
import { NextResponse } from 'next/server'

interface MpesaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
      CallbackMetadata?: {
        Item: Array<{
          Name: string
          Value: string | number
        }>
      }
    }
  }
}

// Helper to parse M-Pesa's date format (YYYYMMDDHHMMSS)
function parseMpesaDate(mpesaDate: string): string {
  const year = mpesaDate.slice(0, 4)
  const month = mpesaDate.slice(4, 6)
  const day = mpesaDate.slice(6, 8)
  const hour = mpesaDate.slice(8, 10)
  const minute = mpesaDate.slice(10, 12)
  const second = mpesaDate.slice(12, 14)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export async function POST(request: Request) {
  const client = await getPostgresPoolConnection().connect()
  try {
    const callbackData: MpesaCallbackBody = await request.json()

    if (!callbackData?.Body?.stkCallback) {
      console.error('Invalid callback structure:', callbackData)
      return NextResponse.json(
        { error: 'Invalid callback structure' },
        { status: 400 }
      )
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = callbackData.Body.stkCallback

    console.log('M-Pesa Callback Received:', {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    })

    const isSuccess = ResultCode === 0
    let mpesaReceiptNumber = ''
    let phoneNumber = ''
    let amount = 0
    let transactionDate = ''

    if (isSuccess && CallbackMetadata) {
      for (const item of CallbackMetadata.Item) {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            mpesaReceiptNumber = String(item.Value)
            break
          case 'PhoneNumber':
            phoneNumber = String(item.Value)
            break
          case 'Amount':
            amount = Number(item.Value)
            break
          case 'TransactionDate':
            transactionDate = parseMpesaDate(String(item.Value))
            break
        }
      }
    }

    const formattedPhone = phoneNumber ? `254${phoneNumber.slice(-9)}` : null

    let paymentId: string | null = null
    let matchMethod = ''

    // 1. Match by CheckoutRequestID
    if (CheckoutRequestID) {
      const result = await client.query(
        `SELECT id FROM achievepayemetwithmpesa 
         WHERE checkout_request_id = $1 LIMIT 1`,
        [CheckoutRequestID]
      )
      if (result.rows.length > 0) {
        paymentId = result.rows[0].id
        matchMethod = 'CheckoutRequestID'
      }
    }

    // 2. Match by phone & amount within 30 minutes
    if (!paymentId && formattedPhone && amount) {
      const result = await client.query(
        `SELECT id FROM achievepayemetwithmpesa 
         WHERE mpesa_number = $1 
         AND totalcost = $2
         AND (payment_status IS NULL OR payment_status = 'pending')
         AND created_at >= NOW() - INTERVAL '30 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [formattedPhone, amount]
      )
      if (result.rows.length > 0) {
        paymentId = result.rows[0].id
        matchMethod = 'PhoneAndAmount'
      }
    }

    // 3. If no match, create a new record if all data available
    if (!paymentId) {
      console.error('No matching payment found for:', {
        CheckoutRequestID,
        formattedPhone,
        amount,
        transactionDate
      })

      if (isSuccess && formattedPhone && amount && mpesaReceiptNumber) {
        const insertResult = await client.query(
          `INSERT INTO achievepayemetwithmpesa 
           (resellername, totalcost, mpesa_number, payment_status,
            mpesa_receipt_number, transaction_date, result_code,
            result_description, merchant_request_id, checkout_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            'Auto-created from callback',
            amount,
            formattedPhone,
            'completed',
            mpesaReceiptNumber,
            transactionDate,
            ResultCode,
            ResultDesc,
            MerchantRequestID,
            CheckoutRequestID
          ]
        )
        paymentId = insertResult.rows[0].id
        matchMethod = 'NewRecordCreated'
        console.log(`Created new payment record ${paymentId} from callback`)
      } else {
        return NextResponse.json({
          ResultCode: 1,
          ResultDesc:
            'No matching payment found and insufficient data to create new record'
        })
      }
    }

    // 4. Update matched or newly created record
    if (paymentId) {
      await client.query(
        `UPDATE achievepayemetwithmpesa 
         SET 
           payment_status = $1,
           mpesa_receipt_number = COALESCE($2, mpesa_receipt_number),
           transaction_date = COALESCE($3, transaction_date),
           result_code = $4,
           result_description = $5,
           merchant_request_id = COALESCE($6, merchant_request_id),
           checkout_request_id = COALESCE($7, checkout_request_id)
         WHERE id = $8`,
        [
          isSuccess ? 'completed' : 'failed',
          mpesaReceiptNumber,
          transactionDate,
          ResultCode,
          ResultDesc,
          MerchantRequestID,
          CheckoutRequestID,
          paymentId
        ]
      )

      console.log(`Payment ${paymentId} updated (matched by ${matchMethod})`)
    }

    return NextResponse.json({
      ResultCode: 0,
      ResultDesc: 'Callback processed successfully'
    })
  } catch (error) {
    console.error('Callback processing error:', error)
    return NextResponse.json(
      {
        ResultCode: 1,
        ResultDesc: 'Error processing callback'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

// Reject GET requests
export async function GET() {
  return NextResponse.json(
    { message: 'This endpoint only accepts POST requests.' },
    { status: 405 }
  )
}
