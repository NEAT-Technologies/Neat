const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { GetCommand } = require('@aws-sdk/lib-dynamodb')

const s3 = new S3Client({})
const dynamo = new DynamoDBClient({})

async function write() {
  await s3.send(new PutObjectCommand({ Bucket: 'invoices', Key: 'a.pdf', Body: 'x' }))
  await dynamo.send(new GetCommand({ TableName: 'orders-table', Key: { id: '1' } }))
}

module.exports = { write }
