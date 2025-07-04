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

export async function POST (request: Request) {
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
            transactionDate = String(item.Value)
            break
        }
      }
    }

    // Improved payment matching logic
    const formattedPhone = phoneNumber ? `254${phoneNumber.slice(-9)}` : null

    // Try matching by CheckoutRequestID first (most reliable)
    let paymentId: number | null = null
    let matchMethod = ''

    // 1. Try to match by CheckoutRequestID if we have it
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

    // 2. If not found, try matching by phone and amount (within last 30 minutes)
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

    if (!paymentId) {
      console.error('No matching payment found for:', {
        CheckoutRequestID,
        formattedPhone,
        amount,
        transactionDate
      })

      // Create a new record if we have complete payment info but no match
      if (isSuccess && formattedPhone && amount && mpesaReceiptNumber) {
        const insertResult = await client.query(
          `INSERT INTO achievepayemetwithmpesa 
           (resellername, totalcost, mpesa_number, payment_status,
            mpesa_receipt_number, transaction_date, result_code,
            result_description, merchant_request_id, checkout_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            'Auto-created from callback', // Default reseller name
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

    // Update payment record if we found or created one
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

// get request

export async function GET () {
  return NextResponse.json(
    { message: 'This endpoint only accepts POST requests.' },
    { status: 405 }
  )
}
