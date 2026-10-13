import gcp_storage from './gcp-storage.svg';
import aws_alb from './aws-alb.svg';
import aws_ecs from './aws-ecs.svg';
import aws_rds from './aws-rds.svg';
import aws_ec2 from './aws-ec2.svg';
import aws_s3 from './aws-s3.svg';
import aws_lambda from './aws-lambda.svg';
import aws_iam from './aws-iam.svg';
import gcp_cloud_run from './gcp-cloud_run.svg';
import gcp_compute from './gcp-compute.svg';
import gcp_sql from './gcp-sql.svg';
import azure_vm from './azure-vm.svg';
import azure_app from './azure-app.svg';
import azure_sql from './azure-sql.svg';
import azure_storage from './azure-storage.svg';
const icons: Record<string,string> = {
  'gcp.storage': gcp_storage,
  'aws.alb': aws_alb,
  'aws.ecs': aws_ecs,
  'aws.rds': aws_rds,
  'aws.ec2': aws_ec2,
  'aws.s3': aws_s3,
  'aws.lambda': aws_lambda,
  'aws.iam': aws_iam,
  'gcp.cloud_run': gcp_cloud_run,
  'gcp.compute': gcp_compute,
  'gcp.sql': gcp_sql,
  'azure.vm': azure_vm,
  'azure.app': azure_app,
  'azure.sql': azure_sql,
  'azure.storage': azure_storage,
};
export const getIcon = (type: string): string | undefined => icons[type];
