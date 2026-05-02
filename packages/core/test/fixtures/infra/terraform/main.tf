resource "aws_s3_bucket" "uploads" {
  bucket = "fixture-uploads"
}

resource "aws_dynamodb_table" "orders" {
  name = "fixture-orders"
}
