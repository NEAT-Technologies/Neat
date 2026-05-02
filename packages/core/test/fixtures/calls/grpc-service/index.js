const grpc = require('@grpc/grpc-js')
const { OrdersClient } = require('./generated/orders_grpc_pb')

const client = new OrdersClient('orders.internal:50051', grpc.credentials.createInsecure())

module.exports = { client }
