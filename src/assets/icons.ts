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
import azure_app from './azure-app.svg';
import azure_sql from './azure-sql.svg';
import azure_storage from './azure-storage.svg';
const icons: Record<string, string> = {
  'external.user': user,
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
