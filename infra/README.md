# RatesAssist — AWS Production Infrastructure

Production deployment for RatesAssist on **AWS Sydney (`ap-southeast-2`) only**.
AU data residency is a hard legal requirement for council data — there is no
US region, no CloudFront (which would force `us-east-1`), and no secondary
region anywhere in this stack.

The app is the Next.js 14 standalone server (`apps/web`) running on **ECS
Fargate** in private subnets, behind a public **ALB** (HTTPS), with **RDS
PostgreSQL** (Multi-AZ) and secrets in **AWS Secrets Manager**.

---

## What this provisions

```
Internet
   │  443 (HTTPS, ACM cert, DNS-validated)  /  80 → 301 → 443
   ▼
[ ALB ]  (public subnets, 2+ AZs)              Route53 A/ALIAS → ALB
   │  app port (3000), ALB SG → ECS SG only
   ▼
[ ECS Fargate service ]  (private subnets)     desired=2, autoscale 2..8 on CPU
   │   task def: secrets injected at runtime (ANTHROPIC_API_KEY,
   │             DATABASE_URL, RA_AUTH_SECRET) — never baked into the image
   │  5432, ECS SG → RDS SG only
   ▼
[ RDS PostgreSQL ]  (private subnets, Multi-AZ, gp3, KMS-encrypted, PITR)

Supporting: ECR (immutable tags, scan-on-push) · CloudWatch logs + 3 alarms
→ SNS · KMS CMK (secrets/RDS/logs/SNS) · VPC endpoints (ECR/Secrets/Logs/STS/
S3) · GitHub OIDC deploy role (no long-lived keys).
```

### Module layout

| Path | Responsibility |
|------|----------------|
| `terraform/modules/network` | VPC, public/private subnets (2+ AZs), IGW, NAT, route tables, VPC endpoints |
| `terraform/modules/security` | ALB / ECS / RDS security groups (deny-by-default, explicit allows) |
| `terraform/modules/ecr` | ECR repo (immutable, scan-on-push, lifecycle policy) |
| `terraform/modules/secrets` | Secrets Manager entries + generated `RA_AUTH_SECRET` |
| `terraform/modules/database` | RDS PostgreSQL Multi-AZ; writes `DATABASE_URL` secret |
| `terraform/modules/dns_cert` | ACM cert (DNS-validated) + Route53 ALIAS |
| `terraform/modules/alb` | ALB, target group (health check `/api/health`), 80→443 + 443 listeners |
| `terraform/modules/ecs` | Cluster, task def, service, per-service IAM, autoscaling |
| `terraform/modules/observability` | Log group, SNS topic, ALB-5xx / CPU / unhealthy-host alarms |
| `terraform/kms.tf` / `iam.tf` / `cicd.tf` | CMK, RDS monitoring role, GitHub OIDC deploy role |

---

## Prerequisites (one-time, human)

1. **AWS account** with admin (or sufficient) credentials configured locally:
   ```bash
   aws configure          # or AWS SSO: aws sso login --profile ratesassist
   aws sts get-caller-identity   # confirm you're in the right account
   ```
2. **Domain delegated to Route53.** Create (or already have) a public hosted
   zone for the apex domain (e.g. `ratesassist.com.au`) and point the
   registrar's nameservers at that zone. Note the **hosted zone ID**.
   ```bash
   aws route53 list-hosted-zones-by-name --dns-name ratesassist.com.au \
     --query 'HostedZones[0].Id' --output text
   ```
3. **Tooling:** Terraform ≥ 1.5, Docker, AWS CLI v2.
4. Decide the app FQDN, e.g. `app.ratesassist.com.au`.

---

## Step 1 — Configure variables

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set at minimum:

```hcl
domain_name    = "app.ratesassist.com.au"
hosted_zone_id = "Z0123456789ABCDEFGHIJ"
image_tag      = "latest"   # replaced by a real ECR tag after first push
```

`region` defaults to (and is validation-locked to) `ap-southeast-2`. Do **not**
put real secret values in `terraform.tfvars` — they go into Secrets Manager
out-of-band (Step 6) so they never enter Terraform state.

---

## Step 2 — Bootstrap remote state (S3 + DynamoDB)

State can contain connection metadata; treat the bucket as Sydney-resident.
Create the backend **once** before enabling it:

```bash
# Bucket (ap-southeast-2 requires the LocationConstraint)
aws s3api create-bucket \
  --bucket ratesassist-tfstate-apse2 \
  --region ap-southeast-2 \
  --create-bucket-configuration LocationConstraint=ap-southeast-2

aws s3api put-bucket-versioning \
  --bucket ratesassist-tfstate-apse2 \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket ratesassist-tfstate-apse2 \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'

aws s3api put-public-access-block \
  --bucket ratesassist-tfstate-apse2 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Lock table
aws dynamodb create-table \
  --table-name ratesassist-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-southeast-2
```

Then **uncomment the `backend "s3"` block in `terraform/backend.tf`** (the
bucket/table names there already match the commands above) and run:

```bash
terraform init        # first time, with the backend now active
```

> Validation/CI can always run **without** the backend:
> `terraform init -backend=false && terraform validate`.

---

## Step 3 — Plan & apply

```bash
terraform plan -out tf.plan      # review every resource it will create
terraform apply tf.plan
```

ACM uses DNS validation against your Route53 zone; the apply blocks until the
certificate is **ISSUED**, so the first apply can take a few minutes (cert +
RDS + NAT are the slow ones). When it finishes, capture the outputs:

```bash
terraform output                 # app_url, ecr_repository_url, rds_endpoint, …
terraform output -raw ecr_repository_url
terraform output -raw github_deploy_role_arn
```

> First-apply note: the ECS service references `image_tag` (default `latest`).
> If no image exists in ECR yet, tasks will fail to pull until Step 7. That is
> expected — the LB, DB, and DNS come up first; the app turns healthy after the
> first image is pushed.

---

## Step 4 — Wire the GitHub Actions deploy role

The deploy workflow (`.github/workflows/deploy.yml`) authenticates via **GitHub
OIDC** — no AWS keys are ever stored in GitHub. Terraform created the OIDC
provider and a least-privilege deploy role. Publish its ARN as a repo secret:

```bash
gh secret set AWS_DEPLOY_ROLE_ARN \
  --repo Brodie-Eaze/ratesassist \
  --body "$(terraform output -raw github_deploy_role_arn)"
```

(Optional but recommended) In GitHub → Settings → Environments → `production`,
add required reviewers so a prod rollout needs a human approval.

> If the AWS account already has a GitHub OIDC provider (only one per account is
> allowed), set `create_github_oidc_provider = false` in `terraform.tfvars` and
> re-apply; the role will reuse the existing provider.

---

## Step 5 — First image build & push (manual, one time)

The CI/CD pipeline does this automatically afterwards; the first push is manual
so the service has an image to run.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=ap-southeast-2
REPO=$(terraform output -raw ecr_repository_url)   # …/ratesassist-prod-web
TAG=sha-$(git rev-parse --short=12 HEAD)

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# Build from the repo ROOT (the Dockerfile is monorepo-aware).
cd ../..                       # back to repo root
docker build -t "${REPO}:${TAG}" -f Dockerfile .
docker push "${REPO}:${TAG}"
```

Point the service at this tag and apply (the ECS service ignores task-def drift
afterwards, so this only sets the initial image):

```bash
cd infra/terraform
terraform apply -var "image_tag=${TAG}"
```

---

## Step 6 — Populate the secrets

`RA_AUTH_SECRET` is auto-generated by Terraform. `DATABASE_URL` is written
automatically from the RDS endpoint + generated password. You only need to set
**`ANTHROPIC_API_KEY`** (and may rotate the others):

```bash
aws secretsmanager put-secret-value \
  --secret-id ratesassist-prod/ANTHROPIC_API_KEY \
  --secret-string 'sk-ant-…' \
  --region ap-southeast-2
```

Force the running tasks to pick up the new secret value:

```bash
aws ecs update-service \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw ecs_service_name)" \
  --force-new-deployment --region ap-southeast-2
```

Verify (never print the value) — the ARNs are in `terraform output secret_arns`:
```bash
aws secretsmanager describe-secret \
  --secret-id ratesassist-prod/DATABASE_URL --region ap-southeast-2
```

---

## Step 7 — First database migration

Migrations live in `packages/db` (drizzle-kit; reads `DATABASE_URL`). RDS is in
private subnets, so run them through a bastion / SSM port-forward, an ECS
`run-task`, or temporarily from a trusted network path. Simplest is to grab the
connection string and run drizzle locally over an SSM tunnel:

```bash
# Pull the connection string Terraform stored:
export DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id ratesassist-prod/DATABASE_URL \
  --query SecretString --output text --region ap-southeast-2)

# With network reachability to RDS (SSM tunnel / bastion):
npm run migrate --workspace=@ratesassist/db
```

`rds.force_ssl=1` is set on the instance, and the stored URL already carries
`sslmode=require`. Confirm the app is healthy:

```bash
curl -fsS "$(cd infra/terraform && terraform output -raw app_url)/api/health"   # {"ok":true,...}
curl -fsS "$(cd infra/terraform && terraform output -raw app_url)/api/ready"     # 200 once DB + key are wired
```

---

## Step 8 — Hand off to CI/CD

From now on, every push to `main` that passes **CI** triggers **Deploy**
(`workflow_run` chain), which builds, pushes an immutable `sha-<commit>` image,
registers a new task-def revision, and rolls the service with
`wait-for-service-stability`. You can also run it manually from the Actions tab
(`workflow_dispatch`, optional `image_tag`).

---

## Rollback

The ECS deployment **circuit breaker** auto-rolls-back a release that fails to
stabilise. To roll back manually to a known-good image (rollback is a deploy of
a previous artifact, never a rebuild):

```bash
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)

# Option A — re-point to a previous image tag and let CI/CD-style flow redeploy:
terraform apply -var "image_tag=sha-<previous-good-sha>"

# Option B — roll the service back to a prior task-definition revision directly:
aws ecs list-task-definitions --family-prefix ratesassist-prod-web \
  --sort DESC --region ap-southeast-2
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition ratesassist-prod-web:<previous-revision> \
  --force-new-deployment --region ap-southeast-2
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
  --region ap-southeast-2
```

Database rollback uses RDS PITR (snapshots + 14-day point-in-time recovery);
restore into a new instance and cut over — do **not** delete the live instance
(`deletion_protection = true`).

---

## Cost & residency notes

- Tags on every resource: `Project`, `Environment`, `Owner`, `ManagedBy`,
  `DataClass=council-pii`, `Residency=ap-southeast-2` — use these in Cost
  Explorer / budgets.
- `single_nat_gateway = true` by default (one NAT). For prod HA set it `false`
  (one NAT per AZ) — costs more but survives an AZ loss of the NAT.
- VPC endpoints keep ECR/Secrets/Logs/STS/S3 traffic on the AWS backbone,
  trimming NAT data-processing cost and keeping the secret/image path off the
  public internet.
- Right-size later via `db_instance_class`, `task_cpu/task_memory`,
  `desired_count`, and reserved capacity / savings plans once baseline is known.
- **Residency:** every resource is `ap-southeast-2`. Keep the Terraform state
  bucket in Sydney too. Do not add CloudFront/WAFv2-global or any `us-*`
  resource without a residency review.
```
