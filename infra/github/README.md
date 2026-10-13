# GitHub Actions deploy role

The CD workflow (`.github/workflows/cd.yml`) assumes the role `GitHub-PortfolioTracker` through the account's existing GitHub OIDC provider, following the `GitHub-<Repo>` convention used by the other repos. The workflow builds the role's ARN from the repository secret **`AWS_ACCOUNT`** (the AWS account number), so the number stays out of this public repo and is masked in the public Actions logs.

The IAM documents that need the account number are kept locally in `infra/github/private/` (gitignored): `trust-policy.json` and the rendered `deploy-policy.json`. The committed `deploy-policy.json` has `ACCOUNT_ID` in its place.

Create it once (admin credentials):

```sh
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
mkdir -p infra/github/private
sed "s/ACCOUNT_ID/$ACCOUNT_ID/g" infra/github/deploy-policy.json > infra/github/private/deploy-policy.json

aws iam create-policy --policy-name PortfolioTracker-Deployment \
  --policy-document file://infra/github/private/deploy-policy.json \
  --description "SST deployment permissions for the PortfolioTracker GitHub Actions role"

aws iam create-role --role-name GitHub-PortfolioTracker \
  --assume-role-policy-document file://infra/github/private/trust-policy.json \
  --description "GitHub Actions (jakubprzybytek/PortfolioTracker) deploys via SST" \
  --max-session-duration 7200

aws iam attach-role-policy --role-name GitHub-PortfolioTracker --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/SST-Deployment
aws iam attach-role-policy --role-name GitHub-PortfolioTracker --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/PortfolioTracker-Deployment
```

Then add the repository secret `AWS_ACCOUNT` (Settings → Secrets and variables → Actions) with the account number.

- **Trust policy** (`infra/github/private/trust-policy.json`): allows `sts:AssumeRoleWithWebIdentity` from the federated principal `arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com`, with `token.actions.githubusercontent.com:aud` = `sts.amazonaws.com` and `token.actions.githubusercontent.com:sub` (StringLike) limited to this repository, in both forms GitHub uses:
  - `repo:jakubprzybytek/PortfolioTracker:*` (classic)
  - `repo:jakubprzybytek@90648/PortfolioTracker@1413383966:*` (owner and repo IDs). This is what GitHub actually sends now, e.g. `…:environment:int`. With only the classic pattern, `AssumeRoleWithWebIdentity` fails with "Not authorized". CloudTrail (`AssumeRoleWithWebIdentity` events) shows the subject that was presented.

  To update an existing role: `aws iam update-assume-role-policy --role-name GitHub-PortfolioTracker --policy-document file://infra/github/private/trust-policy.json`.
- `deploy-policy.json` grants what SST needs for this app (Lambda, Scheduler, SQS queues named `portfolio-tracker-*`, DynamoDB, S3, CloudFront, ACM, Route 53, API Gateway, IAM roles for the functions, and app clients in the shared Cognito user pool). It uses per-service wildcards because IAM's 6 KB managed-policy limit doesn't fit the action-by-action list.
- The shared `SST-Deployment` policy covers the SST state bucket and bootstrap parameters.
- To change the deploy policy later: render it again (the `sed` line above), then `aws iam create-policy-version --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/PortfolioTracker-Deployment --policy-document file://infra/github/private/deploy-policy.json --set-as-default` (IAM keeps at most 5 versions; delete old ones with `delete-policy-version`).
