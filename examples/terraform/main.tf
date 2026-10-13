# 合成 fixture。実環境の plan/state は含みません。
provider "aws" {
  alias  = "primary"
  region = "ap-northeast-1"
}
provider "aws" {
  alias  = "secondary"
  region = "us-east-1"
}
module "network" {
  source = "./modules/network"
}
resource "aws_security_group" "app" {
  vpc_id = module.network.vpc_id
}
resource "aws_instance" "worker" {
  count         = 2
  instance_type = "t3.micro"
  subnet_id     = module.network.private_subnet_id
  vpc_security_group_ids = [aws_security_group.app.id]
}
resource "aws_s3_bucket" "logs" {
  provider = aws.secondary
}
