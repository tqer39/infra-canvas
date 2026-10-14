import nginx from './saas-nginx.svg';
import envoyproxy from './saas-envoyproxy.svg';
import aws_eks from './aws-eks.svg';
import aws_vpc_lattice from './aws-vpc-lattice.svg';
import aws_privatelink from './aws-privatelink.svg';
import aws_route53 from './aws-route53.svg';
import aws_direct_connect from './aws-direct-connect.svg';
import aws_dynamodb from './aws-dynamodb.svg';
import aws_control_tower from './aws-control-tower.svg';
import aws_identity_center from './aws-identity-center.svg';
import aws_vpc from './aws-vpc.svg';
import aws_account from './aws-account.svg';
import aws_cloud from './aws-cloud.svg';
import aws_region from './aws-region.svg';
import aws_public_subnet from './aws-public-subnet.svg';
import aws_private_subnet from './aws-private-subnet.svg';
import claude from './saas-claude.svg';
import claudecode from './saas-claudecode.svg';
import googlegemini from './saas-googlegemini.svg';
import deepseek from './saas-deepseek.svg';
import mistralai from './saas-mistralai.svg';
import perplexity from './saas-perplexity.svg';
import qwen from './saas-qwen.svg';
import openrouter from './saas-openrouter.svg';
import replicate from './saas-replicate.svg';
import ollama from './saas-ollama.svg';
import lmstudio from './saas-lmstudio.svg';
import vllm from './saas-vllm.svg';
import dify from './saas-dify.svg';
import langchain from './saas-langchain.svg';
import langgraph from './saas-langgraph.svg';
import aws_transit_gateway from './aws-transit-gateway.svg';
import aws_tgw_attachment from './aws-tgw-attachment.svg';
import aws_ram_share from './aws-ram.svg';
import aws_customer_gateway from './aws-customer-gateway.svg';
import aws_vpn_connection from './aws-vpn.svg';
import gcp_ha_vpn from './gcp-vpn.svg';
import gcp_router from './gcp-router.svg';
import aws_ecs_service from './aws-ecs-service.svg';
import aws_ecs_task from './aws-ecs-task.svg';
import aws_ecs_container from './aws-ecs-container.svg';
import aws_beanstalk_application from './aws-beanstalk-application.svg';
import aws_beanstalk from './aws-beanstalk.svg';
import aws_beanstalk_version from './aws-beanstalk-version.svg';
import turso from './saas-turso.svg';
import cloudflare from './saas-cloudflare.svg';
import user from './external-user.svg';
import vercel from './saas-vercel.svg';
import netlify from './saas-netlify.svg';
import supabase from './saas-supabase.svg';
import firebase from './saas-firebase.svg';
import digitalocean from './saas-digitalocean.svg';
import render from './saas-render.svg';
import railway from './saas-railway.svg';
import mongodb from './saas-mongodb.svg';
import redis from './saas-redis.svg';
import postgresql from './saas-postgresql.svg';
import mysql from './saas-mysql.svg';
import docker from './saas-docker.svg';
import kubernetes from './saas-kubernetes.svg';
import terraform from './saas-terraform.svg';
import sentry from './saas-sentry.svg';
import datadog from './saas-datadog.svg';
import newrelic from './saas-newrelic.svg';
import grafana from './saas-grafana.svg';
import prometheus from './saas-prometheus.svg';
import circleci from './saas-circleci.svg';
import bitbucket from './saas-bitbucket.svg';
import jira from './saas-jira.svg';
import notion from './saas-notion.svg';
import discord from './saas-discord.svg';
import stripe from './saas-stripe.svg';
import auth0 from './saas-auth0.svg';
import okta from './saas-okta.svg';
import anthropic from './saas-anthropic.svg';
import huggingface from './saas-huggingface.svg';
import qiita from './saas-qiita.svg';
import zenn from './saas-zenn.svg';
import line from './saas-line.svg';
import hatenabookmark from './saas-hatenabookmark.svg';
import rakuten from './saas-rakuten.svg';
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
import azure_cloud from './azure-cloud.svg';
import gcp_cloud from './gcp-cloud.png';
import azure_app from './azure-app.svg';
import azure_sql from './azure-sql.svg';
import azure_storage from './azure-storage.svg';
const icons: Record<string, string> = {
  'aws.eks': aws_eks,
  'aws.vpc-lattice': aws_vpc_lattice,
  'aws.privatelink': aws_privatelink,
  'aws.route53': aws_route53,
  'aws.direct-connect': aws_direct_connect,
  'aws.dynamodb': aws_dynamodb,
  'aws.control-tower': aws_control_tower,
  'aws.identity-center': aws_identity_center,
  'aws.eks-cluster': aws_eks,
  'aws.eks-node-group': aws_eks,
  'aws.eks-fargate-profile': aws_eks,
  'aws.eks-pod-identity-association': aws_iam,
  'aws.eks-access-entry': aws_iam,
  'aws.eks-access-policy': aws_iam,
  'k8s.namespace': kubernetes,
  'k8s.deployment': kubernetes,
  'k8s.pod': kubernetes,
  'k8s.service': kubernetes,
  'k8s.ingress': kubernetes,
  'k8s.service-account': kubernetes,
  'k8s.node': kubernetes,
  'k8s.role': kubernetes,
  'k8s.role-binding': kubernetes,
  'k8s.network-policy': kubernetes,
  'saas.nginx': nginx,
  'saas.envoyproxy': envoyproxy,
  'software.nginx': nginx,
  'software.envoy': envoyproxy,
  'aws.vpc': aws_vpc,
  'aws.subnet-public': aws_public_subnet,
  'aws.subnet-private': aws_private_subnet,
  'saas.claude': claude,
  'saas.claudecode': claudecode,
  'saas.googlegemini': googlegemini,
  'saas.deepseek': deepseek,
  'saas.mistralai': mistralai,
  'saas.perplexity': perplexity,
  'saas.qwen': qwen,
  'saas.openrouter': openrouter,
  'saas.replicate': replicate,
  'saas.ollama': ollama,
  'saas.lmstudio': lmstudio,
  'saas.vllm': vllm,
  'saas.dify': dify,
  'saas.langchain': langchain,
  'saas.langgraph': langgraph,
  'aws.organization': aws_organizations,
  'aws.organization-root': aws_organizations,
  'aws.organizational-unit': aws_organizational_unit,
  'aws.organization-account': aws_organization_account,
  'aws.account': aws_account,
  'aws.cloud': aws_cloud,
  'aws.region': aws_region,
  'aws.organization-policy': aws_organizations,
  'aws.organization-policy-attachment': aws_organizations,
  'external.user': user,
  'aws.transit-gateway': aws_transit_gateway,
  'aws.tgw-attachment': aws_tgw_attachment,
  'aws.ram-share': aws_ram_share,
  'aws.customer-gateway': aws_customer_gateway,
  'aws.vpn-connection': aws_vpn_connection,
  'gcp.ha-vpn': gcp_ha_vpn,
  'gcp.router': gcp_router,
  'aws.tgw-route-table': aws_transit_gateway,
  'aws.tgw-route-association': aws_tgw_attachment,
  'aws.tgw-route-propagation': aws_tgw_attachment,
  'aws.ram-resource-association': aws_ram_share,
  'aws.ram-principal-association': aws_ram_share,
  'gcp.external-vpn': gcp_ha_vpn,
  'gcp.vpn-tunnel': gcp_ha_vpn,
  'gcp.router-interface': gcp_router,
  'gcp.bgp-peer': gcp_router,

  'saas.cloudflare': cloudflare,
  'saas.vercel': vercel,
  'saas.netlify': netlify,
  'saas.supabase': supabase,
  'saas.firebase': firebase,
  'saas.digitalocean': digitalocean,
  'saas.render': render,
  'saas.railway': railway,
  'saas.mongodb': mongodb,
  'saas.redis': redis,
  'saas.postgresql': postgresql,
  'saas.mysql': mysql,
  'saas.docker': docker,
  'saas.kubernetes': kubernetes,
  'saas.terraform': terraform,
  'saas.sentry': sentry,
  'saas.datadog': datadog,
  'saas.newrelic': newrelic,
  'saas.grafana': grafana,
  'saas.prometheus': prometheus,
  'saas.circleci': circleci,
  'saas.bitbucket': bitbucket,
  'saas.jira': jira,
  'saas.notion': notion,
  'saas.discord': discord,
  'saas.stripe': stripe,
  'saas.auth0': auth0,
  'saas.okta': okta,
  'saas.anthropic': anthropic,
  'saas.huggingface': huggingface,
  'saas.qiita': qiita,
  'saas.zenn': zenn,
  'saas.line': line,
  'saas.hatenabookmark': hatenabookmark,
  'saas.rakuten': rakuten,

  'saas.github': github,
  'github.repository': github,
  'github.actions': github,
  'saas.linear': linear,
  'saas.fly': fly,
  'saas.gitlab': gitlab,
  'gitlab.repository': gitlab,
  'gitlab.ci': gitlab,
  'saas.neon': neon,
  'saas.turso': turso,
  'saas.resend': resend,
  'saas.1password': onepassword,
  'saas.elasticsearch': elasticsearch,
  'saas.kibana': kibana,

  'gcp.storage': gcp_storage,
  'gcp.cloud': gcp_cloud,
  'aws.alb': aws_alb,
  'aws.ecs': aws_ecs,
  'aws.ecs-cluster': aws_ecs,
  'aws.ecs-task-definition': aws_ecs_task,
  'aws.ecs-service': aws_ecs_service,
  'aws.ecs-task': aws_ecs_task,
  'aws.ecs-container': aws_ecs_container,
  'aws.beanstalk-application': aws_beanstalk_application,
  'aws.beanstalk-environment': aws_beanstalk,
  'aws.beanstalk-version': aws_beanstalk_version,

  'aws.rds': aws_rds,
  'aws.ec2': aws_ec2,
  'aws.s3': aws_s3,
  'aws.lambda': aws_lambda,
  'aws.iam': aws_iam,
  'gcp.cloud_run': gcp_cloud_run,
  'gcp.compute': gcp_compute,
  'gcp.sql': gcp_sql,
  'azure.vm': azure_vm,
  'azure.cloud': azure_cloud,
  'azure.app': azure_app,
  'azure.sql': azure_sql,
  'azure.storage': azure_storage,
};
export const getIconTypes = (): string[] => Object.keys(icons).sort();
export const getIcon = (type: string): string | undefined => icons[type];
export const iconTypes = Object.keys(icons).sort();

export const getIconHomepage = (type: string): string | undefined =>
  type === 'saas.fly' ? 'https://fly.io' : undefined;
import aws_organizations from './aws-organizations.svg';
import aws_organizational_unit from './aws-ou.svg';
import aws_organization_account from './aws-organization-account.svg';
