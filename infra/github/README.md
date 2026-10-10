# GitHub Actions deploy role

The CD workflow (`.github/workflows/cd.yml`) assumes `arn:aws:iam::198805281865:role/GitHub-PortfolioTracker` through the account's existing GitHub OIDC provider, following the `GitHub-<Repo>` convention used by the other repos.

Create it once (admin credentials):

```sh
aws iam create-policy --policy-name PortfolioTracker-Deployment \
  --policy-document file://infra/github/deploy-policy.json \
  --description "SST deployment permissions for the PortfolioTracker GitHub Actions role"

aws iam create-role --role-name GitHub-PortfolioTracker \
  --assume-role-policy-document file://infra/github/trust-policy.json \
  --description "GitHub Actions (jakubprzybytek/PortfolioTracker) deploys via SST" \
  --max-session-duration 7200

aws iam attach-role-policy --role-name GitHub-PortfolioTracker --policy-arn arn:aws:iam::198805281865:policy/SST-Deployment
aws iam attach-role-policy --role-name GitHub-PortfolioTracker --policy-arn arn:aws:iam::198805281865:policy/PortfolioTracker-Deployment
```

- `trust-policy.json` limits the role to `repo:jakubprzybytek/PortfolioTracker:*`.
- `deploy-policy.json` grants what SST needs for this app (Lambda, Scheduler, DynamoDB, S3, CloudFront, ACM, Route 53, API Gateway, IAM roles for the functions). It uses per-service wildcards because IAM's 6 KB managed-policy limit doesn't fit the action-by-action list.
- The shared `SST-Deployment` policy covers the SST state bucket and bootstrap parameters.
