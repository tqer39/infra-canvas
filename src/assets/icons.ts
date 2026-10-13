import github from './saas-github.svg';
import linear from './saas-linear.svg';
import fly from './saas-fly.svg';
import gitlab from './saas-gitlab.svg';
import neon from './saas-neon.svg';
import resend from './saas-resend.svg';
import onepassword from './saas-1password.svg';
import elasticsearch from './saas-elasticsearch.svg';
import kibana from './saas-kibana.svg';
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
const icons: Record<string, string> = {
  'saas.github': github,
  'github.repository': github,
  'github.actions': github,
  'saas.linear': linear,
  'saas.fly': fly,
  'saas.gitlab': gitlab,
  'gitlab.repository': gitlab,
  'gitlab.ci': gitlab,
  'saas.neon': neon,
  'saas.resend': resend,
  'saas.1password': onepassword,
  'saas.elasticsearch': elasticsearch,
  'saas.kibana': kibana,

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

export const getIconHomepage = (type: string): string | undefined =>
  type === 'saas.fly' ? 'https://fly.io' : undefined;
